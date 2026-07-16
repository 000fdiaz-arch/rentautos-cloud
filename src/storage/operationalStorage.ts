import type {
  BankRule,
  BillingFrequency,
  LateFeeLedgerEntry,
  LateFeeReason,
  LateFeeSettings,
  LeadDecision,
  LeadEvaluation,
  ManualBankAssignmentAudit,
  OtherChargesRetentionByClient,
  PaymentPromise,
  PaymentPromiseStatus,
  PendingBankItem,
  PendingCardItem
} from "../types";

function parseFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseNonNegativeNumber(value: unknown): number {
  const parsed = parseFiniteNumber(value);
  return parsed === null || parsed < 0 ? 0 : parsed;
}

function normalizeUnitId(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function normalizeBillingFrequency(value: unknown): BillingFrequency {
  return value === "daily" || value === "weekly" || value === "biweekly" || value === "monthly"
    ? value
    : "daily";
}

function normalizeLateFeeReason(value: unknown): LateFeeReason | null {
  return value === "DAILY_MISSED_PROOF" || value === "WEEKLY_LATE_DAY" || value === "SCHEDULED_LATE_DAY" ? value : null;
}

// -- Pending Bank Items --

const PENDING_BANK_KEY = "cobrapp.module2.pending_bank.v1";
const PENDING_CARD_KEY = "cobrapp.module2.pending_card.v1";
const BANK_RULES_KEY = "cobrapp.settings.bank_rules.v1";
const MANUAL_ASSIGNMENT_AUDIT_KEY = "cobrapp.module2.manual_assignment_audit.v1";
const LATE_FEE_SETTINGS_KEY = "cobrapp.settings.late_fee_settings.v1";
const LATE_FEE_LEDGER_KEY = "cobrapp.module2.late_fee_ledger.v1";
const OTHER_CHARGES_RETENTION_KEY = "cobrapp.settings.other_charges_retention.v1";
const PAYMENT_PROMISES_KEY = "cobrapp.module3.payment_promises.v1";
const LEAD_EVALUATIONS_KEY = "cobrapp.module4.leads.v1";

export function loadPendingBankItems(): PendingBankItem[] {
  const raw = localStorage.getItem(PENDING_BANK_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is PendingBankItem => {
      if (!item || typeof item !== "object") return false;
      const r = item as Record<string, unknown>;
      return (
        typeof r.folio === "string" &&
        typeof r.dateApplied === "string" &&
        typeof r.amountReceived === "number" &&
        typeof r.importedAt === "string"
      );
    });
  } catch {
    return [];
  }
}

export function savePendingBankItems(items: PendingBankItem[]): void {
  localStorage.setItem(PENDING_BANK_KEY, JSON.stringify(items));
}

function normalizePendingCardItem(item: unknown): PendingCardItem | null {
  if (!item || typeof item !== "object") return null;
  const raw = item as Record<string, unknown>;
  if (
    typeof raw.id !== "string" ||
    typeof raw.folio !== "string" ||
    typeof raw.clientId !== "string" ||
    typeof raw.clientName !== "string" ||
    typeof raw.clientUnit !== "string" ||
    typeof raw.amountExpected !== "number" ||
    !Number.isFinite(raw.amountExpected) ||
    raw.amountExpected <= 0 ||
    typeof raw.dateRegistered !== "string" ||
    typeof raw.expectedSettlementDate !== "string" ||
    typeof raw.createdAt !== "string"
  ) {
    return null;
  }
  return {
    id: raw.id,
    appliedPaymentId: typeof raw.appliedPaymentId === "string" && raw.appliedPaymentId.trim() ? raw.appliedPaymentId : undefined,
    folio: raw.folio,
    clientId: raw.clientId,
    clientName: raw.clientName,
    clientUnit: raw.clientUnit,
    clientCedula: typeof raw.clientCedula === "string" && raw.clientCedula.trim() ? raw.clientCedula : undefined,
    amountExpected: raw.amountExpected,
    dateRegistered: raw.dateRegistered,
    expectedSettlementDate: raw.expectedSettlementDate,
    reference: typeof raw.reference === "string" && raw.reference.trim() ? raw.reference : undefined,
    createdAt: raw.createdAt
  };
}

export function loadPendingCardItems(): PendingCardItem[] {
  const raw = localStorage.getItem(PENDING_CARD_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => normalizePendingCardItem(item))
      .filter((item): item is PendingCardItem => item !== null);
  } catch {
    return [];
  }
}

export function savePendingCardItems(items: PendingCardItem[]): void {
  localStorage.setItem(PENDING_CARD_KEY, JSON.stringify(items));
}

