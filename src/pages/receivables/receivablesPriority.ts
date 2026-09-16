import { parseDateKey, startOfDay } from "../../billing";
import type { ReceivableRow } from "../../receivables";
import type { Client, Payment } from "../../types";
import type { CollectionStatusRecord, RouteUrgency } from "./receivablesTypes";

export type ReceivablePriorityLevel = "critical" | "high" | "medium" | "low";
export type PriorityTenureBucket = "up_to_30" | "one_to_three" | "three_to_six" | "six_to_twelve" | "one_year_plus";

export type PriorityPaymentCharge = {
  label: string;
  amount: number;
};

export type PriorityPaymentSummary = {
  dateApplied: string;
  amountReceived: number;
  appliedToRent: number;
  otherCharges: PriorityPaymentCharge[];
};

export type PriorityReceivable = {
  row: ReceivableRow;
  client: Client;
  level: ReceivablePriorityLevel;
  score: number;
  isEstablishedClient: boolean;
  tenureStart: Date;
  tenureDays: number;
  generatedInstallments: number;
  installmentEquivalent: number;
  actionRatio: number;
  debtCap?: number;
  capExceededBy: number;
  lastPayment: PriorityPaymentSummary | null;
  reason: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const ESTABLISHED_CLIENT_MONTHS = 6;

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function dateOnly(value: Date): Date {
  return startOfDay(value);
}

function addCalendarMonths(value: Date, months: number): Date {
  const targetMonth = value.getMonth() + months;
  const targetYear = value.getFullYear() + Math.floor(targetMonth / 12);
  const normalizedMonth = ((targetMonth % 12) + 12) % 12;
  const lastDay = new Date(targetYear, normalizedMonth + 1, 0).getDate();
  return new Date(targetYear, normalizedMonth, Math.min(value.getDate(), lastDay));
}

function calendarDaysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.round((dateOnly(to).getTime() - dateOnly(from).getTime()) / DAY_MS));
}

function addCalendarDays(value: Date, days: number): Date {
  const result = dateOnly(value);
  result.setDate(result.getDate() + days);
  return result;
}

function generatedInstallmentTenureStart(client: Client, today: Date, issued: number): Date {
  if (issued <= 0) return today;
  if (client.frequency === "monthly") return addCalendarMonths(today, -issued);

  // This is a plan-equivalent age: 109 generated weekly installments are 109 weeks,
  // even when a migrated first-charge date is newer or incomplete.
  const equivalentDays = client.frequency === "weekly"
    ? issued * 7
    : client.frequency === "biweekly"
      ? Math.round(issued * (365.2425 / 24))
      : Math.round(issued * (7 / 6));
  return addCalendarDays(today, -equivalentDays);
}

export function priorityGeneratedInstallments(client: Client): number {
  const paidInstallments = Math.max(0, Math.floor(client.installmentsPaid ?? 0));
  const balanceCents = Math.max(0, Math.round((client.balance ?? 0) * 100));
  const rentCents = Math.round((client.rentAmount ?? 0) * 100);
  const pendingInstallments = rentCents > 0 ? Math.ceil(balanceCents / rentCents) : 0;
  return paidInstallments + pendingInstallments;
}

function establishedInstallmentThreshold(client: Client): number {
  if (client.frequency === "daily") return 26 * 6;
  if (client.frequency === "weekly") return 26;
  if (client.frequency === "biweekly") return 12;
  return ESTABLISHED_CLIENT_MONTHS;
}

export function priorityTenureBucket(tenureDays: number): PriorityTenureBucket {
  if (tenureDays <= 30) return "up_to_30";
  if (tenureDays <= 90) return "one_to_three";
  if (tenureDays < 183) return "three_to_six";
  if (tenureDays < 365) return "six_to_twelve";
  return "one_year_plus";
}

function newnessPriorityRank(tenureDays: number): number {
  const bucket = priorityTenureBucket(tenureDays);
  if (bucket === "up_to_30") return 5;
  if (bucket === "one_to_three") return 4;
  if (bucket === "three_to_six") return 3;
  if (bucket === "six_to_twelve") return 2;
  return 1;
}

