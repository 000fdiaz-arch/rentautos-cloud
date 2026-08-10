import type { Payment } from "../../types";
import { BANK_PAYMENT_METHODS } from "./paymentConstants";

export type DailyIncomeStatus = "received" | "pending" | "non_cash";

export type DailyIncomeGroup = {
  key: string;
  label: string;
  accountNumber?: string;
  status: DailyIncomeStatus;
  payments: Payment[];
  total: number;
};

export function maskAccountNumber(accountNumber?: string): string {
  const normalized = (accountNumber ?? "").replace(/\s+/g, "").trim();
  if (!normalized) return "";
  return normalized.length <= 4 ? normalized : `····${normalized.slice(-4)}`;
}

export function getIncomeDate(payment: Payment): string {
  return payment.fundsReceivedDate || payment.dateApplied;
}

export function getDailyIncomeStatus(payment: Payment): DailyIncomeStatus {
  if (payment.paymentMethod === "Descuento" || payment.paymentMethod === "Referido") return "non_cash";
  if (payment.paymentMethod === "Efectivo" && payment.moneyDelivered === false) return "pending";
  if (payment.paymentMethod === "Tarjeta" && !payment.fundsReceivedDate) return "pending";
  return "received";
}

export function getDailyIncomeReportDate(payment: Payment): string {
  if (payment.paymentMethod === "Efectivo" && payment.moneyDelivered === true && payment.moneyDeliveryDate) {
    return payment.moneyDeliveryDate;
  }
  return getIncomeDate(payment);
}

export function isMoneyDelivered(payment: Payment): boolean {
  return payment.moneyDelivered !== false;
}

export function buildPendingDeliveryRows(payments: Payment[], dateKey: string): Payment[] {
  return payments
    .filter((payment) => (
      payment.moneyDelivered === false &&
      getDailyIncomeStatus(payment) !== "non_cash" &&
      getIncomeDate(payment) < dateKey
    ))
    .sort((left, right) => getIncomeDate(left).localeCompare(getIncomeDate(right)) || left.createdAt.localeCompare(right.createdAt));
}

export function buildDeliveredFromPreviousRows(payments: Payment[], dateKey: string): Payment[] {
  return payments
    .filter((payment) => (
      payment.moneyDelivered === true &&
      payment.moneyDeliveryDate === dateKey &&
      getDailyIncomeStatus(payment) !== "non_cash" &&
      getIncomeDate(payment) < dateKey
    ))
    .sort((left, right) => getIncomeDate(left).localeCompare(getIncomeDate(right)) || left.createdAt.localeCompare(right.createdAt));
}

export function getDailyIncomeDestination(payment: Payment): { key: string; label: string; accountNumber?: string } {
  if (payment.paymentMethod === "Efectivo") return payment.moneyDelivered === false
    ? { key: "cash-pending", label: "Efectivo pendiente de entrega" }
    : { key: "cash", label: "Efectivo" };
  if (payment.paymentMethod === "Tarjeta" && !payment.fundsReceivedDate) {
    return { key: "card-pending", label: "Tarjeta pendiente de acreditación" };
  }
  if (payment.paymentMethod === "Descuento" || payment.paymentMethod === "Referido") {
    return { key: `non-cash:${payment.paymentMethod}`, label: `${payment.paymentMethod} (sin entrada de dinero)` };
  }
  if (BANK_PAYMENT_METHODS.has(payment.paymentMethod) || payment.paymentMethod === "Tarjeta") {
    const account = payment.bankAccountNumber?.trim();
    const masked = maskAccountNumber(account);
    return account
      ? { key: `bank:${account}`, label: `${payment.bankGroupCode || "Cuenta bancaria"} ${masked}`.trim(), accountNumber: account }
      : { key: "bank:unknown", label: "Cuenta no identificada" };
  }
  if (payment.paymentMethod === "YAPPY LM") {
    const account = payment.bankAccountNumber?.trim();
    return account
      ? { key: `yappy:${account}`, label: `Yappy LM ${maskAccountNumber(account)}`, accountNumber: account }
      : { key: "yappy", label: "Yappy LM" };
  }
  return { key: `method:${payment.paymentMethod}`, label: payment.paymentMethod };
}

export function buildDailyIncomeGroups(payments: Payment[], dateKey: string): DailyIncomeGroup[] {
  const groups = new Map<string, DailyIncomeGroup>();
  for (const payment of payments) {
    if (getDailyIncomeReportDate(payment) !== dateKey) continue;
    const destination = getDailyIncomeDestination(payment);
    const status = getDailyIncomeStatus(payment);
    const existing = groups.get(destination.key);
    if (existing) {
      existing.payments.push(payment);
      existing.total += payment.amountReceived;
    } else {
      groups.set(destination.key, {
        ...destination,
        status,
        payments: [payment],
        total: payment.amountReceived
      });
    }
  }
  return [...groups.values()].sort((left, right) => {
    const order = { received: 0, pending: 1, non_cash: 2 };
    return order[left.status] - order[right.status] || right.total - left.total || left.label.localeCompare(right.label);
  });
}
