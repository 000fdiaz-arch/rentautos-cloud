import type { ActiveRouteItem } from "./cloudData";
import type { Payment } from "./types";
import type { RoutePaymentReport } from "./cloud/routeReportCloudData";

function routeReportBusinessDateKey(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Panama",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function isPendingCashRouteReport(report?: RoutePaymentReport): boolean {
  return report?.status === "review" && report.method === "cash" && report.confirmed_cash_amount === 0;
}

export type RouteReviewIndex = {
  paymentsByClientAndDate: Map<string, Payment[]>;
  reportsByRouteItem: Map<string, RoutePaymentReport[]>;
};

function paymentIndexKey(clientId: string, dateKey: string): string {
  return `${clientId}\u0000${dateKey}`;
}

function routeItemIndexKey(clientId: string, publishedAt: string): string {
  return `${clientId}\u0000${publishedAt}`;
}

export function buildRouteReviewIndex(payments: Payment[], reports: RoutePaymentReport[] = []): RouteReviewIndex {
  const paymentsByClientAndDate = new Map<string, Payment[]>();
  for (const payment of payments) {
    const key = paymentIndexKey(payment.clientId, payment.dateApplied);
    const current = paymentsByClientAndDate.get(key);
    if (current) current.push(payment);
    else paymentsByClientAndDate.set(key, [payment]);
  }
  const reportsByRouteItem = new Map<string, RoutePaymentReport[]>();
  for (const report of reports) {
    const key = routeItemIndexKey(report.client_id, report.published_at);
    const current = reportsByRouteItem.get(key);
    if (current) current.push(report);
    else reportsByRouteItem.set(key, [report]);
  }
  return { paymentsByClientAndDate, reportsByRouteItem };
}

export function routeRentAmountForDay(
  payments: Payment[],
  item: Pick<ActiveRouteItem, "clientId"> & Partial<Pick<ActiveRouteItem, "routeStartedAt">>,
  dateKey: string,
  index?: RouteReviewIndex
): number {
  const routeStartedAt = item.routeStartedAt ? Date.parse(item.routeStartedAt) : Number.NaN;
  const candidatePayments = index?.paymentsByClientAndDate.get(paymentIndexKey(item.clientId, dateKey)) ?? payments;
  const total = candidatePayments
    .filter((payment) => {
      if (!(payment.clientId === item.clientId && payment.dateApplied === dateKey)) return false;
      if (!Number.isFinite(routeStartedAt)) return true;
      const paymentCreatedAt = Date.parse(payment.createdAt);
      return !Number.isFinite(paymentCreatedAt) || paymentCreatedAt >= routeStartedAt;
    })
    .reduce((sum, payment) => sum + Math.max(0, payment.appliedToRent), 0);
  return Math.round(total * 100) / 100;
}

export function hasPendingPartialRouteDecision(payments: Payment[], item: ActiveRouteItem, dateKey: string, index?: RouteReviewIndex): boolean {
  const confirmedRentAmount = routeRentAmountForDay(payments, item, dateKey, index);
  if (confirmedRentAmount <= 0 || confirmedRentAmount >= item.releaseAmount) return false;
  return typeof item.partialDecisionRentAmount !== "number"
    || Math.abs(item.partialDecisionRentAmount - confirmedRentAmount) >= 0.005;
}

export function hasAcknowledgedPartialRouteDecision(payments: Payment[], item: ActiveRouteItem, dateKey: string, index?: RouteReviewIndex): boolean {
  const confirmedRentAmount = routeRentAmountForDay(payments, item, dateKey, index);
  return confirmedRentAmount > 0 && confirmedRentAmount < item.releaseAmount
    && typeof item.partialDecisionRentAmount === "number"
    && Math.abs(item.partialDecisionRentAmount - confirmedRentAmount) < 0.005;
}

export function countActiveRouteReviewItems(items: ActiveRouteItem[], payments: Payment[], dateKey: string, reports: RoutePaymentReport[] = []): number {
  const index = buildRouteReviewIndex(payments, reports);
  const pending = new Set(getActiveRouteReviewItems(items, payments, dateKey, reports, index).map((item) => JSON.stringify([item.clientId, item.publishedAt])));
  return pending.size;
}

export function getActiveRouteReviewItems(items: ActiveRouteItem[], payments: Payment[], dateKey: string, reports: RoutePaymentReport[] = [], index = buildRouteReviewIndex(payments, reports)): ActiveRouteItem[] {
  return items.filter((item) => !item.removedAt && !item.inCustody && hasPendingPartialRouteDecision(payments, item, dateKey, index)
    && !(index.reportsByRouteItem.get(routeItemIndexKey(item.clientId, item.publishedAt)) ?? []).some(report => report.status === "review"));
}

export function getRouteWorkItems(items: ActiveRouteItem[], payments: Payment[], dateKey: string, reports: RoutePaymentReport[], index = buildRouteReviewIndex(payments, reports)): ActiveRouteItem[] {
  return items.filter(item => {
    if (item.removedAt || item.inCustody || hasPendingPartialRouteDecision(payments, item, dateKey, index)) return false;
    if (item.releaseAmount > 0 && routeRentAmountForDay(payments, item, dateKey, index) >= item.releaseAmount) return false;
    const currentReports = index.reportsByRouteItem.get(routeItemIndexKey(item.clientId, item.publishedAt)) ?? [];
    if (currentReports.some(report => report.status === "review")) return false;
    const hasConfirmedReportToday = currentReports.some(report => {
      if (report.status !== "confirmed") return false;
      const confirmedAt = report.confirmed_at || report.reported_at;
      if (!confirmedAt) return true;
      const confirmedDateKey = routeReportBusinessDateKey(confirmedAt);
      return confirmedDateKey === null || confirmedDateKey === dateKey;
    });
    return !hasConfirmedReportToday || hasAcknowledgedPartialRouteDecision(payments, item, dateKey, index);
  });
}
