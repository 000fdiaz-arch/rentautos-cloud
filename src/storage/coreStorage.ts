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
  PaymentIncomeEdit,
  PaymentMethod,
  PendingCardItem,
  PendingBankItem
} from "../types";
import { withResolvedInstallmentIssuance } from "../billing";
import { readIndexedDb, writeIndexedDb } from "./indexedDbStorage";

const CLIENTS_KEY = "cobrapp.module1.clients.v1";
const PAYMENTS_KEY = "cobrapp.module2.payments.v1";
const SEQ_KEY = "cobrapp.payments.seq.v1";
const CLIENTS_INDEXED_DB_KEY = "clients.v1";
const PAYMENTS_INDEXED_DB_KEY = "payments.v1";
const INDEXED_DB_SENTINEL = "__indexeddb__";
const TEST_LEGACY_LOCAL_STORAGE = import.meta.env.VITE_RENTAUTOS_TEST_LEGACY_LOCAL_STORAGE === "1";

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
  return value === "DAILY_MISSED_PROOF" || value === "WEEKLY_LATE_DAY" || value === "SCHEDULED_LATE_DAY"
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

  const id = typeof raw.id === "string" ? raw.id : null;
  const name = typeof raw.name === "string" ? raw.name : null;
  const createdAt = typeof raw.createdAt === "string" ? raw.createdAt : null;
  if (!id || !name || !createdAt) {
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
    rawStatus === "taller" ||
    rawStatus === "chapisteria" ||
    rawStatus === "custodia" ||
    rawStatus === "archivado"
      ? rawStatus
      : rawStatus === "cliente_enfermo" || rawStatus === "en_busqueda"
      ? "activo"
      : rawStatus === "active"
      ? "activo"
      : rawStatus === "inactive"
      ? "archivado"
      : typeof raw.archivedAt === "string" && raw.archivedAt.trim().length > 0
      ? "archivado"
      : "activo";

  const normalized: Client = {
    id,
    unitId:
      typeof raw.unitId === "string" && raw.unitId.trim()
        ? raw.unitId
        : `LEG-${id.slice(0, 6)}`,
    name,
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
    installmentsIssued: Number.isFinite(Number(raw.installmentsIssued))
      ? parseNonNegativeInteger(raw.installmentsIssued)
      : undefined,
    installmentsIssuedEstimateNeedsReview: raw.installmentsIssuedEstimateNeedsReview === true,
    installmentsRemaining: parseNonNegativeInteger(raw.installmentsRemaining),
    installmentsPaid: parseNonNegativeInteger(raw.installmentsPaid),
    otherCharges: normalizeOtherCharges(raw),
    createdAt,
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

  return withResolvedInstallmentIssuance(normalized);
}

export function loadClients(): Client[] {
  const raw = localStorage.getItem(CLIENTS_KEY);
  if (!raw) return [];
  if (raw === INDEXED_DB_SENTINEL) return [];

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
  if (TEST_LEGACY_LOCAL_STORAGE) {
    localStorage.setItem(CLIENTS_KEY, JSON.stringify(clients));
    return;
  }

  // Los listados grandes de clientes pueden superar el limite de localStorage.
  // Persistimos canonico en IndexedDB y dejamos una marca ligera en localStorage.
  void writeIndexedDb(CLIENTS_INDEXED_DB_KEY, clients).catch((error) => {
    console.error("No se pudo guardar clientes en IndexedDB.", error);
  });

  try {
    localStorage.setItem(CLIENTS_KEY, INDEXED_DB_SENTINEL);
  } catch (error) {
    console.error("No se pudo actualizar marcador de clientes en localStorage.", error);
  }
}

// -- Payments --

export function nextReceiptNumber(): string {
  const current = parseInt(localStorage.getItem(SEQ_KEY) ?? "0", 10);
  const next = Number.isFinite(current) ? current + 1 : 1;
  localStorage.setItem(SEQ_KEY, String(next));
  return `REC-${String(next).padStart(4, "0")}`;
}

function normalizePaymentIncomeEdits(value: unknown): PaymentIncomeEdit[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const edits = value.flatMap((item): PaymentIncomeEdit[] => {
    if (!item || typeof item !== "object") return [];
    const raw = item as Record<string, unknown>;
    if (typeof raw.id !== "string" || typeof raw.createdAt !== "string" || typeof raw.actor !== "string") return [];
    const optionalText = (field: unknown): string | undefined => typeof field === "string" && field.trim() ? field.trim() : undefined;
    return [{
      id: raw.id,
      createdAt: raw.createdAt,
      actor: raw.actor,
      reason: optionalText(raw.reason),
      previousAccountNumber: optionalText(raw.previousAccountNumber),
      nextAccountNumber: optionalText(raw.nextAccountNumber),
      previousComment: optionalText(raw.previousComment),
      nextComment: optionalText(raw.nextComment),
      previousMoneyDelivered: typeof raw.previousMoneyDelivered === "boolean" ? raw.previousMoneyDelivered : undefined,
      nextMoneyDelivered: typeof raw.nextMoneyDelivered === "boolean" ? raw.nextMoneyDelivered : undefined
    }];
  });
  return edits.length > 0 ? edits : undefined;
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
    receiptDeliveryStatus:
      raw.receiptDeliveryStatus === "pending" || raw.receiptDeliveryStatus === "sent"
        ? raw.receiptDeliveryStatus
        : undefined,
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
    bankAccountNumber:
      typeof raw.bankAccountNumber === "string" && raw.bankAccountNumber.trim()
        ? raw.bankAccountNumber.trim()
        : undefined,
    bankGroupCode:
      typeof raw.bankGroupCode === "string" && raw.bankGroupCode.trim()
        ? raw.bankGroupCode.trim()
        : undefined,
    fundsReceivedDate:
      typeof raw.fundsReceivedDate === "string" && raw.fundsReceivedDate.trim()
        ? raw.fundsReceivedDate.trim()
        : undefined,
    incomeComment:
      typeof raw.incomeComment === "string" && raw.incomeComment.trim()
        ? raw.incomeComment.trim()
        : undefined,
    incomeEdits: normalizePaymentIncomeEdits(raw.incomeEdits),
    moneyDelivered: typeof raw.moneyDelivered === "boolean" ? raw.moneyDelivered : undefined,
    moneyDeliveryDate:
      typeof raw.moneyDeliveryDate === "string" && raw.moneyDeliveryDate.trim()
        ? raw.moneyDeliveryDate.trim()
        : undefined,
    moneyDeliveryUpdatedAt:
      typeof raw.moneyDeliveryUpdatedAt === "string" && raw.moneyDeliveryUpdatedAt.trim()
        ? raw.moneyDeliveryUpdatedAt.trim()
        : undefined,
    moneyDeliveryUpdatedBy:
      typeof raw.moneyDeliveryUpdatedBy === "string" && raw.moneyDeliveryUpdatedBy.trim()
        ? raw.moneyDeliveryUpdatedBy.trim()
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
      ? raw.weeklyChargeDay as import("../types").WeeklyChargeDay
      : undefined,
    monthlyChargeDay: (typeof raw.monthlyChargeDay === "number" && raw.monthlyChargeDay >= 1 && raw.monthlyChargeDay <= 31)
      ? raw.monthlyChargeDay
      : undefined,
    chargeFirstSunday: raw.chargeFirstSunday === true,
    firstSundayChargedAt:
      typeof raw.firstSundayChargedAt === "string" && raw.firstSundayChargedAt.trim()
        ? raw.firstSundayChargedAt.trim()
        : undefined,
    travelFundAvailableSnapshot: travelFundAvailableSnapshot ?? undefined,
    createdAt: raw.createdAt,
    otherChargesApplied: parseChargeArray(raw.otherChargesApplied),
    otherChargesDueAfter: parseChargeArray(raw.otherChargesDueAfter)
  };
}

