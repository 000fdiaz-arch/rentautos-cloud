import type { ActiveRouteItem } from "./cloudData";
import type { Payment } from "./types";

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

export function countActiveRouteReviewItems(items: ActiveRouteItem[], payments: Payment[], dateKey: string): number {
  return items.filter((item) => !item.removedAt && hasPendingPartialRouteDecision(payments, item, dateKey)).length;
}
