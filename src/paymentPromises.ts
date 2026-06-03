import type { Payment, PaymentPromise } from "./types";

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function toMiddayIso(dateKey: string): string {
  return `${dateKey}T12:00:00.000Z`;
}

function parsePaymentDateToEpoch(payment: Payment): number {
  const asDateOnly = new Date(toMiddayIso(payment.dateApplied));
  return asDateOnly.getTime();
}

export function evaluatePaymentPromises(promises: PaymentPromise[], payments: Payment[], now: Date): PaymentPromise[] {
  const nowEpoch = now.getTime();
  return promises.map((promise) => {
    if (promise.status === "cancelled" || promise.status === "rescheduled") return promise;

    const createdEpoch = new Date(promise.createdAt).getTime();
    const dueEpoch = new Date(promise.dueAt).getTime();
    const withinWindow = payments
      .filter((payment) => payment.clientId === promise.clientId)
      .filter((payment) => {
        const paymentEpoch = parsePaymentDateToEpoch(payment);
        return paymentEpoch >= createdEpoch && paymentEpoch <= dueEpoch;
      });
    const totalWithinWindow = roundMoney(withinWindow.reduce((sum, payment) => sum + payment.amountReceived, 0));
    const totalAllAfterCreation = roundMoney(
      payments
        .filter((payment) => payment.clientId === promise.clientId)
        .filter((payment) => parsePaymentDateToEpoch(payment) >= createdEpoch)
        .reduce((sum, payment) => sum + payment.amountReceived, 0)
    );
    const missingWithinWindow = roundMoney(Math.max(0, promise.amountPromised - totalWithinWindow));

    let status = promise.status;
    let closedAt = promise.closedAt;
    if (totalWithinWindow >= promise.amountPromised) {
      status = "fulfilled";
      closedAt = closedAt ?? new Date().toISOString();
    } else if (nowEpoch > dueEpoch) {
      if (totalAllAfterCreation >= promise.amountPromised) {
        status = "fulfilled_late";
        closedAt = closedAt ?? new Date().toISOString();
      } else if (totalWithinWindow > 0) {
        status = "overdue";
      } else {
        status = "overdue";
      }
    } else if (totalWithinWindow > 0) {
      status = "incomplete";
    } else {
      status = "pending";
    }

    return {
      ...promise,
      amountCollectedWithinWindow: totalWithinWindow,
      amountCollectedTotal: totalAllAfterCreation,
      amountMissing: missingWithinWindow,
      status,
      closedAt,
      updatedAt: new Date().toISOString()
    };
  });
}

export function closePendingPromisesAsRescheduled(promises: PaymentPromise[], clientId: string): PaymentPromise[] {
  return promises.map((promise) => {
    if (promise.clientId !== clientId || promise.status !== "pending") return promise;
    return {
      ...promise,
      status: "rescheduled",
      closedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      closedReason: promise.closedReason ?? "Reprogramada por nueva promesa activa."
    };
  });
}

export function formatPromiseStatusLabel(status: PaymentPromise["status"]): string {
  if (status === "pending") return "Pendiente";
  if (status === "fulfilled") return "Cumplida";
  if (status === "incomplete") return "Incompleta";
  if (status === "overdue") return "Vencida";
  if (status === "rescheduled") return "Reprogramada";
  if (status === "cancelled") return "Cancelada";
  return "Cumplida tarde";
}