function normalizeIdentity(value: string | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function normalizeUnit(value: string | undefined): string {
  return normalizeIdentity(value).replace(/[^a-z0-9]/g, "");
}

function paymentMatchesRow(payment: Payment, row: ReceivableRow): boolean {
  if (payment.clientId === row.id) return true;
  if (normalizeUnit(payment.clientUnit) !== normalizeUnit(row.unitId)) return false;
  if (row.cedula && row.cedula !== "-" && payment.clientCedula) {
    return row.cedula.replace(/\D/g, "") === payment.clientCedula.replace(/\D/g, "");
  }
  return normalizeIdentity(payment.clientName) === normalizeIdentity(row.name);
}

function paymentTimestamp(payment: Payment): number {
  const created = new Date(payment.createdAt).getTime();
  if (Number.isFinite(created)) return created;
  return parseDateKey(payment.dateApplied)?.getTime() ?? 0;
}

function readableChargeLabel(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim().toLocaleLowerCase("es");
  return normalized ? normalized.charAt(0).toLocaleUpperCase("es") + normalized.slice(1) : "Otros cargos";
}

function latestPaymentForRow(row: ReceivableRow, payments: Payment[]): PriorityPaymentSummary | null {
  const payment = payments
    .filter((item) => paymentMatchesRow(item, row))
    .sort((left, right) => paymentTimestamp(right) - paymentTimestamp(left))[0];
  if (!payment) {
    const snapshot = row.recentPayments[0];
    return snapshot ? {
      dateApplied: snapshot.dateApplied,
      amountReceived: snapshot.amountReceived,
      appliedToRent: snapshot.appliedToRent,
      otherCharges: []
    } : null;
  }

  const charges = [
    ...(payment.otherChargesApplied ?? []),
    ...(payment.finesApplied ?? []),
    ...(payment.ticketsApplied ?? [])
  ].filter((charge) => charge.amount > 0);
  const groupedCharges = new Map<string, number>();
  for (const charge of charges) {
    const label = readableChargeLabel(charge.label);
    groupedCharges.set(label, roundMoney((groupedCharges.get(label) ?? 0) + charge.amount));
  }
  const otherCharges = [...groupedCharges.entries()].map(([label, amount]) => ({ label, amount }));
  const visiblePaymentTotal = roundMoney(Math.max(0, payment.amountReceived - Math.max(0, payment.centavosAhorro ?? 0)));
  const explainedTotal = roundMoney(Math.max(0, payment.appliedToRent) + otherCharges.reduce((sum, charge) => sum + charge.amount, 0));
  const unexplained = roundMoney(Math.max(0, visiblePaymentTotal - explainedTotal));
  if (unexplained >= 1) otherCharges.push({ label: "Otros", amount: unexplained });

  return {
    dateApplied: payment.dateApplied,
    amountReceived: visiblePaymentTotal,
    appliedToRent: roundMoney(Math.max(0, payment.appliedToRent)),
    otherCharges
  };
}

function oldClientToleranceDays(row: ReceivableRow): number {
  if (row.plan === "daily" || row.plan === "weekly") return 7;
  return 5;
}

function priorityLevel(actionRatio: number, installmentEquivalent: number, capRatio: number): ReceivablePriorityLevel {
  if (capRatio >= 1 || actionRatio >= 2 || installmentEquivalent >= 6) return "critical";
  if (actionRatio >= 1 || installmentEquivalent >= 3) return "high";
  if (actionRatio >= 0.5 || installmentEquivalent >= 2) return "medium";
  return "low";
}

function priorityReason(
  row: ReceivableRow,
  isEstablishedClient: boolean,
  installmentEquivalent: number,
  toleranceDays: number,
  capExceededBy: number
): string {
  const installmentText = installmentEquivalent.toLocaleString("es-PA", { maximumFractionDigits: 1 });
  const base = !isEstablishedClient && row.plan === "daily"
    ? `Cliente nuevo diario: ${installmentText} cuotas equivalentes frente al punto de acción de 2.`
    : `${isEstablishedClient ? "Cliente antiguo" : "Cliente nuevo"}: ${row.daysLate} días de atraso frente a ${toleranceDays} día${toleranceDays === 1 ? "" : "s"} de tolerancia.`;
  return capExceededBy > 0
    ? `${base} Además, supera su tope de renta vencida por ${formatWholeCurrency(capExceededBy)}.`
    : base;
}

export function buildPriorityReceivables(
  rows: ReceivableRow[],
  clients: Client[],
  payments: Payment[],
  statusByClient: Record<string, CollectionStatusRecord>,
  now: Date
): PriorityReceivable[] {
  const today = dateOnly(now);
  const clientsById = new Map(clients.map((client) => [client.id, client]));

  return rows.flatMap((row): PriorityReceivable[] => {
    const client = clientsById.get(row.id);
    if (
      !client ||
      !row.hasActiveClient ||
      client.status.toLowerCase() !== "activo" ||
      (row.operationalStatus ?? client.status).toLowerCase() !== "activo"
    ) return [];
    if (!(row.overdueBalance > 0)) return [];

    const generatedInstallments = priorityGeneratedInstallments(client);
    const tenureStart = generatedInstallmentTenureStart(client, today, generatedInstallments);
    const isEstablishedClient = generatedInstallments >= establishedInstallmentThreshold(client);
    const tenureDays = calendarDaysBetween(tenureStart, today);
    const installmentEquivalent = row.rentAmount > 0 ? row.overdueBalance / row.rentAmount : 0;
    const toleranceDays = isEstablishedClient
      ? oldClientToleranceDays(row)
      : row.plan === "daily" ? 0 : 1;
    const actionRatio = !isEstablishedClient && row.plan === "daily"
      ? installmentEquivalent / 2
      : row.daysLate / Math.max(1, toleranceDays);
    const configuredCap = statusByClient[row.id]?.priorityDebtCap;
    const debtCap = typeof configuredCap === "number" && configuredCap > 0 ? configuredCap : undefined;
    const capRatio = debtCap ? row.overdueBalance / debtCap : 0;
    const capExceededBy = debtCap ? roundMoney(Math.max(0, row.overdueBalance - debtCap)) : 0;
    const level = priorityLevel(actionRatio, installmentEquivalent, capRatio);
    const score = newnessPriorityRank(tenureDays) * 1_000_000_000
      + row.overdueBalance * 1_000
      + row.daysLate;

    return [{
      row,
      client,
      level,
      score,
      isEstablishedClient,
      tenureStart,
      tenureDays,
      generatedInstallments,
      installmentEquivalent,
      actionRatio,
      debtCap,
      capExceededBy,
      lastPayment: latestPaymentForRow(row, payments),
      reason: priorityReason(row, isEstablishedClient, installmentEquivalent, Math.max(1, toleranceDays), capExceededBy)
    }];
  }).sort((left, right) => (
    newnessPriorityRank(right.tenureDays) - newnessPriorityRank(left.tenureDays) ||
    right.row.overdueBalance - left.row.overdueBalance ||
    right.row.daysLate - left.row.daysLate ||
    right.actionRatio - left.actionRatio ||
    left.row.unitId.localeCompare(right.row.unitId, "es", { numeric: true })
  ));
}

export function routeUrgencyForPriority(level: ReceivablePriorityLevel): RouteUrgency {
  if (level === "critical") return "very_urgent";
  if (level === "high") return "urgent";
  return "normal";
}

export function formatWholeCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(value);
}

