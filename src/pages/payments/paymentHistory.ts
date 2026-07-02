import type { Payment } from "../../types";

export const PAYMENT_HISTORY_LIMIT = 25;

function compareNewestPayment(first: Payment, second: Payment): number {
  const byAppliedDate = second.dateApplied.localeCompare(first.dateApplied);
  if (byAppliedDate !== 0) return byAppliedDate;

  const byCreatedAt = second.createdAt.localeCompare(first.createdAt);
  if (byCreatedAt !== 0) return byCreatedAt;

  const byReceipt = second.receiptNumber.localeCompare(first.receiptNumber);
  if (byReceipt !== 0) return byReceipt;

  return second.id.localeCompare(first.id);
}

export function selectLatestPayments(
  payments: Payment[],
  limit = PAYMENT_HISTORY_LIMIT
): Payment[] {
  if (limit <= 0) return [];
  return [...payments].sort(compareNewestPayment).slice(0, limit);
}
