import type {
  BankRule,
  BillingFrequency,
  Client,
  ClientStatus,
  LateFeeLedgerEntry,
  LateFeeReason,
  LateFeeSettings,
  ManualBankAssignmentAudit,
  OtherChargesRetentionByClient,
  OtherCharge,
  PaymentPromise,
  PaymentPromiseStatus,
  Payment,
  PaymentMethod,
  PendingCardItem,
  PendingBankItem
} from "./types";

const CLIENTS_KEY = "cobrapp.module1.clients.v1";
const PAYMENTS_KEY = "cobrapp.module2.payments.v1";
const SEQ_KEY = "cobrapp.payments.seq.v1";

const WEEKLY_DAYS = new Set([
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday"
]);

const PAYMENT_METHODS = new Set<PaymentMethod>([
  "Efectivo",
  "ACH Express",
  "Deposito Bancario",
  "Transferencia Bancaria",
  "Tarjeta",
  "YAPPY LM",
  "Referido",
  "Descuento"
]);

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
  if (parsed === null || parsed < 0) return 0;
  return parsed;
}

function parseNonNegativeInteger(value: unknown): number {
  const parsed = parseFiniteNumber(value);
  if (parsed === null || !Number.isInteger(parsed) || parsed < 0) return 0;
  return parsed;
}

function normalizeOtherChargeId(value: unknown): string {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  return crypto.randomUUID();
}

function normalizeUnitId(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().toUpperCase();
}

function normalizeBillingFrequency(value: unknown): BillingFrequency {
  return value === "daily" || value === "weekly" || value === "biweekly" || value === "monthly"
    ? value
    : "daily";
}

function normalizeLateFeeReason(value: unknown): LateFeeReason | null {
  return value === "DAILY_MISSED_PROOF" || value === "WEEKLY_LATE_DAY"
    ? value
    : null;
}

function parseChargeArray(value: unknown): OtherCharge[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const parsed = (value as unknown[])
    .filter((c): c is { id?: string; label: string; amount: number } =>
      typeof (c as Record<string, unknown>).label === "string" &&
      typeof (c as Record<string, unknown>).amount === "number" &&
      Number.isFinite((c as Record<string, unknown>).amount as number)
    )
    .map((c) => ({
      id: typeof c.id === "string" && c.id.trim().length > 0 ? c.id.trim() : undefined,
      label: c.label,
      amount: c.amount
    }));
  return parsed.length > 0 ? parsed : undefined;
}

function normalizeOtherCharges(raw: Record<string, unknown>): OtherCharge[] {
  // Formato nuevo: array de { label, amount }
  if (Array.isArray(raw.otherCharges)) {
    return (raw.otherCharges as unknown[])
      .filter(
        (c): c is { id?: string; label: string; amount: number } =>
          typeof (c as Record<string, unknown>).label === "string" &&
          typeof (c as Record<string, unknown>).amount === "number" &&
          ((c as Record<string, unknown>).label as string).trim().length > 0 &&
          Number.isFinite((c as Record<string, unknown>).amount as number)
      )
      .map((c) => ({
        id: normalizeOtherChargeId(c.id),
        label: (c.label as string).trim(),
        amount: c.amount as number
      }));
  }

  // Formato viejo: otherChargeLabel + otherChargeAmount -> migrar a array
  const label = raw.otherChargeLabel;
  const amount = Number(raw.otherChargeAmount);
  if (typeof label === "string" && label.trim() && Number.isFinite(amount) && amount !== 0) {
    return [{ id: crypto.randomUUID(), label: label.trim(), amount }];
  }

  return [];
}