function normalizeBankRule(item: unknown): BankRule | null {
  if (!item || typeof item !== "object") return null;
  const raw = item as Record<string, unknown>;
  const id = typeof raw.id === "string" && raw.id.trim() ? raw.id : crypto.randomUUID();
  const accountNumber = typeof raw.accountNumber === "string" ? raw.accountNumber.replace(/\D+/g, "") : "";
  const groupCode = typeof raw.groupCode === "string" ? raw.groupCode.trim().toUpperCase() : "";
  const createdAt = typeof raw.createdAt === "string" && raw.createdAt.trim() ? raw.createdAt : new Date().toISOString();
  const updatedAt = typeof raw.updatedAt === "string" && raw.updatedAt.trim() ? raw.updatedAt : createdAt;
  const active = raw.active !== false;
  if (!accountNumber || !groupCode) return null;
  return { id, accountNumber, groupCode, active, createdAt, updatedAt };
}

export function loadBankRules(): BankRule[] {
  const raw = localStorage.getItem(BANK_RULES_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => normalizeBankRule(item))
      .filter((item): item is BankRule => item !== null);
  } catch {
    return [];
  }
}

export function saveBankRules(items: BankRule[]): void {
  localStorage.setItem(BANK_RULES_KEY, JSON.stringify(items));
}

function normalizeManualAssignmentAudit(item: unknown): ManualBankAssignmentAudit | null {
  if (!item || typeof item !== "object") return null;
  const raw = item as Record<string, unknown>;
  if (typeof raw.id !== "string" || typeof raw.createdAt !== "string" || typeof raw.folio !== "string") {
    return null;
  }
  return {
    id: raw.id,
    createdAt: raw.createdAt,
    folio: raw.folio,
    accountNumber: typeof raw.accountNumber === "string" ? raw.accountNumber : undefined,
    mappedGroup: typeof raw.mappedGroup === "string" ? raw.mappedGroup : undefined,
    previousClientId: typeof raw.previousClientId === "string" ? raw.previousClientId : undefined,
    previousClientUnit: typeof raw.previousClientUnit === "string" ? raw.previousClientUnit : undefined,
    previousClientName: typeof raw.previousClientName === "string" ? raw.previousClientName : undefined,
    nextClientId: typeof raw.nextClientId === "string" ? raw.nextClientId : undefined,
    nextClientUnit: typeof raw.nextClientUnit === "string" ? raw.nextClientUnit : undefined,
    nextClientName: typeof raw.nextClientName === "string" ? raw.nextClientName : undefined,
    reason: typeof raw.reason === "string" ? raw.reason : undefined
  };
}

export function loadManualBankAssignmentAudit(): ManualBankAssignmentAudit[] {
  const raw = localStorage.getItem(MANUAL_ASSIGNMENT_AUDIT_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => normalizeManualAssignmentAudit(item))
      .filter((item): item is ManualBankAssignmentAudit => item !== null);
  } catch {
    return [];
  }
}

export function saveManualBankAssignmentAudit(items: ManualBankAssignmentAudit[]): void {
  localStorage.setItem(MANUAL_ASSIGNMENT_AUDIT_KEY, JSON.stringify(items));
}

const DEFAULT_LATE_FEE_LABEL = "RECARGO POR TARDANZA DE PAGO";

function defaultLateFeeSettings(): LateFeeSettings {
  return {
    active: false,
    dailyAmount: 5,
    chargeLabel: DEFAULT_LATE_FEE_LABEL,
    selectedUnits: []
  };
}

export function loadLateFeeSettings(): LateFeeSettings {
  const raw = localStorage.getItem(LATE_FEE_SETTINGS_KEY);
  if (!raw) return defaultLateFeeSettings();
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const defaults = defaultLateFeeSettings();
    const selectedUnitsRaw = Array.isArray(parsed.selectedUnits) ? parsed.selectedUnits : [];
    const selectedUnits = Array.from(
      new Set(
        selectedUnitsRaw
          .map((unit) => normalizeUnitId(unit))
          .filter((unit) => unit.length > 0)
      )
    ).sort((a, b) => a.localeCompare(b));
    const dailyAmount = parseNonNegativeNumber(parsed.dailyAmount);
    const labelRaw = typeof parsed.chargeLabel === "string" ? parsed.chargeLabel.trim() : "";
    return {
      active: parsed.active === true,
      dailyAmount: dailyAmount > 0 ? dailyAmount : defaults.dailyAmount,
      chargeLabel: labelRaw || defaults.chargeLabel,
      selectedUnits
    };
  } catch {
    return defaultLateFeeSettings();
  }
}