function calendarDurationParts(from: Date, to: Date): { years: number; months: number; days: number } {
  const start = dateOnly(from);
  const end = dateOnly(to);
  if (start >= end) return { years: 0, months: 0, days: 0 };
  let cursor = start;
  let years = 0;
  while (true) {
    const next = addCalendarMonths(cursor, 12);
    if (next > end) break;
    cursor = next;
    years += 1;
  }
  let months = 0;
  while (true) {
    const next = addCalendarMonths(cursor, 1);
    if (next > end) break;
    cursor = next;
    months += 1;
  }
  return { years, months, days: calendarDaysBetween(cursor, end) };
}

function joinDurationParts(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "0 días";
  return `${parts.slice(0, -1).join(", ")} y ${parts[parts.length - 1]}`;
}

export function formatCalendarDuration(from: Date, to: Date): string {
  const { years, months, days } = calendarDurationParts(from, to);
  const parts: string[] = [];
  if (years > 0) parts.push(`${years} año${years === 1 ? "" : "s"}`);
  if (months > 0) parts.push(`${months} mes${months === 1 ? "" : "es"}`);
  if (days > 0 || parts.length === 0) parts.push(`${days} día${days === 1 ? "" : "s"}`);
  return joinDurationParts(parts);
}

export function priorityPaymentDaysAgo(payment: PriorityPaymentSummary | null, now: Date): number | null {
  if (!payment) return null;
  const paymentDate = parseDateKey(payment.dateApplied);
  return paymentDate ? calendarDaysBetween(paymentDate, now) : null;
}

