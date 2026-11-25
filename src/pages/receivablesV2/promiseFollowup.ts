import type { CollectionStatusRecord } from "./receivablesTypes";
import { getBusinessDateKey } from "../../billing";

export function promiseFollowup(
  record: CollectionStatusRecord | undefined, collector: string,
  payments: Array<{ id: string; createdAt?: string; amountReceived: number; centavosAhorro?: number }>, now: Date
) {
  const attempts = (record?.contactOutcomes ?? []).filter(item => item.collector === collector);
  const promise = attempts.filter(item => item.result === "promise").sort((a, b) => a.at.localeCompare(b.at)).slice(-1)[0];
  if (promise?.promiseCancelledAt) return null;
  if (!promise?.promiseDate || !promise.promiseTime || !(promise.promiseAmount! > 0)) return null;
  const due = new Date(promise.promiseDate + "T" + promise.promiseTime + ":00-05:00");
  const since = Date.parse(promise.promisePaymentSince ?? promise.at);
  const unique = [...new Map(payments.map(payment => [payment.id, payment])).values()];
  const paid = unique.filter(payment => payment.createdAt && Date.parse(payment.createdAt) >= since && Date.parse(payment.createdAt) <= now.getTime())
    .reduce((sum, payment) => sum + Math.max(0, payment.amountReceived - Math.max(0, payment.centavosAhorro ?? 0)), 0);
  const remaining = Math.max(0, Math.round((promise.promiseAmount! - paid) * 100) / 100);
  const response = attempts.filter(item => item.followupOf === promise.at).sort((a, b) => a.at.localeCompare(b.at)).slice(-1)[0];
  const nextDue = response?.nextContactAt ? Date.parse(response.nextContactAt) : due.getTime();
  const alertKey = promise.at + "|" + (response?.at ?? "");
  const waitingForRetry = response?.result === "no_answer" && response.date === getBusinessDateKey(now);
  return { promise, paid, remaining, alertKey, overdue: !waitingForRetry && response?.result !== "escalated" && nextDue <= now.getTime() && remaining > 0 };
}
