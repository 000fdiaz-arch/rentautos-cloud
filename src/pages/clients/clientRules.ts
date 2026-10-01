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

function hasBillingScheduleChanged(existing: Client, form: ClientForm): boolean {
  if ((existing.firstChargeDate ?? "") !== form.firstChargeDate.trim()) return true;
  if (existing.frequency !== form.frequency) return true;
  if (form.frequency === "daily") return (existing.chargeFirstSunday ?? false) !== form.chargeFirstSunday;
  if (form.frequency === "weekly") return (existing.weeklyChargeDay ?? "monday") !== form.weeklyChargeDay;
  if (form.frequency === "monthly") return (existing.monthlyChargeDay ?? 1) !== Number(form.monthlyChargeDay);
  return false;
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
