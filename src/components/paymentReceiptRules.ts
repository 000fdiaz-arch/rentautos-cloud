import { findNextChargeDay, isChargeDay, parseDateKey, startOfDay } from "../billing";
import type { Client, Payment } from "../types";

export type CoveredPaymentRow = { dateLabel: string; status: "complete" | "partial"; amount?: number };
export type PaymentBreakdownRow = { label: string; amount: number };

export function formatDateSpanish(dateStr: string): string {
  const parts = dateStr.split("-");
  if (parts.length !== 3) return dateStr;
  const weekdays = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
  const months = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const year = Number.parseInt(parts[0], 10);
  const month = Number.parseInt(parts[1], 10) - 1;
  const day = Number.parseInt(parts[2], 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return dateStr;
  return `${weekdays[new Date(`${dateStr}T12:00:00`).getDay()] ?? ""}\n${day} ${months[month] ?? ""} ${year}`.trim();
}

function formatCycle(date: Date, payment: Payment): string {
  const weekdays = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
  const months = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const day = String(date.getDate()).padStart(2, "0");
  const month = months[date.getMonth()] ?? "";
  if (payment.frequency === "biweekly") return `Quincena ${day} de ${month}`;
  if (payment.frequency === "monthly") return `Mensualidad ${day} de ${month}`;
  return `${weekdays[date.getDay()] ?? ""} ${day} de ${month}`.trim();
}

export function formatDateSpanishSingleLine(date: Date): string {
  const weekdays = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
  const months = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  return `${weekdays[date.getDay()] ?? ""} ${String(date.getDate()).padStart(2, "0")} de ${months[date.getMonth()] ?? ""}`.trim();
}

export function getPartialMissingLabel(row: CoveredPaymentRow, payment: Payment): string {
  if (payment.frequency === "biweekly") return "Falta para completar quincena";
  if (payment.frequency === "monthly") return "Falta para completar mensualidad";
  return `Falta para completar ${row.dateLabel.split(" ")[0].toLowerCase()}`;
}

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function diffDays(fromDate: Date, toDate: Date): number {
  return Math.round((startOfDay(toDate).getTime() - startOfDay(fromDate).getTime()) / 86_400_000);
}

function sameDate(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
}

export function getPaymentInstallmentsAgreedSnapshot(payment: Payment): number {
  const paid = Math.max(0, Math.floor(payment.installmentsPaidAfter ?? 0));
  const remaining = Math.max(0, Math.floor(payment.installmentsRemainingAfter ?? 0));
  return paid + remaining;
}

function asClient(payment: Payment, balance = payment.balanceAfter, advanceBalance = 0): Client {
  return {
    id: payment.clientId,
    unitId: payment.clientUnit,
    cedula: payment.clientCedula,
    name: payment.clientName,
    rentAmount: payment.rentAmount,
    frequency: payment.frequency,
    weeklyChargeDay: payment.weeklyChargeDay,
    monthlyChargeDay: payment.monthlyChargeDay,
    chargeFirstSunday: payment.chargeFirstSunday,
    firstSundayChargedAt: payment.firstSundayChargedAt,
    balance,
    advanceBalance,
    installmentsAgreed: getPaymentInstallmentsAgreedSnapshot(payment),
    installmentsRemaining: payment.installmentsRemainingAfter,
    installmentsPaid: payment.installmentsPaidAfter,
    otherCharges: [],
    savings: payment.savingsAfter,
    status: "activo",
    createdAt: payment.createdAt
  };
}

export function findNextPaymentDateForReceipt(payment: Payment): Date | null {
  if (!Number.isFinite(payment.rentAmount) || payment.rentAmount <= 0) return null;
  const paymentDate = startOfDay(new Date(`${payment.dateApplied}T12:00:00`));
  const advanceBalanceAfter = roundMoney(Math.max(0, payment.advanceBalanceAfter ?? payment.advanceApplied ?? 0));
  return findNextChargeDay(asClient(payment, payment.balanceAfter, advanceBalanceAfter), paymentDate);
}

export function isDebtChargeDayForReceipt(payment: Payment, date: Date): boolean {
  if (payment.frequency !== "daily") return isChargeDay(asClient(payment), date);
  const day = date.getDay();
  if (day >= 1 && day <= 6) return true;
  if (day !== 0) return false;
  const firstSunday = payment.firstSundayChargedAt ? parseDateKey(payment.firstSundayChargedAt) : null;
  if (firstSunday) return sameDate(date, firstSunday);
  return (payment.installmentsPaidAfter ?? 0) <= 7;
}

function debtStart(payment: Payment, balance: number, referenceDate: Date): Date | null {
  if (!Number.isFinite(payment.rentAmount) || payment.rentAmount <= 0) return null;
  let remaining = Math.max(0, Math.ceil(Math.max(0, balance) / payment.rentAmount));
  if (remaining === 0) return null;
  let cursor = startOfDay(referenceDate);
  for (let index = 0; index < 36600; index += 1) {
    if (isDebtChargeDayForReceipt(payment, cursor) && --remaining === 0) return cursor;
    const previous = new Date(cursor);
    previous.setDate(previous.getDate() - 1);
    cursor = previous;
  }
  return null;
}

export function findDebtStartDateForReceipt(payment: Payment, referenceDate: Date): Date | null {
  return debtStart(payment, payment.balanceAfter, referenceDate);
}

function chargeDates(startDate: Date | null, count: number, payment: Payment): Date[] {
  if (!startDate || count <= 0) return [];
  const dates: Date[] = [];
  let cursor = startOfDay(startDate);
  for (let index = 0; index < 36600 && dates.length < count; index += 1) {
    if (isDebtChargeDayForReceipt(payment, cursor)) dates.push(new Date(cursor));
    const next = new Date(cursor);
    next.setDate(next.getDate() + 1);
    cursor = next;
  }
  return dates;
}

export function buildCoveredPaymentRows(payment: Payment): CoveredPaymentRow[] {
  const rent = roundMoney(Math.max(0, payment.rentAmount));
  if (rent <= 0) return [];
  const fromDebt = Math.max(0, payment.installmentsFromDebt ?? payment.installmentsDeducted ?? 0);
  const fromAdvance = Math.max(0, payment.installmentsFromAdvance ?? Math.floor((payment.advanceApplied ?? 0) / rent));
  const paymentDate = startOfDay(new Date(`${payment.dateApplied}T12:00:00`));
  const rows: CoveredPaymentRow[] = chargeDates(debtStart(payment, payment.balanceBefore, paymentDate), fromDebt, payment)
    .map((date) => ({ dateLabel: formatCycle(date, payment), status: "complete" as const }));
  const client = asClient(payment, payment.balanceAfter, 0);
  let nextAdvanceDate = fromAdvance > 0 ? findNextChargeDay(client, paymentDate) : null;
  for (let index = 0; index < fromAdvance && nextAdvanceDate; index += 1) {
    rows.push({ dateLabel: formatCycle(nextAdvanceDate, payment), status: "complete" });
    nextAdvanceDate = findNextChargeDay(client, new Date(nextAdvanceDate));
  }
  const partialDebt = roundMoney(Math.max(0, payment.balanceAfter) % rent);
  if (payment.appliedToRent > 0 && partialDebt > 0) {
    const date = debtStart(payment, payment.balanceAfter, paymentDate);
    rows.push({ dateLabel: date ? formatCycle(date, payment) : "Cuenta pendiente", status: "partial", amount: roundMoney(rent - partialDebt) });
  } else {
    const advanceApplied = roundMoney(Math.max(0, payment.advanceApplied ?? 0));
    const remainder = roundMoney(Math.max(0, payment.advanceBalanceAfter ?? advanceApplied) % rent);
    if (advanceApplied > 0 && remainder > 0) {
      const date = findNextChargeDay(client, paymentDate);
      rows.push({ dateLabel: date ? formatCycle(date, payment) : "Próxima cuenta", status: "partial", amount: remainder });
    }
  }
  return rows.slice(0, 4);
}

export function buildRentPaymentBreakdownRows(payment: Payment): PaymentBreakdownRow[] {
  const rent = roundMoney(Math.max(0, payment.rentAmount));
  const applied = roundMoney(Math.max(0, payment.appliedToRent));
  if (rent <= 0 || applied <= 0) return [];
  const paymentDate = startOfDay(new Date(`${payment.dateApplied}T12:00:00`));
  const rows: PaymentBreakdownRow[] = [];
  let remaining = applied;
  const debtBefore = roundMoney(Math.max(0, payment.balanceBefore));
  const debtApplied = roundMoney(Math.min(remaining, debtBefore));
  if (debtApplied > 0) {
    const dates = chargeDates(debtStart(payment, debtBefore, paymentDate), Math.ceil((debtBefore + Number.EPSILON) / rent), payment);
    const oldestPartial = roundMoney(debtBefore % rent);
    let debtRemaining = debtApplied;
    dates.forEach((date, index) => {
      if (debtRemaining <= 0) return;
      const amount = roundMoney(Math.min(index === 0 && oldestPartial > 0 ? oldestPartial : rent, debtRemaining));
      if (amount > 0) rows.push({ label: formatCycle(date, payment), amount });
      debtRemaining = roundMoney(debtRemaining - amount);
    });
    remaining = roundMoney(remaining - debtApplied);
  }
  let advanceRemaining = roundMoney(Math.min(remaining, Math.max(0, payment.advanceApplied ?? 0)));
  let nextDate = advanceRemaining > 0 ? findNextChargeDay(asClient(payment), paymentDate) : null;
  while (advanceRemaining > 0 && nextDate) {
    const amount = roundMoney(Math.min(rent, advanceRemaining));
    rows.push({ label: formatCycle(nextDate, payment), amount });
    advanceRemaining = roundMoney(advanceRemaining - amount);
    nextDate = findNextChargeDay(asClient(payment), new Date(nextDate));
  }
  return rows.length > 0 ? rows : [{ label: "A renta", amount: applied }];
}

function sanitizeFileToken(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
}

function fileDate(date: string): string {
  const [year, month, day] = date.split("-");
  return year && month && day ? `${day}_${month}_${year}` : date.replace(/-/g, "_");
}

export function buildReceiptFileName(payment: Payment): string {
  const unit = sanitizeFileToken(payment.clientUnit || "UNIDAD");
  const receipt = sanitizeFileToken(payment.receiptNumber || "RECIBO");
  return `${unit}-${receipt}-${fileDate(payment.dateApplied)}.png`;
}

export function buildZipFileName(payments: Payment[]): string {
  if (payments.length === 0) return "recibos-pagos.png.zip";
  const dates = payments.map((payment) => payment.dateApplied).sort();
  const from = fileDate(dates[0] ?? "");
  const to = fileDate(dates[dates.length - 1] ?? "");
  return from === to ? `recibos-${from}-${payments.length}.png.zip` : `recibos-${from}-a-${to}-${payments.length}.png.zip`;
}

export function extractFolio(reference: string): string {
  const trimmed = reference.trim();
  if (!trimmed) return "";
  const explicit = trimmed.match(/folio\s*[:#-]?\s*([A-Za-z0-9-]+)/i);
  if (explicit?.[1]) return explicit[1];
  const tokens = trimmed.match(/[A-Za-z0-9-]+/g);
  return tokens?.[tokens.length - 1] ?? trimmed;
}