export function saveLateFeeSettings(settings: LateFeeSettings): void {
  const normalized: LateFeeSettings = {
    active: settings.active === true,
    dailyAmount: parseNonNegativeNumber(settings.dailyAmount) || 5,
    chargeLabel: typeof settings.chargeLabel === "string" && settings.chargeLabel.trim()
      ? settings.chargeLabel.trim()
      : DEFAULT_LATE_FEE_LABEL,
    selectedUnits: Array.from(
      new Set((settings.selectedUnits ?? []).map((unit) => normalizeUnitId(unit)).filter((unit) => unit.length > 0))
    ).sort((a, b) => a.localeCompare(b))
  };
  localStorage.setItem(LATE_FEE_SETTINGS_KEY, JSON.stringify(normalized));
}

function normalizeLateFeeLedgerEntry(item: unknown): LateFeeLedgerEntry | null {
  if (!item || typeof item !== "object") return null;
  const raw = item as Record<string, unknown>;
  const reason = normalizeLateFeeReason(raw.reason);
  const amount = parseNonNegativeNumber(raw.amount);
  const unitId = normalizeUnitId(raw.unitId);
  const chargeLabel = typeof raw.chargeLabel === "string" && raw.chargeLabel.trim()
    ? raw.chargeLabel.trim()
    : DEFAULT_LATE_FEE_LABEL;
  if (
    typeof raw.id !== "string" ||
    typeof raw.clientId !== "string" ||
    typeof raw.date !== "string" ||
    typeof raw.createdAt !== "string" ||
    reason === null ||
    amount <= 0 ||
    unitId.length === 0
  ) {
    return null;
  }
  return {
    id: raw.id,
    clientId: raw.clientId,
    unitId,
    date: raw.date,
    amount,
    reason,
    chargeLabel,
    createdAt: raw.createdAt
  };
}

export function loadLateFeeLedger(): LateFeeLedgerEntry[] {
  const raw = localStorage.getItem(LATE_FEE_LEDGER_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => normalizeLateFeeLedgerEntry(item))
      .filter((item): item is LateFeeLedgerEntry => item !== null)
      .sort((a, b) => b.date.localeCompare(a.date));
  } catch {
    return [];
  }
}

export function saveLateFeeLedger(entries: LateFeeLedgerEntry[]): void {
  localStorage.setItem(LATE_FEE_LEDGER_KEY, JSON.stringify(entries));
}

export function loadOtherChargesRetentionByClient(): OtherChargesRetentionByClient {
  const raw = localStorage.getItem(OTHER_CHARGES_RETENTION_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const normalized: OtherChargesRetentionByClient = {};
    for (const [clientId, value] of Object.entries(parsed)) {
      if (!clientId || !clientId.trim()) continue;
      if (typeof value === "number" || typeof value === "string") {
        // Backward compatibility: old format was just amount.
        normalized[clientId] = {
          amount: parseNonNegativeNumber(value),
          cycle: "daily"
        };
        continue;
      }
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const rec = value as Record<string, unknown>;
      normalized[clientId] = {
        amount: parseNonNegativeNumber(rec.amount),
        cycle: rec.cycle === "when_payment" ? "when_payment" : normalizeBillingFrequency(rec.cycle)
      };
    }
    return normalized;
  } catch {
    return {};
  }
}

export function saveOtherChargesRetentionByClient(settings: OtherChargesRetentionByClient): void {
  const normalized: OtherChargesRetentionByClient = {};
  for (const [clientId, config] of Object.entries(settings ?? {})) {
    if (!clientId || !clientId.trim()) continue;
    const amount = parseNonNegativeNumber(config?.amount);
    const cycle = config?.cycle === "when_payment" ? "when_payment" : normalizeBillingFrequency(config?.cycle);
    normalized[clientId] = { amount, cycle };
  }
  localStorage.setItem(OTHER_CHARGES_RETENTION_KEY, JSON.stringify(normalized));
}

function normalizePaymentPromiseStatus(value: unknown): PaymentPromiseStatus {
  return value === "pending" ||
    value === "fulfilled" ||
    value === "incomplete" ||
    value === "overdue" ||
    value === "rescheduled" ||
    value === "cancelled" ||
    value === "fulfilled_late"
    ? value
    : "pending";
}