function normalizeClient(item: unknown): Client | null {
  if (!item || typeof item !== "object") {
    return null;
  }

  const raw = item as Record<string, unknown>;
  const frequency = raw.frequency;
  if (
    frequency !== "daily" &&
    frequency !== "weekly" &&
    frequency !== "biweekly" &&
    frequency !== "monthly"
  ) {
    return null;
  }

  const base =
    typeof raw.id === "string" &&
    typeof raw.name === "string" &&
    typeof raw.createdAt === "string";

  if (!base) {
    return null;
  }

  const rentAmount = parseFiniteNumber(raw.rentAmount);
  const balance = parseFiniteNumber(raw.balance);
  if (rentAmount === null || balance === null || rentAmount < 0 || balance < 0) {
    return null;
  }

  const rawStatus = typeof raw.status === "string" ? raw.status.trim().toLowerCase() : "";
  const status: ClientStatus =
    rawStatus === "activo" ||
    rawStatus === "cliente_enfermo" ||
    rawStatus === "taller" ||
    rawStatus === "chapisteria" ||
    rawStatus === "custodia" ||
    rawStatus === "en_busqueda" ||
    rawStatus === "archivado"
      ? rawStatus
      : rawStatus === "active"
      ? "activo"
      : rawStatus === "inactive"
      ? "archivado"
      : typeof raw.archivedAt === "string" && raw.archivedAt.trim().length > 0
      ? "archivado"
      : "activo";

  const normalized: Client = {
    id: raw.id,
    unitId:
      typeof raw.unitId === "string" && raw.unitId.trim()
        ? raw.unitId
        : `LEG-${raw.id.slice(0, 6)}`,
    name: raw.name,
    cedula:
      typeof raw.cedula === "string" && raw.cedula.trim()
        ? raw.cedula.trim()
        : undefined,
    rentAmount,
    frequency,
    chargeFirstSunday: raw.chargeFirstSunday === true,
    firstSundayChargedAt:
      typeof raw.firstSundayChargedAt === "string" && raw.firstSundayChargedAt.trim()
        ? raw.firstSundayChargedAt
        : undefined,
    balance,
    advanceBalance: parseNonNegativeNumber(raw.advanceBalance),
    savings: parseNonNegativeNumber(raw.savings),
    travelFundBalance: parseNonNegativeNumber(raw.travelFundBalance),
    installmentsAgreed: parseNonNegativeInteger(raw.installmentsAgreed),
    installmentsRemaining: parseNonNegativeInteger(raw.installmentsRemaining),
    installmentsPaid: parseNonNegativeInteger(raw.installmentsPaid),
    otherCharges: normalizeOtherCharges(raw),
    createdAt: raw.createdAt,
    firstChargeDate:
      typeof raw.firstChargeDate === "string" && raw.firstChargeDate.trim()
        ? raw.firstChargeDate
        : undefined,
    lastChargeDate:
      typeof raw.lastChargeDate === "string" && raw.lastChargeDate.trim()
        ? raw.lastChargeDate
        : undefined,
    archivedAt:
      typeof raw.archivedAt === "string" && raw.archivedAt.trim()
        ? raw.archivedAt
        : undefined,
    status,
    statusComment:
      typeof raw.statusComment === "string" && raw.statusComment.trim()
        ? raw.statusComment
        : undefined
  };

  if (frequency === "weekly") {
    normalized.weeklyChargeDay = WEEKLY_DAYS.has(String(raw.weeklyChargeDay))
      ? (raw.weeklyChargeDay as Client["weeklyChargeDay"])
      : "monday";
  }

  if (frequency === "monthly") {
    const parsedDay = Number(raw.monthlyChargeDay);
    normalized.monthlyChargeDay =
      Number.isInteger(parsedDay) && parsedDay >= 1 && parsedDay <= 31 ? parsedDay : 1;
  }

  return normalized;
}

export function loadClients(): Client[] {
  const raw = localStorage.getItem(CLIENTS_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as unknown[];
    if (!Array.isArray(parsed)) return [];

    const normalized = parsed
      .map((item) => normalizeClient(item))
      .filter((item): item is Client => item !== null);

    const discarded = parsed.length - normalized.length;
    if (discarded > 0) {
      console.warn(`[Cobrapp] ${discarded} registro(s) invalido(s) fueron omitidos al cargar clientes.`);
    }

    return normalized;
  } catch {
    return [];
  }
}

export function saveClients(clients: Client[]): void {
  localStorage.setItem(CLIENTS_KEY, JSON.stringify(clients));
}

// -- Payments --

export function nextReceiptNumber(): string {
  const current = parseInt(localStorage.getItem(SEQ_KEY) ?? "0", 10);
  const next = Number.isFinite(current) ? current + 1 : 1;
  localStorage.setItem(SEQ_KEY, String(next));
  return `REC-${String(next).padStart(4, "0")}`;
}

