import type { ActiveRouteItem } from "./cloudData";
import type { Payment } from "./types";
import type { RoutePaymentReport } from "./cloud/routeReportCloudData";

export function isPendingCashRouteReport(report?: RoutePaymentReport): boolean {
  return report?.status === "review" && report.method === "cash" && report.confirmed_cash_amount === 0;
}

export function routeRentAmountForDay(payments: Payment[], item: ActiveRouteItem, dateKey: string): number {
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
  const pending = new Set(getActiveRouteReviewItems(items, payments, dateKey).map((item) => JSON.stringify([item.clientId, item.publishedAt])));
  reports.filter(isPendingCashRouteReport).forEach((report) => pending.add(JSON.stringify([report.client_id, report.published_at])));
  return pending.size;
}

export function getActiveRouteReviewItems(items: ActiveRouteItem[], payments: Payment[], dateKey: string): ActiveRouteItem[] {
  return items.filter((item) => !item.removedAt && !item.inCustody && hasPendingPartialRouteDecision(payments, item, dateKey));
}
