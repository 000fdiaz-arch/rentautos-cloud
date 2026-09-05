import type { ActiveRouteItem } from "./cloudData";
import type { Payment } from "./types";
import type { RoutePaymentReport } from "./cloud/routeReportCloudData";

export function isPendingCashRouteReport(report?: RoutePaymentReport): boolean {
  return report?.status === "review" && report.method === "cash" && report.confirmed_cash_amount === 0;
}

export function routeRentAmountForDay(payments: Payment[], item: Pick<ActiveRouteItem, "clientId">, dateKey: string): number {
  const total = payments
    .filter((payment) => payment.clientId === item.clientId && payment.dateApplied === dateKey)
    .reduce((sum, payment) => sum + Math.max(0, payment.appliedToRent), 0);
  return Math.round(total * 100) / 100;
}

export function hasPendingPartialRouteDecision(payments: Payment[], item: ActiveRouteItem, dateKey: string): boolean {
  const confirmedRentAmount = routeRentAmountForDay(payments, item, dateKey);
  if (confirmedRentAmount <= 0 || confirmedRentAmount >= item.releaseAmount) return false;
  return typeof item.partialDecisionRentAmount !== "number"
    || Math.abs(item.partialDecisionRentAmount - confirmedRentAmount) >= 0.005;
}

export function hasAcknowledgedPartialRouteDecision(payments: Payment[], item: ActiveRouteItem, dateKey: string): boolean {
  const confirmedRentAmount = routeRentAmountForDay(payments, item, dateKey);
  return confirmedRentAmount > 0 && confirmedRentAmount < item.releaseAmount
    && typeof item.partialDecisionRentAmount === "number"
    && Math.abs(item.partialDecisionRentAmount - confirmedRentAmount) < 0.005;
}

export function countActiveRouteReviewItems(items: ActiveRouteItem[], payments: Payment[], dateKey: string, reports: RoutePaymentReport[] = []): number {
  const pending = new Set(getActiveRouteReviewItems(items, payments, dateKey, reports).map((item) => JSON.stringify([item.clientId, item.publishedAt])));
  reports.filter(isPendingCashRouteReport).forEach((report) => pending.add(JSON.stringify([report.client_id, report.published_at])));
  return pending.size;
}

export function getActiveRouteReviewItems(items: ActiveRouteItem[], payments: Payment[], dateKey: string, reports: RoutePaymentReport[] = []): ActiveRouteItem[] {
  return items.filter((item) => !item.removedAt && !item.inCustody && hasPendingPartialRouteDecision(payments, item, dateKey)
    && !reports.some(report => report.client_id === item.clientId && report.published_at === item.publishedAt && report.status === "review"));
}

export function getRouteWorkItems(items: ActiveRouteItem[], payments: Payment[], dateKey: string, reports: RoutePaymentReport[]): ActiveRouteItem[] {
  return items.filter(item => {
    if (item.removedAt || item.inCustody || hasPendingPartialRouteDecision(payments, item, dateKey)) return false;
    if (item.releaseAmount > 0 && routeRentAmountForDay(payments, item, dateKey) >= item.releaseAmount) return false;
    const currentReports = reports.filter(report => report.client_id === item.clientId && report.published_at === item.publishedAt);
    return !currentReports.some(report => report.status === "review")
      && (currentReports.length === 0 || hasAcknowledgedPartialRouteDecision(payments, item, dateKey));
  });
}
