import { parseDateKey, startOfDay, toDateKey } from "../../billing";
import type { Client, OtherCharge } from "../../types";
import { CASH_CLOSINGS_KEY } from "./clientConstants";
import type { ClientForm, OtherChargeForm } from "./clientTypes";

export function parseNumberOrNull(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseIntegerOrNull(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && Number.isInteger(parsed) ? parsed : null;
}

export function createOtherChargeForm(initial?: Partial<OtherChargeForm>): OtherChargeForm {
  const today = toDateKey(new Date());
  return {
    id: initial?.id?.trim() || crypto.randomUUID(),
    label: initial?.label ?? "",
    amount: initial?.amount ?? "",
    createdAt: initial ? initial.createdAt ?? "" : today
  };
}

export function normalizePersonName(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase().replace(/\s+/g, " ");
}

export function normalizePhoneDigits(value: string): string {
  return value.replace(/\D/g, "");
}

export function formatPaymentDateKey(dateKey: string): string {
  const parsed = parseDateKey(dateKey);
  if (!parsed) return dateKey;
  const month = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"][parsed.getMonth()];
  return `${String(parsed.getDate()).padStart(2, "0")}/${month}/${parsed.getFullYear()}`;
}

export function operationalToneClass(value: Client["status"]): string {
  if (value === "activo") return "control-op-badge control-op-badge--activo";
  if (value === "taller") return "control-op-badge control-op-badge--taller";
  if (value === "chapisteria") return "control-op-badge control-op-badge--chapisteria";
  if (value === "custodia") return "control-op-badge control-op-badge--custodia";
  return "control-op-badge control-op-badge--archivado";
}

export function getOperationalReferenceDate(now: Date): Date {
  const today = startOfDay(now);
  try {
    const raw = window.localStorage.getItem(CASH_CLOSINGS_KEY);
    if (!raw) return today;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return today;
    const dates = parsed
      .map((item) => item && typeof item === "object" && typeof (item as Record<string, unknown>).date === "string"
        ? String((item as Record<string, unknown>).date).trim()
        : ""
      )
      .filter(Boolean)
      .sort();
    const latest = dates[dates.length - 1];
    const latestDate = latest ? parseDateKey(latest) : null;
    if (!latestDate) return today;
    latestDate.setDate(latestDate.getDate() + 1);
    return startOfDay(latestDate);
  } catch {
    return today;
  }
}

export function hasBillingScheduleChanged(existing: Client, form: ClientForm): boolean {
  if ((existing.firstChargeDate ?? "") !== form.firstChargeDate.trim()) return true;
  if (existing.frequency !== form.frequency) return true;
  if (form.frequency === "daily") return (existing.chargeFirstSunday ?? false) !== form.chargeFirstSunday;
  if (form.frequency === "weekly") return (existing.weeklyChargeDay ?? "monday") !== form.weeklyChargeDay;
  if (form.frequency === "monthly") return (existing.monthlyChargeDay ?? 1) !== Number(form.monthlyChargeDay);
  return false;
}

const WEEKLY_DAY_INDEX: Record<ClientForm["weeklyChargeDay"], number> = {
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6
};

const WEEKLY_DAY_LABEL: Record<ClientForm["weeklyChargeDay"], string> = {
  monday: "lunes",
  tuesday: "martes",
  wednesday: "miercoles",
  thursday: "jueves",
  friday: "viernes",
  saturday: "sabado"
};

type FirstChargeSchedule = Pick<
  ClientForm,
  "firstChargeDate" | "frequency" | "chargeFirstSunday" | "weeklyChargeDay" | "monthlyChargeDay"
>;

function sameCalendarDate(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate();
}

function adjustedMonthlyDate(year: number, monthIndex: number, monthlyChargeDay: number): Date {
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  const date = new Date(year, monthIndex, Math.min(monthlyChargeDay, lastDay));
  if (date.getDay() === 0) date.setDate(date.getDate() + 1);
  return date;
}

function isMonthlyScheduleDate(date: Date, monthlyChargeDay: number): boolean {
  const currentMonth = adjustedMonthlyDate(date.getFullYear(), date.getMonth(), monthlyChargeDay);
  return sameCalendarDate(currentMonth, date);
}

export function getFirstChargeDatePlanError(schedule: FirstChargeSchedule): string | null {
  const date = parseDateKey(schedule.firstChargeDate.trim());
  if (!date) return null;

  if (schedule.frequency === "daily") {
    if (date.getDay() !== 0 || schedule.chargeFirstSunday) return null;
    return "Para el plan diario, la fecha de primer cobro debe caer de lunes a sabado. Habilita el primer domingo para usar esa fecha.";
  }

  if (schedule.frequency === "weekly") {
    if (date.getDay() === WEEKLY_DAY_INDEX[schedule.weeklyChargeDay]) return null;
    return `Para el plan semanal, la fecha de primer cobro debe caer ${WEEKLY_DAY_LABEL[schedule.weeklyChargeDay]}.`;
  }

  if (schedule.frequency === "biweekly") {
    const day = date.getDate();
    const isFebruary = date.getMonth() === 1;
    const isFebruaryEnd = isFebruary && day === new Date(date.getFullYear(), 2, 0).getDate();
    if (day === 15 || day === 30 || isFebruaryEnd) return null;
    return "Para el plan quincenal, la fecha de primer cobro debe ser dia 15 o 30; en febrero puede ser el ultimo dia del mes.";
  }

  const monthlyChargeDay = Number(schedule.monthlyChargeDay);
  if (!Number.isInteger(monthlyChargeDay) || monthlyChargeDay < 1 || monthlyChargeDay > 31) return null;
  if (isMonthlyScheduleDate(date, monthlyChargeDay)) return null;
  return `Para el plan mensual, la fecha de primer cobro debe coincidir con el dia ${monthlyChargeDay}, o con el lunes siguiente si cae domingo.`;
}

export function clearIncompatibleFirstChargeDate(
  current: ClientForm,
  changes: Partial<Pick<ClientForm, "frequency" | "chargeFirstSunday" | "weeklyChargeDay" | "monthlyChargeDay">>
): ClientForm {
  const next = { ...current, ...changes };
  if (!next.firstChargeDate.trim() || !getFirstChargeDatePlanError(next)) return next;
  return { ...next, firstChargeDate: "" };
}

export function findFirstCompatibleChargeDate(schedule: FirstChargeSchedule, fromDateKey: string): string {
  const start = parseDateKey(fromDateKey);
  if (!start) return fromDateKey;
  for (let offset = 0; offset < 370; offset += 1) {
    const candidate = new Date(start);
    candidate.setDate(candidate.getDate() + offset);
    const candidateKey = toDateKey(candidate);
    if (!getFirstChargeDatePlanError({ ...schedule, firstChargeDate: candidateKey })) return candidateKey;
  }
  return fromDateKey;
}

export function hasContractTermsChanged(existing: Client, form: ClientForm): boolean {
  return hasBillingScheduleChanged(existing, form) ||
    existing.rentAmount !== Number(form.rentAmount) ||
    existing.installmentsAgreed !== Number(form.installmentsAgreed);
}

export function calculateIssuedInstallmentsForContract(form: ClientForm): number {
  const paid = Math.max(0, Math.floor(Number(form.installmentsPaid) || 0));
  const balance = Math.max(0, Number(form.initialBalance) || 0);
  const rent = Number(form.rentAmount);
  const debtCycles = Number.isFinite(rent) && rent > 0 ? Math.ceil(balance / rent) : 0;
  return paid + debtCycles;
}

export function buildClient(
  form: ClientForm,
  existing?: Client,
  options?: { resetInstallmentsIssued?: boolean }
): Client {
  const otherCharges: OtherCharge[] = form.otherCharges
    .filter((charge) => charge.label.trim() && parseNumberOrNull(charge.amount) !== null)
    .map((charge) => ({
      id: charge.id.trim() || crypto.randomUUID(),
      label: charge.label.trim(),
      amount: Number(charge.amount),
      createdAt: charge.createdAt || undefined
    }));
  const now = new Date();
  const todayKey = toDateKey(now);
  const normalizedFirstChargeDate = form.firstChargeDate.trim() || existing?.firstChargeDate || todayKey;
  const firstChargeDate = parseDateKey(normalizedFirstChargeDate) ? normalizedFirstChargeDate : todayKey;
  const firstChargeAnchor = parseDateKey(firstChargeDate) ?? startOfDay(now);
  const firstChargeLastDate = toDateKey(new Date(
    firstChargeAnchor.getFullYear(),
    firstChargeAnchor.getMonth(),
    firstChargeAnchor.getDate() - 1
  ));
  const balance = Number(form.initialBalance);
  const installmentsAgreed = Number(form.installmentsAgreed);
  const installmentsIssued = options?.resetInstallmentsIssued
    ? calculateIssuedInstallmentsForContract(form)
    : Number(form.installmentsIssued);
  const client: Client = {
    id: existing?.id ?? crypto.randomUUID(),
    unitId: form.unitId.trim(),
    cedula: form.cedula.trim() || undefined,
    name: form.name.trim(),
    whatsAppPhone: normalizePhoneDigits(form.whatsAppPhone) || undefined,
    rentAmount: Number(form.rentAmount),
    frequency: form.frequency,
    chargeFirstSunday: form.frequency === "daily" && form.chargeFirstSunday,
    firstSundayChargedAt: existing?.firstSundayChargedAt,
    balance,
    travelFundBalance: Number(form.travelFundBalance),
    // A manually assigned pending balance replaces any previously recorded
    // credit. This keeps the account from showing debt and credit at once.
    advanceBalance: balance > 0 ? 0 : existing?.advanceBalance ?? 0,
    savings: existing?.savings ?? 0,
    installmentsAgreed,
    installmentsIssued,
    installmentsIssuedEstimateNeedsReview: installmentsIssued > installmentsAgreed,
    installmentsRemaining: Number(form.installmentsRemaining),
    installmentsPaid: Number(form.installmentsPaid),
    otherCharges,
    createdAt: existing?.createdAt ?? now.toISOString(),
    firstChargeDate,
    lastChargeDate: existing && !hasBillingScheduleChanged(existing, form)
      ? existing.lastChargeDate ?? firstChargeLastDate
      : firstChargeLastDate,
    archivedAt: existing?.archivedAt,
    status: existing?.status ?? "activo",
    statusComment: existing?.statusComment
  };
  if (form.frequency === "weekly") client.weeklyChargeDay = form.weeklyChargeDay;
  if (form.frequency === "monthly") client.monthlyChargeDay = Number(form.monthlyChargeDay);
  return client;
}