export function formatElapsedPayment(dateApplied: string, now: Date): string {
  const paymentDate = parseDateKey(dateApplied);
  if (!paymentDate) return "en fecha desconocida";
  const days = calendarDaysBetween(paymentDate, now);
  if (days === 0) return "hoy";
  if (days === 1) return "ayer";
  if (days < 30) return `hace ${days} días`;
  return `hace ${formatCalendarDuration(paymentDate, now)}`;
}

export type InstallmentDebtSummary = {
  installmentText: string;
  partialPaymentText: string | null;
};

export function summarizeInstallmentDebt(overdueBalance: number, rentAmount: number): InstallmentDebtSummary | null {
  const balanceCents = Math.max(0, Math.round(overdueBalance * 100));
  const rentCents = Math.round(rentAmount * 100);
  if (!(balanceCents > 0) || !(rentCents > 0)) return null;
  const wholeInstallments = Math.floor(balanceCents / rentCents);
  const remainderCents = balanceCents % rentCents;
  const affectedInstallments = wholeInstallments + (remainderCents > 0 ? 1 : 0);
  return {
    installmentText: `${affectedInstallments} cuota${affectedInstallments === 1 ? "" : "s"}`,
    partialPaymentText: remainderCents > 0
      ? `con ${formatWholeCurrency(remainderCents / 100)} baja una cuota`
      : null
  };
}

export function formatInstallmentDebt(overdueBalance: number, rentAmount: number): string {
  const summary = summarizeInstallmentDebt(overdueBalance, rentAmount);
  if (!summary) return "";
  return summary.partialPaymentText
    ? `${summary.installmentText}; ${summary.partialPaymentText}`
    : summary.installmentText;
}

export function formatPriorityPayment(payment: PriorityPaymentSummary | null, now: Date): string {
  if (!payment) return "Sin pagos registrados";
  const elapsed = formatElapsedPayment(payment.dateApplied, now);
  const rent = Math.max(0, payment.appliedToRent);
  const visibleRent = Math.round(rent) > 0;
  const charges = payment.otherCharges.filter((charge) => Math.round(Math.max(0, charge.amount)) > 0);
  if (charges.length === 0) {
    return visibleRent
      ? `Pagó ${elapsed} ${formatWholeCurrency(rent)} a renta`
      : `Pago registrado ${elapsed}`;
  }
  const parts = [
    visibleRent ? `${formatWholeCurrency(rent)} a renta` : "",
    ...charges.map((charge) => `${formatWholeCurrency(charge.amount)} a ${charge.label}`)
  ].filter(Boolean);
  return `Pagó ${elapsed} ${formatWholeCurrency(payment.amountReceived)}: ${parts.join(" y ")}`;
}