export async function loadClientsFromIndexedDb(): Promise<Client[]> {
  const value = await readIndexedDb(CLIENTS_INDEXED_DB_KEY);
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeClient(item))
    .filter((item): item is Client => item !== null);
}

export function loadPayments(): Payment[] {
  const raw = localStorage.getItem(PAYMENTS_KEY);
  if (!raw) return [];
  if (raw === INDEXED_DB_SENTINEL) return [];

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

export async function loadPaymentsFromIndexedDb(): Promise<Payment[]> {
  const value = await readIndexedDb(PAYMENTS_INDEXED_DB_KEY);
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => normalizePayment(item))
      .filter((item): item is Payment => item !== null);
}

export function savePayments(payments: Payment[]): void {
  if (TEST_LEGACY_LOCAL_STORAGE) {
    localStorage.setItem(PAYMENTS_KEY, JSON.stringify(payments));
    return;
  }

  // Los historiales grandes de pagos pueden superar el limite de localStorage.
  // Persistimos canonico en IndexedDB y dejamos una marca ligera en localStorage.
  void writeIndexedDb(PAYMENTS_INDEXED_DB_KEY, payments).catch((error) => {
    console.error("No se pudo guardar pagos en IndexedDB.", error);
  });

  try {
    localStorage.setItem(PAYMENTS_KEY, INDEXED_DB_SENTINEL);
  } catch (error) {
    console.error("No se pudo actualizar marcador de pagos en localStorage.", error);
  }
}
