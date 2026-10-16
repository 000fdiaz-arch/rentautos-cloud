import { formatCurrency } from "../../format";
import type { ReceivableRow } from "../../receivables";
import type { Client, LateFeeSettings } from "../../types";
import { isLateFeeOtherCharge } from "../payments/paymentRules";

export type ReceivableRiskSignalKind = "new_client" | "repeated_underpayment" | "charges";

export type ReceivableRiskSignal = {
  kind: ReceivableRiskSignalKind;
  title: string;
  message: string;
  valueLabel?: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const NEW_CLIENT_FIRST_PAYMENT_DAYS = 30;
const NEW_CLIENT_FEW_PAYMENTS_DAYS = 90;
const FEW_PAYMENTS_MAX = 3;
const REPEATED_UNDERPAYMENT_MIN = 2;

function elapsedDays(value: string | undefined, now: Date): number | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / DAY_MS));
}

function activeCollectibleRow(row: ReceivableRow): boolean {
  const status = (row.operationalStatus ?? "activo").trim().toLowerCase();
  return row.hasActiveClient && (status === "activo" || status === "provisional_rental");
}

function newClientSignal(row: ReceivableRow, now: Date): ReceivableRiskSignal | null {
  if (!activeCollectibleRow(row)) return null;
  const tenureDays = elapsedDays(row.clientCreatedAt, now);
  if (tenureDays === null) return null;
  const rentPayments = row.recentPayments.filter((payment) => payment.appliedToRent > 0);
  const hasNoRecordedRentPayment = row.installmentsPaid === 0 && rentPayments.length === 0;

  if (tenureDays <= NEW_CLIENT_FIRST_PAYMENT_DAYS && hasNoRecordedRentPayment && row.overdueBalance > 0) {
    return {
      kind: "new_client",
      title: "Primer pago pendiente",
      message: `Cliente de ${tenureDays} día${tenureDays === 1 ? "" : "s"}; ya venció su primera letra y todavía no registra abono a renta.`,
      valueLabel: formatCurrency(row.overdueBalance)
    };
  }

  if (tenureDays <= NEW_CLIENT_FEW_PAYMENTS_DAYS && row.installmentsPaid >= 1 && row.installmentsPaid <= FEW_PAYMENTS_MAX) {
    return {
      kind: "new_client",
      title: "Cliente nuevo · pocas letras cubiertas",
      message: `Lleva ${row.installmentsPaid} letra${row.installmentsPaid === 1 ? "" : "s"} cubierta${row.installmentsPaid === 1 ? "" : "s"} en sus primeros ${tenureDays} días.`,
      valueLabel: `${row.installmentsPaid} de ${FEW_PAYMENTS_MAX}`
    };
  }

  return null;
}

function repeatedUnderpaymentSignal(row: ReceivableRow): ReceivableRiskSignal | null {
  if (!activeCollectibleRow(row) || row.rentAmount <= 0) return null;
  const rentPayments = row.recentPayments.filter((payment) => payment.appliedToRent > 0);
  const underpayments = rentPayments.filter((payment) => payment.appliedToRent + 0.01 < row.rentAmount);
  if (underpayments.length < REPEATED_UNDERPAYMENT_MIN) return null;
  const count = underpayments.length;
  return {
    kind: "repeated_underpayment",
    title: "Abonos bajos repetidos",
    message: `${count} de sus últimos ${rentPayments.length} abonos a renta fueron menores que la letra de ${formatCurrency(row.rentAmount)}.`,
    valueLabel: `${count} veces`
  };
}

export function pendingLateFeeAmountForClient(client: Client, lateFeeSettings: LateFeeSettings): number {
  return (client.otherCharges ?? [])
    .filter((charge) => isLateFeeOtherCharge(charge, lateFeeSettings))
    .reduce((total, charge) => total + Math.max(0, charge.amount), 0);
}

function chargesSignal(row: ReceivableRow, pendingLateFeeAmount: number): ReceivableRiskSignal | null {
  if (!row.hasActiveClient) return null;
  const surcharges = Math.max(0, pendingLateFeeAmount);
  const fines = Math.max(0, row.outstandingFineAmount ?? 0);
  const tickets = Math.max(0, row.outstandingTicketAmount ?? 0);
  const total = surcharges + fines + tickets;
  if (total <= 0) return null;

  const parts = [
    fines > 0 ? `multas/Panapass ${formatCurrency(fines)}` : "",
    tickets > 0 ? `boletas ${formatCurrency(tickets)}` : "",
    surcharges > 0 ? `recargos ${formatCurrency(surcharges)}` : ""
  ].filter(Boolean);

  return {
    kind: "charges",
    title: "Multas, boletas y recargos pendientes",
    message: parts.join(" · "),
    valueLabel: formatCurrency(total)
  };
}

export function receivableRiskSignalsForRow(
  row: ReceivableRow,
  now: Date,
  pendingLateFeeAmount = 0
): ReceivableRiskSignal[] {
  return [
    newClientSignal(row, now),
    repeatedUnderpaymentSignal(row),
    chargesSignal(row, pendingLateFeeAmount)
  ].filter((signal): signal is ReceivableRiskSignal => signal !== null);
}