function normalizePaymentPromise(item: unknown): PaymentPromise | null {
  if (!item || typeof item !== "object") return null;
  const raw = item as Record<string, unknown>;
  if (
    typeof raw.id !== "string" ||
    typeof raw.clientId !== "string" ||
    typeof raw.clientName !== "string" ||
    typeof raw.clientUnit !== "string" ||
    typeof raw.dueAt !== "string" ||
    typeof raw.createdAt !== "string" ||
    typeof raw.updatedAt !== "string"
  ) return null;

  const amountPromised = parseNonNegativeNumber(raw.amountPromised);
  const amountCollectedWithinWindow = parseNonNegativeNumber(raw.amountCollectedWithinWindow);
  const amountCollectedTotal = parseNonNegativeNumber(raw.amountCollectedTotal);
  const amountMissing = parseNonNegativeNumber(raw.amountMissing);

  return {
    id: raw.id,
    clientId: raw.clientId,
    clientName: raw.clientName,
    clientUnit: raw.clientUnit,
    amountPromised,
    amountCollectedWithinWindow,
    amountCollectedTotal,
    amountMissing,
    dueAt: raw.dueAt,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    comment: typeof raw.comment === "string" ? raw.comment : "",
    status: normalizePaymentPromiseStatus(raw.status),
    closedAt: typeof raw.closedAt === "string" && raw.closedAt.trim() ? raw.closedAt : undefined,
    closedReason: typeof raw.closedReason === "string" && raw.closedReason.trim() ? raw.closedReason : undefined,
    createdBy: typeof raw.createdBy === "string" && raw.createdBy.trim() ? raw.createdBy : undefined
  };
}

export function loadPaymentPromises(): PaymentPromise[] {
  const raw = localStorage.getItem(PAYMENT_PROMISES_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => normalizePaymentPromise(item))
      .filter((item): item is PaymentPromise => item !== null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}

export function savePaymentPromises(items: PaymentPromise[]): void {
  localStorage.setItem(PAYMENT_PROMISES_KEY, JSON.stringify(items));
}

function normalizeLeadDecision(value: unknown): LeadDecision {
  return value === "aplica" || value === "aplica_con_abono" || value === "no_aplica"
    ? value
    : "no_aplica";
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
}

function normalizeLeadEvaluation(item: unknown): LeadEvaluation | null {
  if (!item || typeof item !== "object") return null;
  const raw = item as Record<string, unknown>;
  const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : crypto.randomUUID();
  const cedula = typeof raw.cedula === "string" ? raw.cedula.trim() : "";
  const birthDate = typeof raw.birthDate === "string" ? raw.birthDate.trim() : "";
  const createdAt = typeof raw.createdAt === "string" && raw.createdAt.trim() ? raw.createdAt.trim() : new Date().toISOString();
  const updatedAt = typeof raw.updatedAt === "string" && raw.updatedAt.trim() ? raw.updatedAt.trim() : createdAt;
  const age = parseFiniteNumber(raw.age);
  const collisionReports = parseFiniteNumber(raw.collisionReports);
  const pendingDailyReports = parseFiniteNumber(raw.pendingDailyReports);
  const extraDeposit = parseFiniteNumber(raw.extraDeposit);
  if (!cedula || !birthDate || age === null || !Number.isInteger(age) || age < 0) return null;
  return {
    id,
    cedula,
    birthDate,
    age,
    attachmentName: typeof raw.attachmentName === "string" && raw.attachmentName.trim() ? raw.attachmentName.trim() : undefined,
    attachmentDataUrl: typeof raw.attachmentDataUrl === "string" && raw.attachmentDataUrl.trim() ? raw.attachmentDataUrl : undefined,
    hasGpsTamperingReport: raw.hasGpsTamperingReport === true,
    hasLegalCases: raw.hasLegalCases === true,
    hasViolenceReports: raw.hasViolenceReports === true,
    hasDuiReports: raw.hasDuiReports === true,
    hasPiracyReports: raw.hasPiracyReports === true,
    noCases: raw.noCases === true,
    collisionReports: collisionReports !== null && Number.isInteger(collisionReports) && collisionReports >= 0 ? collisionReports : 0,
    pendingDailyReports: pendingDailyReports !== null && Number.isInteger(pendingDailyReports) && pendingDailyReports >= 0 ? pendingDailyReports : 0,
    decision: normalizeLeadDecision(raw.decision),
    extraDeposit: extraDeposit !== null && extraDeposit >= 0 ? extraDeposit : 0,
    blockers: normalizeStringArray(raw.blockers),
    extraDepositReasons: normalizeStringArray(raw.extraDepositReasons),
    createdAt,
    updatedAt
  };
}

export function loadLeadEvaluations(): LeadEvaluation[] {
  const raw = localStorage.getItem(LEAD_EVALUATIONS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => normalizeLeadEvaluation(item))
      .filter((item): item is LeadEvaluation => item !== null)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch {
    return [];
  }
}

export function saveLeadEvaluations(items: LeadEvaluation[]): void {
  localStorage.setItem(LEAD_EVALUATIONS_KEY, JSON.stringify(items));
}