function normalizePayment(item: unknown): Payment | null {
  if (!item || typeof item !== "object") return null;
  const raw = item as Record<string, unknown>;

  if (
    typeof raw.id !== "string" ||
    typeof raw.receiptNumber !== "string" ||
    typeof raw.clientId !== "string" ||
    typeof raw.clientName !== "string" ||
    typeof raw.clientUnit !== "string" ||
    typeof raw.dateApplied !== "string" ||
    typeof raw.createdAt !== "string"
  ) return null;

  if (!PAYMENT_METHODS.has(raw.paymentMethod as PaymentMethod)) return null;

  const amountReceived = parseFiniteNumber(raw.amountReceived);
  const appliedToRent = parseFiniteNumber(raw.appliedToRent);
  const centavosAhorro = parseFiniteNumber(raw.centavosAhorro);
  const balanceBefore = parseFiniteNumber(raw.balanceBefore);
  const balanceAfter = parseFiniteNumber(raw.balanceAfter);
  const savingsBefore = parseFiniteNumber(raw.savingsBefore);
  const savingsAfter = parseFiniteNumber(raw.savingsAfter);
  const advanceApplied = parseFiniteNumber(raw.advanceApplied);
  const advanceBalanceAfter = parseFiniteNumber(raw.advanceBalanceAfter);
  const installmentsFromDebt = parseFiniteNumber(raw.installmentsFromDebt);
  const installmentsFromAdvance = parseFiniteNumber(raw.installmentsFromAdvance);
  const installmentsTotalInPayment = parseFiniteNumber(raw.installmentsTotalInPayment);
  const travelFundAvailableSnapshot = parseFiniteNumber(raw.travelFundAvailableSnapshot);

  if (
    amountReceived === null || amountReceived < 0 ||
    appliedToRent === null || appliedToRent < 0 ||
    centavosAhorro === null || centavosAhorro < 0 ||
    balanceBefore === null || balanceBefore < 0 ||
    balanceAfter === null || balanceAfter < 0 ||
    savingsBefore === null || savingsBefore < 0 ||
    savingsAfter === null || savingsAfter < 0 ||
    (advanceApplied !== null && advanceApplied < 0) ||
    (advanceBalanceAfter !== null && advanceBalanceAfter < 0) ||
    (travelFundAvailableSnapshot !== null && travelFundAvailableSnapshot < 0) ||
    (installmentsFromDebt !== null && (!Number.isInteger(installmentsFromDebt) || installmentsFromDebt < 0)) ||
    (installmentsFromAdvance !== null && (!Number.isInteger(installmentsFromAdvance) || installmentsFromAdvance < 0)) ||
    (installmentsTotalInPayment !== null && (!Number.isInteger(installmentsTotalInPayment) || installmentsTotalInPayment < 0))
  ) return null;

  const normalizedRentAmount = parseNonNegativeNumber(raw.rentAmount);
  const fallbackInstallmentsFromDebt = parseNonNegativeInteger(raw.installmentsDeducted);
  const fallbackInstallmentsFromAdvance =
    normalizedRentAmount > 0 && (advanceApplied ?? 0) > 0
      ? Math.floor((advanceApplied ?? 0) / normalizedRentAmount)
      : 0;
  const normalizedInstallmentsFromDebt = installmentsFromDebt !== null
    ? installmentsFromDebt
    : fallbackInstallmentsFromDebt;
  const normalizedInstallmentsFromAdvance = installmentsFromAdvance !== null
    ? installmentsFromAdvance
    : fallbackInstallmentsFromAdvance;
  const normalizedInstallmentsTotalInPayment = installmentsTotalInPayment !== null
    ? installmentsTotalInPayment
    : normalizedInstallmentsFromDebt + normalizedInstallmentsFromAdvance;

  return {
    id: raw.id,
    receiptNumber: raw.receiptNumber,
    clientId: raw.clientId,
    clientName: raw.clientName,
    clientUnit: raw.clientUnit,
    clientCedula:
      typeof raw.clientCedula === "string" && raw.clientCedula.trim()
        ? raw.clientCedula.trim()
        : undefined,
    dateApplied: raw.dateApplied,
    paymentMethod: raw.paymentMethod as PaymentMethod,
    reference:
      typeof raw.reference === "string" && raw.reference.trim()
        ? raw.reference.trim()
        : undefined,
    amountReceived,
    appliedToRent,
    centavosAhorro,
    installmentsDeducted: parseNonNegativeInteger(raw.installmentsDeducted),
    installmentsFromDebt: normalizedInstallmentsFromDebt,
    installmentsFromAdvance: normalizedInstallmentsFromAdvance,
    installmentsTotalInPayment: normalizedInstallmentsTotalInPayment,
    balanceBefore,
    balanceAfter,
    savingsBefore,
    savingsAfter,
    advanceApplied: advanceApplied ?? undefined,
    advanceBalanceAfter: advanceBalanceAfter ?? undefined,
    installmentsPaidAfter: parseNonNegativeInteger(raw.installmentsPaidAfter),
    installmentsRemainingAfter: parseNonNegativeInteger(raw.installmentsRemainingAfter),
    rentAmount: normalizedRentAmount,
    frequency: (raw.frequency === "daily" || raw.frequency === "weekly" || raw.frequency === "biweekly" || raw.frequency === "monthly")
      ? raw.frequency
      : "monthly",
    weeklyChargeDay: (["monday","tuesday","wednesday","thursday","friday","saturday"].includes(raw.weeklyChargeDay as string))
      ? raw.weeklyChargeDay as import("./types").WeeklyChargeDay
      : undefined,
    monthlyChargeDay: (typeof raw.monthlyChargeDay === "number" && raw.monthlyChargeDay >= 1 && raw.monthlyChargeDay <= 31)
      ? raw.monthlyChargeDay
      : undefined,
    travelFundAvailableSnapshot: travelFundAvailableSnapshot ?? undefined,
    createdAt: raw.createdAt,
    otherChargesApplied: parseChargeArray(raw.otherChargesApplied),
    otherChargesDueAfter: parseChargeArray(raw.otherChargesDueAfter)
  };
}

export function loadPayments(): Payment[] {
  const raw = localStorage.getItem(PAYMENTS_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as unknown[];
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((item) => normalizePayment(item))
      .filter((item): item is Payment => item !== null);
  } catch {
    return [];
  }
}

export function savePayments(payments: Payment[]): void {
  localStorage.setItem(PAYMENTS_KEY, JSON.stringify(payments));
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
