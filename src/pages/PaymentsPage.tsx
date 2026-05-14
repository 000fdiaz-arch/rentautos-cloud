import { useEffect, useMemo, useRef, useState } from "react";
import PaymentReceipt, { downloadPaymentReceiptImage, downloadPaymentsReceiptsZip } from "../components/PaymentReceipt";
import { formatCurrency, formatDate } from "../format";
import {
  loadLateFeeLedger,
  loadPendingCardItems,
  loadManualBankAssignmentAudit,
  loadPendingBankItems,
  nextReceiptNumber,
  saveLateFeeLedger,
  savePendingCardItems,
  saveManualBankAssignmentAudit,
  savePendingBankItems
} from "../storage";
import type {
  BankRule,
  BillingFrequency,
  Client,
  LateFeeLedgerEntry,
  LateFeeSettings,
  ManualBankAssignmentAudit,
  OtherChargesRetentionCycle,
  OtherChargesRetentionByClient,
  OtherCharge,
  Payment,
  PaymentMethod,
  PendingCardItem,
  PendingBankItem
} from "../types";
import { findNextChargeDay, isChargeDay, parseDateKey, startOfDay, toDateKey } from "../billing";
import { applyLateFeesForClosingDate, subtractOtherCharge } from "../lateFees";
import { buildReceivableRows } from "../receivables";

const PAYMENT_METHODS: PaymentMethod[] = [
  "Efectivo",
  "ACH Express",
  "Deposito Bancario",
  "Transferencia Bancaria",
  "Tarjeta",
  "YAPPY LM",
  "Referido",
  "Descuento"
];
const BANK_PAYMENT_METHODS = new Set<PaymentMethod>(["ACH Express", "Deposito Bancario", "Transferencia Bancaria"]);
const NOTIFIED_PAYMENTS_KEY = "cobrapp.module2.notified.v1";
const NOTIFIED_AMOUNT_TOLERANCE = 0.02;
const NOTIFIED_DAYS_WINDOW = 7;
const CASH_CLOSINGS_KEY = "cobrapp.module2.cash_closings.v1";
const CASH_CLOSING_AUDIT_KEY = "cobrapp.module2.cash_closing_audit.v1";
const CHARGE_RUNS_KEY = "cobrapp.module2.charge_runs.v1";
const COLLECTION_STATUS_KEY = "cobrapp.module3.street_management.v1";
const COLLECTION_CLOSURES_KEY = "cobrapp.module3.collection_closures.v1";

const FREQUENCY_LABEL: Record<string, string> = {
  daily: "Diario",
  weekly: "Semanal",
  biweekly: "Quincenal",
  monthly: "Mensual"
};

type PaymentForm = {
  clientId: string;
  dateApplied: string;
  paymentMethod: PaymentMethod;
  reference: string;
  amountReceived: string;
};

type NotifiedPayment = {
  id: string;
  clientId: string;
  amount: number;
  createdAt: string;
};

type NotifiedPaymentForm = {
  unitId: string;
  amount: string;
};

type PendingCardEditForm = {
  folio: string;
  reference: string;
};

type NotifiedSortField = "unit" | "client" | "amount" | "createdAt";
type SortDirection = "asc" | "desc";
type HistorySortField = "receipt" | "date" | "unit" | "client" | "amount" | "applied" | "savings" | "installments" | "method";

type CashClosing = {
  date: string;
  closedAt: string;
};

type CashClosingAuditAction = "close" | "reopen";

type CashClosingAuditEvent = {
  id: string;
  date: string;
  action: CashClosingAuditAction;
  actor: string;
  reason: string;
  createdAt: string;
};

type ChargeRun = {
  id: string;
  closingDate: string;
  targetDate: string;
  expectedClients: number;
  chargedClients: number;
  anomalyClients: number;
  chargedTotal: number;
  createdAt: string;
};

type CloseReportStatus = "ok" | "warning";

type ChargeReportRow = {
  clientId: string;
  unitId: string;
  name: string;
  shouldCharge: boolean;
  charged: boolean;
  anomaly: boolean;
  reason: string;
  balanceBefore: number;
  balanceAfter: number;
  chargedAmount: number;
  lastChargeDateBefore: string;
  lastChargeDateAfter: string;
};

type ChargeCloseReport = {
  closingDate: string;
  targetDate: string;
  status: CloseReportStatus;
  expectedClients: number;
  chargedClients: number;
  anomalyClients: number;
  chargedTotal: number;
  generatedAt: string;
  rows: ChargeReportRow[];
};

type ChargeApplyResult = {
  targetDate: string;
  alreadyProcessed: boolean;
  expectedClients: number;
  chargedClients: number;
  anomalyClients: number;
  chargedTotal: number;
  lateFeeClients: number;
  lateFeeTotal: number;
  rows: ChargeReportRow[];
  blockingError?: string;
};

type PendingBankPreview = {
  rentAmount: number;
  frequencyLabel: string;
  installmentsAgreed: number;
  installmentsRemainingAfter: number;
  installmentsDeducted: number;
  balanceAfter: number;
  installmentsCoveredByAdvance: number;
  upToDateUntil: string | null;
};

type PendingColumnFilters = {
  folio: string;
  account: string;
  group: string;
  date: string;
  amount: string;
  name: string;
  similarity: string;
  unit: string;
  preview: string;
  description: string;
  actions: string;
};

type HistoryColumnFilters = {
  receipt: string;
  date: string;
  unit: string;
  client: string;
  amount: string;
  applied: string;
  savings: string;
  installments: string;
  method: string;
};

const EMPTY_PENDING_FILTERS: PendingColumnFilters = {
  folio: "",
  account: "",
  group: "",
  date: "",
  amount: "",
  name: "",
  similarity: "",
  unit: "",
  preview: "",
  description: "",
  actions: ""
};

const EMPTY_HISTORY_COLUMN_FILTERS: HistoryColumnFilters = {
  receipt: "",
  date: "",
  unit: "",
  client: "",
  amount: "",
  applied: "",
  savings: "",
  installments: "",
  method: ""
};

function getNextDateKey(dateKey: string): string {
  const parsed = parseDateKey(dateKey);
  if (!parsed) return dateKey;
  const next = new Date(parsed);
  next.setDate(next.getDate() + 1);
  return toDateKey(next);
}

function buildTemporaryCardFolio(dateKey: string): string {
  const compactDate = dateKey.replace(/-/g, "");
  const token = String(Date.now()).slice(-6);
  return `TMP-${compactDate}-${token}`;
}

type Props = {
  clients: Client[];
  bankRules: BankRule[];
  lateFeeSettings: LateFeeSettings;
  otherChargesRetentionByClient: OtherChargesRetentionByClient;
  onClientsChange: (next: Client[]) => void;
  payments: Payment[];
  onPaymentsChange: (next: Payment[]) => void;
  onCashClose?: () => void;
};

type CollectionStatus = "no_answer" | "reminder" | "call_later" | "paid";

type CollectionStatusRecord = {
  status: CollectionStatus;
  comment: string;
  updatedAt: string;
};

type CollectionClosureItem = {
  clientId: string;
  unitId: string;
  clientName: string;
  lastPaymentDate: string | null;
  receivableState: string;
  totalPending: number;
  collectionStatus: CollectionStatus;
  comment: string;
  autoApplied: boolean;
};

type CollectionClosureSnapshot = {
  date: string;
  closedAt: string;
  actor: string;
  reason: string;
  totals: Record<CollectionStatus, number>;
  items: CollectionClosureItem[];
};

type CollectionClosuresByDate = Record<string, CollectionClosureSnapshot>;

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function getInstallmentsFromAdvance(payment: Pick<Payment, "installmentsFromAdvance" | "advanceApplied" | "rentAmount">): number {
  if (typeof payment.installmentsFromAdvance === "number" && Number.isInteger(payment.installmentsFromAdvance) && payment.installmentsFromAdvance >= 0) {
    return payment.installmentsFromAdvance;
  }
  if (payment.rentAmount > 0 && (payment.advanceApplied ?? 0) > 0) {
    return Math.floor((payment.advanceApplied ?? 0) / payment.rentAmount);
  }
  return 0;
}

function getInstallmentsTotalInPayment(payment: Pick<Payment, "installmentsTotalInPayment" | "installmentsFromDebt" | "installmentsDeducted" | "installmentsFromAdvance" | "advanceApplied" | "rentAmount">): number {
  if (typeof payment.installmentsTotalInPayment === "number" && Number.isInteger(payment.installmentsTotalInPayment) && payment.installmentsTotalInPayment >= 0) {
    return payment.installmentsTotalInPayment;
  }
  const fromDebt = typeof payment.installmentsFromDebt === "number"
    ? payment.installmentsFromDebt
    : Math.max(0, payment.installmentsDeducted ?? 0);
  return Math.max(0, fromDebt + getInstallmentsFromAdvance(payment));
}

function computeCoveredInstallmentsFromAdvance(advanceBefore: number, advanceAfter: number, rentAmount: number): number {
  const normalizedRent = roundMoney(Math.max(0, rentAmount));
  if (!Number.isFinite(normalizedRent) || normalizedRent <= 0) return 0;
  const coveredBefore = Math.floor(roundMoney(Math.max(0, advanceBefore)) / normalizedRent);
  const coveredAfter = Math.floor(roundMoney(Math.max(0, advanceAfter)) / normalizedRent);
  return Math.max(0, coveredAfter - coveredBefore);
}

function getAdvanceLetterLabel(client: Client, advanceAdded: number): string | null {
  const normalizedAdvanceAdded = roundMoney(Math.max(0, advanceAdded));
  if (normalizedAdvanceAdded <= 0) return null;
  const rentAmount = roundMoney(client.rentAmount);
  if (!Number.isFinite(rentAmount) || rentAmount <= 0) return null;

  const currentAdvance = roundMoney(Math.max(0, client.advanceBalance ?? 0));
  const resultingAdvance = roundMoney(currentAdvance + normalizedAdvanceAdded);
  const coveredBefore = Math.floor(currentAdvance / rentAmount);
  const coveredAfter = Math.floor(resultingAdvance / rentAmount);
  const installmentsPaid = Math.max(0, client.installmentsPaid ?? 0);
  const startLetter = installmentsPaid + coveredBefore + 1;
  const endLetter = installmentsPaid + coveredAfter;

  if (endLetter >= startLetter) {
    return startLetter === endLetter
      ? `Letra ${startLetter}`
      : `Letras ${startLetter}-${endLetter}`;
  }

  const partialCovered = roundMoney(resultingAdvance - coveredBefore * rentAmount);
  const percentage = Math.max(0, Math.min(100, Math.round((partialCovered / rentAmount) * 100)));
  return `Letra ${startLetter} (${percentage}% cubierta)`;
}

function toInputMoney(value: number): string {
  const normalized = roundMoney(value);
  return Number.isInteger(normalized) ? String(normalized) : normalized.toFixed(2);
}

function getMonthEndDate(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function computeRequiredWholeAmountToReachDate(client: Client, fromDate: Date, targetDate: Date): { requiredWholeAmount: number; resultingNextDate: Date | null } {
  const normalizedFrom = startOfDay(fromDate);
  const normalizedTarget = startOfDay(targetDate);
  const targetKey = toDateKey(normalizedTarget);
  const rent = roundMoney(client.rentAmount);

  let simulatedAdvance = roundMoney(client.advanceBalance ?? 0);
  let requiredWholeAmount = 0;

  for (let i = 0; i < 4000; i += 1) {
    const simulatedClient: Client = { ...client, advanceBalance: simulatedAdvance };
    const nextChargeDate = findNextChargeDay(simulatedClient, normalizedFrom);
    if (!nextChargeDate) return { requiredWholeAmount: roundMoney(requiredWholeAmount), resultingNextDate: null };
    if (toDateKey(nextChargeDate) >= targetKey) {
      return { requiredWholeAmount: roundMoney(requiredWholeAmount), resultingNextDate: nextChargeDate };
    }
    if (!Number.isFinite(rent) || rent <= 0) {
      return { requiredWholeAmount: roundMoney(requiredWholeAmount), resultingNextDate: nextChargeDate };
    }
    simulatedAdvance = roundMoney(simulatedAdvance + rent);
    requiredWholeAmount = roundMoney(requiredWholeAmount + rent);
  }

  const fallbackClient: Client = { ...client, advanceBalance: simulatedAdvance };
  return { requiredWholeAmount: roundMoney(requiredWholeAmount), resultingNextDate: findNextChargeDay(fallbackClient, normalizedFrom) };
}

function splitWholeAndCents(amount: number): { wholePart: number; centsPart: number } {
  const normalized = roundMoney(Math.max(0, amount));
  const wholePart = Math.floor(normalized + Number.EPSILON);
  const centsPart = roundMoney(normalized - wholePart);
  return { wholePart, centsPart };
}

function parseCollectionStatusesFromStorage(): Record<string, CollectionStatusRecord> {
  try {
    const raw = localStorage.getItem(COLLECTION_STATUS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const next: Record<string, CollectionStatusRecord> = {};
    for (const [clientId, value] of Object.entries(parsed)) {
      if (!value || typeof value !== "object") continue;
      const row = value as Record<string, unknown>;
      const status = row.status;
      if (status !== "no_answer" && status !== "reminder" && status !== "call_later" && status !== "paid") continue;
      next[clientId] = {
        status,
        comment: typeof row.comment === "string" ? row.comment.slice(0, 5) : "",
        updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : new Date().toISOString()
      };
    }
    return next;
  } catch {
    return {};
  }
}

function loadCollectionClosuresFromStorage(): CollectionClosuresByDate {
  try {
    const raw = localStorage.getItem(COLLECTION_CLOSURES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as CollectionClosuresByDate;
  } catch {
    return {};
  }
}

function resolveCollectionStatusForClosure(
  row: { id: string; state: string; lastPaymentDate: string | null },
  statusesByClient: Record<string, CollectionStatusRecord>,
  closureDate: string
): { status: CollectionStatus; comment: string; autoApplied: boolean } {
  const manual = statusesByClient[row.id];
  const paidToday = row.lastPaymentDate === closureDate;
  const autoPaid = row.state === "alDia" || paidToday;
  if (manual?.status) {
    return {
      status: manual.status,
      comment: manual.status === "call_later" ? (manual.comment ?? "").slice(0, 5) : "",
      autoApplied: false
    };
  }
  if (autoPaid) {
    return { status: "paid", comment: "", autoApplied: true };
  }
  return { status: "reminder", comment: "", autoApplied: true };
}

const DEFAULT_OTHER_CHARGES_RETENTION = 5;

function getConfiguredOtherChargesRetentionConfig(
  client: Client,
  retentionByClient: OtherChargesRetentionByClient
): { amount: number; cycle: OtherChargesRetentionCycle } {
  const configured = retentionByClient[client.id];
  const amount = Number.isFinite(configured?.amount) ? roundMoney(Math.max(0, configured.amount)) : DEFAULT_OTHER_CHARGES_RETENTION;
  const cycle = configured?.cycle ?? client.frequency;
  return { amount, cycle };
}

function getRetentionCycleLabel(cycle: OtherChargesRetentionCycle): string {
  if (cycle === "daily") return "Diario";
  if (cycle === "weekly") return "Semanal";
  if (cycle === "biweekly") return "Quincenal";
  if (cycle === "monthly") return "Mensual";
  return "Cuando paga";
}

function getLastPaymentDateKey(clientId: string, payments: Payment[], beforeOrOnDateKey: string): string | null {
  const last = payments
    .filter((payment) => payment.clientId === clientId && payment.dateApplied <= beforeOrOnDateKey)
    .sort((a, b) => b.dateApplied.localeCompare(a.dateApplied))[0];
  return last?.dateApplied ?? null;
}

function getRetentionCycleClient(client: Client, cycle: OtherChargesRetentionCycle): Client {
  if (cycle === "when_payment") return client;
  const base: Client = { ...client, frequency: cycle as BillingFrequency };
  if (cycle === "daily") {
    // Daily retention excludes Sunday by default.
    return { ...base, chargeFirstSunday: false };
  }
  if (cycle === "weekly") {
    return { ...base, weeklyChargeDay: client.weeklyChargeDay ?? "monday" };
  }
  if (cycle === "monthly") {
    return { ...base, monthlyChargeDay: client.monthlyChargeDay ?? 1 };
  }
  return base;
}

function countRetentionEventsInRange(
  client: Client,
  cycle: OtherChargesRetentionCycle,
  fromExclusive: Date,
  toInclusive: Date
): number {
  if (cycle === "when_payment") return 1;
  const normalizedFrom = startOfDay(fromExclusive);
  const normalizedTo = startOfDay(toInclusive);
  if (normalizedTo < normalizedFrom) return 0;
  let cursor = new Date(normalizedFrom);
  cursor.setDate(cursor.getDate() + 1);
  let events = 0;
  const cycleClient = getRetentionCycleClient(client, cycle);
  for (let i = 0; i < 4000 && cursor <= normalizedTo; i += 1) {
    if (cycle === "daily") {
      if (cursor.getDay() !== 0) events += 1;
    } else if (isChargeDay(cycleClient, cursor)) {
      events += 1;
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return events;
}

function computeConfiguredRetentionForPayment(
  client: Client,
  retentionByClient: OtherChargesRetentionByClient,
  payments: Payment[],
  paymentDateKey: string
): number {
  const config = getConfiguredOtherChargesRetentionConfig(client, retentionByClient);
  if (config.amount <= 0) return 0;
  if (config.cycle === "when_payment") return config.amount;
  const paymentDate = parseDateKey(paymentDateKey) ?? startOfDay(new Date());
  const lastPaymentDateKey = getLastPaymentDateKey(client.id, payments, paymentDateKey);
  if (!lastPaymentDateKey) return config.amount;
  const lastPaymentDate = parseDateKey(lastPaymentDateKey);
  if (!lastPaymentDate) return config.amount;
  const events = countRetentionEventsInRange(client, config.cycle, lastPaymentDate, paymentDate);
  if (events <= 0) return 0;
  return roundMoney(config.amount * events);
}

function shouldForceRetentionToOtherCharges(
  client: Client,
  retentionByClient: OtherChargesRetentionByClient,
  payments: Payment[],
  paymentDateKey: string
): boolean {
  const hasPendingOtherCharges = (client.otherCharges ?? []).some((charge) => roundMoney(charge.amount) > 0);
  if (!hasPendingOtherCharges) return false;
  return computeConfiguredRetentionForPayment(client, retentionByClient, payments, paymentDateKey) > 0;
}

function getOtherChargeKey(charge: Pick<OtherCharge, "id" | "label">, fallbackIndex = 0): string {
  if (charge.id && charge.id.trim()) return `id:${charge.id.trim()}`;
  return `legacy:${charge.label.trim().toUpperCase()}:${fallbackIndex}`;
}

function distributeAcrossOtherCharges(configured: OtherCharge[] | undefined, amount: number): OtherCharge[] {
  let remaining = roundMoney(Math.max(0, amount));
  const applied: OtherCharge[] = [];
  for (const charge of configured ?? []) {
    if (remaining <= 0) break;
    const pendingForCharge = roundMoney(Math.max(0, charge.amount));
    if (pendingForCharge <= 0) continue;
    const appliedAmount = roundMoney(Math.min(pendingForCharge, remaining));
    if (appliedAmount <= 0) continue;
    applied.push({ id: charge.id, label: charge.label, amount: appliedAmount });
    remaining = roundMoney(Math.max(0, remaining - appliedAmount));
  }
  return applied;
}

function computeAppliedOtherCharges(
  configured: OtherCharge[] | undefined,
  manualInput: Record<string, string>,
  maxAvailable: number
): { otherChargesApplied: OtherCharge[]; totalOtherCharges: number } {
  let remaining = roundMoney(Math.max(0, maxAvailable));
  const otherChargesApplied = (configured ?? [])
    .map((charge, index) => {
      const key = getOtherChargeKey(charge, index);
      const inputVal = parseFloat(manualInput[key] ?? "");
      const desired = roundMoney(Number.isFinite(inputVal) ? Math.max(0, inputVal) : 0);
      const appliedAmount = roundMoney(Math.min(desired, Math.max(0, remaining)));
      remaining = roundMoney(Math.max(0, remaining - appliedAmount));
      return { id: charge.id, label: charge.label, amount: appliedAmount };
    })
    .filter((c) => c.amount > 0);
  const totalOtherCharges = roundMoney(otherChargesApplied.reduce((sum, charge) => sum + charge.amount, 0));
  return { otherChargesApplied, totalOtherCharges };
}

function computeEffectiveOtherChargesAllocation(
  client: Client,
  manualInput: Record<string, string>,
  wholePart: number,
  retentionByClient: OtherChargesRetentionByClient,
  payments: Payment[],
  paymentDateKey: string,
  allowManualOverrideForForcedRule = false
): { otherChargesApplied: OtherCharge[]; totalOtherCharges: number; forcedRuleApplied: boolean } {
  if (!shouldForceRetentionToOtherCharges(client, retentionByClient, payments, paymentDateKey) || allowManualOverrideForForcedRule) {
    const manual = computeAppliedOtherCharges(client.otherCharges, manualInput, wholePart);
    return {
      otherChargesApplied: manual.otherChargesApplied,
      totalOtherCharges: manual.totalOtherCharges,
      forcedRuleApplied: false
    };
  }

  const pendingOtherCharges = roundMoney(
    (client.otherCharges ?? []).reduce((sum, charge) => sum + roundMoney(Math.max(0, charge.amount)), 0)
  );
  const configuredRetention = computeConfiguredRetentionForPayment(client, retentionByClient, payments, paymentDateKey);
  const forcedAmount = roundMoney(Math.min(configuredRetention, Math.max(0, wholePart), pendingOtherCharges));
  const otherChargesApplied = distributeAcrossOtherCharges(client.otherCharges, forcedAmount);
  const totalOtherCharges = roundMoney(otherChargesApplied.reduce((sum, charge) => sum + charge.amount, 0));
  return {
    otherChargesApplied,
    totalOtherCharges,
    forcedRuleApplied: totalOtherCharges > 0
  };
}

type ManualPaymentAllocation = {
  balanceBefore: number;
  appliedToRent: number;
  centavosAhorro: number;
  advanceApplied: number;
  balanceAfter: number;
  installmentsDeducted: number;
  installmentsCoveredByAdvance: number;
  installmentsTotalInPayment: number;
  pendingBefore: number;
  pendingAfter: number;
  totalOtherCharges: number;
  otherChargesApplied: OtherCharge[];
  forcedOtherChargesRuleApplied: boolean;
};

function computeManualPaymentAllocation(
  client: Client,
  rawAmount: number,
  manualOtherChargesInput: Record<string, string>,
  retentionByClient: OtherChargesRetentionByClient,
  payments: Payment[],
  paymentDateKey: string,
  allowManualOverrideForForcedRule = false
): ManualPaymentAllocation {
  const amount = roundMoney(Math.max(0, rawAmount));
  const { wholePart, centsPart } = splitWholeAndCents(amount);
  const balanceBefore = roundMoney(client.balance);

  const { otherChargesApplied, totalOtherCharges, forcedRuleApplied } = computeEffectiveOtherChargesAllocation(
    client,
    manualOtherChargesInput,
    wholePart,
    retentionByClient,
    payments,
    paymentDateKey,
    allowManualOverrideForForcedRule
  );
  const appliedToRent = roundMoney(Math.min(Math.max(0, wholePart - totalOtherCharges), balanceBefore));
  const leftover = roundMoney(Math.max(0, wholePart - totalOtherCharges - appliedToRent));
  const advanceApplied = leftover;
  const centavosAhorro = centsPart;
  const balanceAfter = roundMoney(balanceBefore - appliedToRent);
  const rentAmount = client.rentAmount;
  const advanceBefore = roundMoney(Math.max(0, client.advanceBalance ?? 0));
  const advanceAfter = roundMoney(advanceBefore + advanceApplied);
  const pendingBefore = rentAmount > 0 ? Math.ceil(balanceBefore / rentAmount) : 0;
  const pendingAfter = rentAmount > 0 && balanceAfter > 0 ? Math.ceil(balanceAfter / rentAmount) : 0;
  const installmentsDeducted = Math.max(0, pendingBefore - pendingAfter);
  const installmentsCoveredByAdvance = computeCoveredInstallmentsFromAdvance(advanceBefore, advanceAfter, rentAmount);
  const installmentsTotalInPayment = installmentsDeducted + installmentsCoveredByAdvance;

  return {
    balanceBefore,
    appliedToRent,
    centavosAhorro,
    advanceApplied,
    balanceAfter,
    installmentsDeducted,
    installmentsCoveredByAdvance,
    installmentsTotalInPayment,
    pendingBefore,
    pendingAfter,
    totalOtherCharges,
    otherChargesApplied,
    forcedOtherChargesRuleApplied: forcedRuleApplied
  };
}

function computeOtherChargesDueAfter(configured: OtherCharge[] | undefined, applied: OtherCharge[] | undefined): OtherCharge[] | undefined {
  if (!configured || configured.length === 0) return undefined;
  const due = configured
    .map((charge, index) => {
      const key = getOtherChargeKey(charge, index);
      const appliedAmount = roundMoney(
        Math.max(
          0,
          (applied ?? [])
            .filter((entry, entryIndex) => getOtherChargeKey(entry, entryIndex) === key)
            .reduce((sum, entry) => sum + entry.amount, 0)
        )
      );
      return {
        id: charge.id,
        label: charge.label,
        amount: roundMoney(Math.max(0, charge.amount - appliedAmount))
      };
    })
    .filter((charge) => charge.amount > 0);
  return due.length > 0 ? due : undefined;
}

function restoreOtherChargesAfterDelete(current: OtherCharge[] | undefined, applied: OtherCharge[] | undefined): OtherCharge[] {
  if (!applied || applied.length === 0) return current ?? [];
  const totals = new Map<string, OtherCharge>();
  for (const [index, charge] of (current ?? []).entries()) {
    const key = getOtherChargeKey(charge, index);
    totals.set(key, { id: charge.id, label: charge.label, amount: roundMoney(Math.max(0, charge.amount)) });
  }
  for (const [index, charge] of applied.entries()) {
    const key = getOtherChargeKey(charge, index);
    const previous = totals.get(key);
    const previousAmount = previous ? previous.amount : 0;
    totals.set(key, {
      id: charge.id,
      label: charge.label,
      amount: roundMoney(previousAmount + charge.amount)
    });
  }
  return [...totals.values()].filter((charge) => charge.amount > 0);
}

function loadNotifiedPayments(): NotifiedPayment[] {
  const raw = localStorage.getItem(NOTIFIED_PAYMENTS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is NotifiedPayment => {
        if (!item || typeof item !== "object") return false;
        const rec = item as Record<string, unknown>;
        return (
          typeof rec.id === "string" &&
          typeof rec.clientId === "string" &&
          typeof rec.amount === "number" &&
          Number.isFinite(rec.amount) &&
          typeof rec.createdAt === "string"
        );
      });
  } catch {
    return [];
  }
}

function saveNotifiedPayments(rows: NotifiedPayment[]): void {
  localStorage.setItem(NOTIFIED_PAYMENTS_KEY, JSON.stringify(rows));
}

function loadCashClosings(): CashClosing[] {
  const raw = localStorage.getItem(CASH_CLOSINGS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is CashClosing => {
      if (!item || typeof item !== "object") return false;
      const rec = item as Record<string, unknown>;
      return typeof rec.date === "string" && typeof rec.closedAt === "string";
    });
  } catch {
    return [];
  }
}

function saveCashClosings(rows: CashClosing[]): void {
  localStorage.setItem(CASH_CLOSINGS_KEY, JSON.stringify(rows));
}

function loadCashClosingAudit(): CashClosingAuditEvent[] {
  const raw = localStorage.getItem(CASH_CLOSING_AUDIT_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is CashClosingAuditEvent => {
      if (!item || typeof item !== "object") return false;
      const rec = item as Record<string, unknown>;
      return (
        typeof rec.id === "string" &&
        typeof rec.date === "string" &&
        (rec.action === "close" || rec.action === "reopen") &&
        typeof rec.actor === "string" &&
        typeof rec.reason === "string" &&
        typeof rec.createdAt === "string"
      );
    });
  } catch {
    return [];
  }
}

function saveCashClosingAudit(rows: CashClosingAuditEvent[]): void {
  localStorage.setItem(CASH_CLOSING_AUDIT_KEY, JSON.stringify(rows));
}

function loadChargeRuns(): ChargeRun[] {
  const raw = localStorage.getItem(CHARGE_RUNS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const rec = item as Record<string, unknown>;
        if (
          typeof rec.id !== "string" ||
          typeof rec.closingDate !== "string" ||
          typeof rec.targetDate !== "string" ||
          typeof rec.chargedClients !== "number" ||
          typeof rec.chargedTotal !== "number" ||
          typeof rec.createdAt !== "string"
        ) return null;
        const expectedClients = typeof rec.expectedClients === "number"
          ? rec.expectedClients
          : rec.chargedClients;
        const anomalyClients = typeof rec.anomalyClients === "number" ? rec.anomalyClients : 0;
        return {
          id: rec.id,
          closingDate: rec.closingDate,
          targetDate: rec.targetDate,
          expectedClients,
          chargedClients: rec.chargedClients,
          anomalyClients,
          chargedTotal: rec.chargedTotal,
          createdAt: rec.createdAt
        } satisfies ChargeRun;
      })
      .filter((item): item is ChargeRun => item !== null);
  } catch {
    return [];
  }
}

function saveChargeRuns(rows: ChargeRun[]): void {
  localStorage.setItem(CHARGE_RUNS_KEY, JSON.stringify(rows));
}

function escapeCsvCell(value: string | number | boolean): string {
  const raw = String(value ?? "");
  if (/[",\n]/.test(raw)) return `"${raw.replace(/"/g, "\"\"")}"`;
  return raw;
}

function downloadChargeCloseReportCsv(report: ChargeCloseReport): void {
  const header = [
    "unidad",
    "cliente",
    "debia_cobrar",
    "cobrado",
    "anomalia",
    "motivo",
    "saldo_antes",
    "saldo_despues",
    "monto_cargado",
    "lastCharge_antes",
    "lastCharge_despues"
  ];
  const rows = report.rows.map((row) => [
    row.unitId,
    row.name,
    row.shouldCharge ? "si" : "no",
    row.charged ? "si" : "no",
    row.anomaly ? "si" : "no",
    row.reason,
    row.balanceBefore.toFixed(2),
    row.balanceAfter.toFixed(2),
    row.chargedAmount.toFixed(2),
    row.lastChargeDateBefore,
    row.lastChargeDateAfter
  ]);
  const csv = [header, ...rows].map((line) => line.map(escapeCsvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = `cierre-${report.closingDate}-a-${report.targetDate}.csv`;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

export default function PaymentsPage({
  clients,
  bankRules,
  lateFeeSettings,
  otherChargesRetentionByClient,
  onClientsChange,
  payments,
  onPaymentsChange,
  onCashClose
}: Props) {
  const [form, setForm] = useState<PaymentForm>({
    clientId: "",
    dateApplied: toDateKey(new Date()),
    paymentMethod: "Efectivo",
    reference: "",
    amountReceived: ""
  });
  const [clientSearch, setClientSearch] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [confirmedPayment, setConfirmedPayment] = useState<Payment | null>(null);
  const [isRegisterOpen, setIsRegisterOpen] = useState(true);
  const [isNotifiedOpen, setIsNotifiedOpen] = useState(false);
  const [isCashClosingOpen, setIsCashClosingOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [historyClientId, setHistoryClientId] = useState<string>("all");
  const [historyGroupFilter, setHistoryGroupFilter] = useState<string>("all");
  const [historyDateFrom, setHistoryDateFrom] = useState<string>("");
  const [historyDateTo, setHistoryDateTo] = useState<string>("");
  const [historyColumnFilters, setHistoryColumnFilters] = useState<HistoryColumnFilters>({ ...EMPTY_HISTORY_COLUMN_FILTERS });
  const [historySortField, setHistorySortField] = useState<HistorySortField>("date");
  const [historySortDirection, setHistorySortDirection] = useState<SortDirection>("desc");
  const [historySelectedPaymentIds, setHistorySelectedPaymentIds] = useState<string[]>([]);
  const [isHistoryBulkDownloading, setIsHistoryBulkDownloading] = useState(false);
  const [historyBulkDownloadError, setHistoryBulkDownloadError] = useState("");
  const [historyPreviewPayment, setHistoryPreviewPayment] = useState<Payment | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Payment | null>(null);
  const [notifiedForm, setNotifiedForm] = useState<NotifiedPaymentForm>({
    unitId: "",
    amount: ""
  });
  const [notifiedPayments, setNotifiedPayments] = useState<NotifiedPayment[]>(() => loadNotifiedPayments());
  const [editingNotifiedId, setEditingNotifiedId] = useState<string | null>(null);
  const [editingNotifiedForm, setEditingNotifiedForm] = useState<NotifiedPaymentForm>({ unitId: "", amount: "" });
  const [notifiedSortField, setNotifiedSortField] = useState<NotifiedSortField>("createdAt");
  const [notifiedSortDirection, setNotifiedSortDirection] = useState<SortDirection>("desc");
  const [notifiedErrors, setNotifiedErrors] = useState<string[]>([]);
  const [cashClosings, setCashClosings] = useState<CashClosing[]>(() => loadCashClosings());
  const [cashClosingDate, setCashClosingDate] = useState<string>(toDateKey(new Date()));
  const [cashClosingActor, setCashClosingActor] = useState<string>("Operador");
  const [cashClosingReason, setCashClosingReason] = useState<string>("");
  const [cashClosingInfo, setCashClosingInfo] = useState<string>("");
  const [cashClosingError, setCashClosingError] = useState<string>("");
  const [cashClosingAudit, setCashClosingAudit] = useState<CashClosingAuditEvent[]>(() => loadCashClosingAudit());
  const [chargeRuns, setChargeRuns] = useState<ChargeRun[]>(() => loadChargeRuns());
  const [lateFeeLedger, setLateFeeLedger] = useState<LateFeeLedgerEntry[]>(() => loadLateFeeLedger());
  const [lastCloseReport, setLastCloseReport] = useState<ChargeCloseReport | null>(null);
  const [reopenTargetDate, setReopenTargetDate] = useState<string | null>(null);
  const [reopenReason, setReopenReason] = useState<string>("");
  const [pendingBankItems, setPendingBankItems] = useState<PendingBankItem[]>(() => loadPendingBankItems());
  const [pendingCardItems, setPendingCardItems] = useState<PendingCardItem[]>(() => loadPendingCardItems());
  const [isPendingOpen, setIsPendingOpen] = useState(true);
  const [isCardPendingOpen, setIsCardPendingOpen] = useState(false);
  const [pendingClassifyTarget, setPendingClassifyTarget] = useState<PendingBankItem | null>(null);
  const [pendingClassifyClientId, setPendingClassifyClientId] = useState("");
  const [pendingClassifySearch, setPendingClassifySearch] = useState("");
  const [pendingImportError, setPendingImportError] = useState("");
  const [pendingFilters, setPendingFilters] = useState<PendingColumnFilters>(() => ({ ...EMPTY_PENDING_FILTERS }));
  const [pendingOtherChargesInput, setPendingOtherChargesInput] = useState<Record<string, string>>({});
  const [manualOverrideForcedOtherCharges, setManualOverrideForcedOtherCharges] = useState(false);
  const [pendingManualOverrideForcedOtherCharges, setPendingManualOverrideForcedOtherCharges] = useState(false);
  const [manualAssignmentAudit, setManualAssignmentAudit] = useState<ManualBankAssignmentAudit[]>(() => loadManualBankAssignmentAudit());
  const [autoAmountInfo, setAutoAmountInfo] = useState("");
  const [paymentInfo, setPaymentInfo] = useState("");
  const [editingPendingCardId, setEditingPendingCardId] = useState<string | null>(null);
  const [editingPendingCardForm, setEditingPendingCardForm] = useState<PendingCardEditForm>({ folio: "", reference: "" });
  const [bulkPendingCardFolio, setBulkPendingCardFolio] = useState("");
  const [cardPendingMessage, setCardPendingMessage] = useState("");
  const [registerTravelFundInput, setRegisterTravelFundInput] = useState("");
  const [pendingTravelFundInputByFolio, setPendingTravelFundInputByFolio] = useState<Record<string, string>>({});
  const searchRef = useRef<HTMLInputElement>(null);
  const pendingTopScrollRef = useRef<HTMLDivElement>(null);
  const pendingTopInnerRef = useRef<HTMLDivElement>(null);
  const pendingBottomScrollRef = useRef<HTMLDivElement>(null);
  const historyTopScrollRef = useRef<HTMLDivElement>(null);
  const historyTopInnerRef = useRef<HTMLDivElement>(null);
  const historyBottomScrollRef = useRef<HTMLDivElement>(null);
  const autoDownloadedPaymentIdsRef = useRef<Set<string>>(new Set());
  const reconcilingCardRef = useRef(false);
  const cashSectionRef = useRef<HTMLElement>(null);
  const registerSectionRef = useRef<HTMLElement>(null);
  const notifiedSectionRef = useRef<HTMLElement>(null);
  const pendingSectionRef = useRef<HTMLElement>(null);
  const pendingCardSectionRef = useRef<HTMLElement>(null);
  const historySectionRef = useRef<HTMLElement>(null);

  function finalizeSuccessfulPayment(payment: Payment, options?: { openReceipt?: boolean }): void {
    if (options?.openReceipt) {
      setConfirmedPayment(payment);
    }
    if (autoDownloadedPaymentIdsRef.current.has(payment.id)) return;
    autoDownloadedPaymentIdsRef.current.add(payment.id);
    void downloadPaymentReceiptImage(payment).catch(() => {
      setErrors((prev) => {
        const msg = "Pago registrado, pero no se pudo descargar el recibo automaticamente. Intenta descargarlo manualmente.";
        return prev.includes(msg) ? prev : [...prev, msg];
      });
    });
  }

  const activeClients = useMemo(
    () => clients.filter((c) => !c.archivedAt && c.status !== "archivado"),
    [clients]
  );

  const filteredClients = useMemo(() => {
    const q = clientSearch.trim().toLowerCase();
    if (!q) return activeClients;
    return activeClients.filter((c) =>
      `${c.unitId} ${c.name} ${c.cedula ?? ""}`.toLowerCase().includes(q)
    );
  }, [activeClients, clientSearch]);

  const selectedClient = useMemo(
    () => clients.find((c) => c.id === form.clientId) ?? null,
    [clients, form.clientId]
  );

  const clientById = useMemo(() => new Map(clients.map((client) => [client.id, client])), [clients]);

  const [manualOtherChargesInput, setManualOtherChargesInput] = useState<Record<string, string>>({});

  const preview = useMemo(() => {
    if (!selectedClient) return null;
    const amount = parseFloat(form.amountReceived);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    const effectiveDateKey = form.dateApplied || toDateKey(new Date());

    return computeManualPaymentAllocation(
      selectedClient,
      amount,
      manualOtherChargesInput,
      otherChargesRetentionByClient,
      payments,
      effectiveDateKey,
      manualOverrideForcedOtherCharges
    );
  }, [form.amountReceived, form.dateApplied, manualOtherChargesInput, otherChargesRetentionByClient, payments, selectedClient, manualOverrideForcedOtherCharges]);
  const isForcedOtherChargesRuleClient = useMemo(
    () => (
      selectedClient
        ? shouldForceRetentionToOtherCharges(selectedClient, otherChargesRetentionByClient, payments, form.dateApplied || toDateKey(new Date()))
        : false
    ),
    [form.dateApplied, otherChargesRetentionByClient, payments, selectedClient]
  );
  const isForcedOtherChargesRuleActive = isForcedOtherChargesRuleClient && !manualOverrideForcedOtherCharges;
  const selectedClientRetentionConfig = useMemo(
    () => (
      selectedClient
        ? getConfiguredOtherChargesRetentionConfig(selectedClient, otherChargesRetentionByClient)
        : { amount: DEFAULT_OTHER_CHARGES_RETENTION, cycle: "daily" as const }
    ),
    [otherChargesRetentionByClient, selectedClient]
  );

  const isZeroBalance = selectedClient !== null && selectedClient.balance === 0;
  const isBankPayment = BANK_PAYMENT_METHODS.has(form.paymentMethod);
  const isCardPayment = form.paymentMethod === "Tarjeta";

  const notifiedRows = useMemo(() => {
    const getClient = (clientId: string): Client | null => clients.find((c) => c.id === clientId) ?? null;
    const dir = notifiedSortDirection === "asc" ? 1 : -1;
    return [...notifiedPayments].sort((a, b) => {
      if (notifiedSortField === "amount") {
        const cmp = (a.amount - b.amount) * dir;
        if (cmp !== 0) return cmp;
      } else if (notifiedSortField === "unit") {
        const aUnit = (getClient(a.clientId)?.unitId ?? "").toLowerCase();
        const bUnit = (getClient(b.clientId)?.unitId ?? "").toLowerCase();
        const cmp = aUnit.localeCompare(bUnit) * dir;
        if (cmp !== 0) return cmp;
      } else if (notifiedSortField === "client") {
        const aName = (getClient(a.clientId)?.name ?? "").toLowerCase();
        const bName = (getClient(b.clientId)?.name ?? "").toLowerCase();
        const cmp = aName.localeCompare(bName) * dir;
        if (cmp !== 0) return cmp;
      } else {
        const cmp = a.createdAt.localeCompare(b.createdAt) * dir;
        if (cmp !== 0) return cmp;
      }
      return b.createdAt.localeCompare(a.createdAt);
    });
  }, [notifiedPayments, notifiedSortDirection, notifiedSortField, clients]);

  const notifiedClientMatch = useMemo(() => {
    const unit = notifiedForm.unitId.trim().toLowerCase();
    if (!unit) return null;
    return activeClients.find((c) => c.unitId.trim().toLowerCase() === unit) ?? null;
  }, [activeClients, notifiedForm.unitId]);

  const editingNotifiedClientMatch = useMemo(() => {
    const unit = editingNotifiedForm.unitId.trim().toLowerCase();
    if (!unit) return null;
    return activeClients.find((c) => c.unitId.trim().toLowerCase() === unit) ?? null;
  }, [activeClients, editingNotifiedForm.unitId]);

  const closedDateSet = useMemo(
    () => new Set(cashClosings.map((c) => c.date)),
    [cashClosings]
  );

  const operationalDateKey = useMemo(() => {
    const today = toDateKey(new Date());
    const candidates = cashClosings.map((c) => c.date.trim()).filter((d) => d.length > 0);
    if (candidates.length === 0) return today;
    const latestClosed = [...new Set(candidates)].sort().at(-1);
    if (!latestClosed) return today;
    const latestClosedDate = parseDateKey(latestClosed);
    if (!latestClosedDate) return today;
    const nextOperational = new Date(latestClosedDate);
    nextOperational.setDate(nextOperational.getDate() + 1);
    return toDateKey(nextOperational);
  }, [cashClosings]);

  const operationalDate = useMemo(() => {
    const parsed = parseDateKey(operationalDateKey);
    return parsed ? startOfDay(parsed) : startOfDay(new Date());
  }, [operationalDateKey]);

  const monthEndDate = useMemo(() => getMonthEndDate(operationalDate), [operationalDate]);

  const projectedNextChargeDate = useMemo(() => {
    if (!selectedClient || !preview || preview.balanceAfter > 0) return null;
    const projectedClient: Client = {
      ...selectedClient,
      balance: preview.balanceAfter,
      advanceBalance: roundMoney((selectedClient.advanceBalance ?? 0) + preview.advanceApplied),
      savings: roundMoney(selectedClient.savings + preview.centavosAhorro)
    };
    return findNextChargeDay(projectedClient, operationalDate);
  }, [operationalDate, preview, selectedClient]);

  const previewAdvanceLetterLabel = useMemo(() => {
    if (!selectedClient || !preview || preview.advanceApplied <= 0) return null;
    return getAdvanceLetterLabel(selectedClient, preview.advanceApplied);
  }, [preview, selectedClient]);

  const monthEndSuggestion = useMemo(() => {
    if (!selectedClient) return null;
    if (selectedClient.balance > 0) return null;
    if ((selectedClient.otherCharges ?? []).length > 0) return null;
    const result = computeRequiredWholeAmountToReachDate(selectedClient, operationalDate, monthEndDate);
    return {
      requiredWholeAmount: result.requiredWholeAmount,
      targetDate: monthEndDate,
      resultingNextDate: result.resultingNextDate
    };
  }, [monthEndDate, operationalDate, selectedClient]);

  const hasPendingColumnFilters = useMemo(
    () => Object.values(pendingFilters).some((value) => value.trim().length > 0),
    [pendingFilters]
  );

  const filteredPendingBankItems = useMemo(() => {
    const normalize = (value: string): string => value.trim().toLowerCase();
    const includesFilter = (target: string, filterValue: string): boolean => {
      const query = normalize(filterValue);
      if (!query) return true;
      return normalize(target).includes(query);
    };

    const asAmountLabel = (value: number): string => `${value.toFixed(2)} ${formatCurrency(value)}`;

    return pendingBankItems.filter((item) => {
      const assignedClient = item.suggestedClientId ? (clientById.get(item.suggestedClientId) ?? null) : null;
      const hasOtherCharges = !!(assignedClient?.otherCharges?.length);
      const { nombre, centavos, notificado, score } = getSimilaritySignals(item);
      const isHighSim = score >= 2 && !hasOtherCharges && !!assignedClient;
      const unitProbability = score >= 3 ? "Alta" : score === 2 ? "Media" : score === 1 ? "Baja" : "Sin datos";
      const pendingPreview = getPendingBankPreview(item, assignedClient);
      const actionLabels = [
        isHighSim && assignedClient ? "Aplicar" : "",
        assignedClient && (!isHighSim || hasOtherCharges) ? (hasOtherCharges ? "Revisar cargos" : "Revisar") : "",
        "Ignorar"
      ].filter(Boolean).join(" ");
      const previewLabel = pendingPreview
        ? `Renta ${formatCurrency(pendingPreview.rentAmount)} ${pendingPreview.frequencyLabel} Pactadas ${pendingPreview.installmentsAgreed} Cuotas ${pendingPreview.installmentsRemainingAfter} Impacto ${pendingPreview.installmentsDeducted} Cobro ${formatCurrency(pendingPreview.balanceAfter)}`
        : "Sin vista previa";
      const unitLabel = assignedClient ? `${assignedClient.unitId} ${assignedClient.name}` : "Sin asignar";
      const groupLabel = item.mappedGroup ? `Grupo ${item.mappedGroup}` : "";
      const nameLabel = item.suggestedClientName || item.extractedName || "";
      const similarityLabel = [
        isHighSim ? "Alta similitud" : "Sin alta similitud",
        `Probabilidad ${unitProbability}`,
        nombre ? "nombre" : "",
        centavos ? "centavos" : "",
        notificado ? "notificado" : "",
        hasOtherCharges ? "otros cargos" : ""
      ].filter(Boolean).join(" ");

      return (
        includesFilter(item.folio, pendingFilters.folio) &&
        includesFilter(item.accountNumber ?? "", pendingFilters.account) &&
        includesFilter(groupLabel, pendingFilters.group) &&
        includesFilter(item.dateApplied, pendingFilters.date) &&
        includesFilter(asAmountLabel(item.amountReceived), pendingFilters.amount) &&
        includesFilter(nameLabel, pendingFilters.name) &&
        includesFilter(similarityLabel, pendingFilters.similarity) &&
        includesFilter(unitLabel, pendingFilters.unit) &&
        includesFilter(previewLabel, pendingFilters.preview) &&
        includesFilter(item.description, pendingFilters.description) &&
        includesFilter(actionLabels, pendingFilters.actions)
      );
    });
  }, [clientById, pendingBankItems, pendingFilters, notifiedPayments, otherChargesRetentionByClient]);

  function updatePendingFilter(field: keyof PendingColumnFilters, value: string): void {
    setPendingFilters((prev) => ({ ...prev, [field]: value }));
  }

  function clearPendingFilters(): void {
    setPendingFilters({ ...EMPTY_PENDING_FILTERS });
  }

  function normalizeToOperationalDate(dateKey: string): string {
    if (!dateKey) return operationalDateKey;
    return dateKey > operationalDateKey ? operationalDateKey : dateKey;
  }

  useEffect(() => {
    setForm((prev) => (prev.dateApplied === operationalDateKey ? prev : { ...prev, dateApplied: operationalDateKey }));
  }, [operationalDateKey]);

  useEffect(() => {
    setCashClosingDate((prev) => (prev === operationalDateKey ? prev : operationalDateKey));
  }, [operationalDateKey]);

  useEffect(() => {
    if (reconcilingCardRef.current) return;
    const normalizedPayments = payments.map((p) => {
      const nextDateApplied = normalizeToOperationalDate(p.dateApplied);
      return nextDateApplied === p.dateApplied ? p : { ...p, dateApplied: nextDateApplied };
    });
    const changedPayments = normalizedPayments.some((p, idx) => p.dateApplied !== payments[idx].dateApplied);
    if (changedPayments) {
      onPaymentsChange(normalizedPayments);
    }

    const normalizedPending = pendingBankItems.map((item) => {
      const nextDateApplied = normalizeToOperationalDate(item.dateApplied);
      return nextDateApplied === item.dateApplied ? item : { ...item, dateApplied: nextDateApplied };
    });
    const changedPending = normalizedPending.some((item, idx) => item.dateApplied !== pendingBankItems[idx].dateApplied);
    if (changedPending) {
      setPendingBankItems(normalizedPending);
      savePendingBankItems(normalizedPending);
    }
  }, [operationalDateKey, payments, pendingBankItems, onPaymentsChange]);

  useEffect(() => {
    if (reconcilingCardRef.current) return;
    if (pendingCardItems.length === 0 || pendingBankItems.length === 0) return;

    const amountTolerance = 0.02;
    const pendingByFolio = new Map<string, PendingCardItem[]>();
    for (const item of pendingCardItems) {
      const normalized = normalizeFolioToken(item.folio);
      if (!normalized) continue;
      const current = pendingByFolio.get(normalized) ?? [];
      current.push(item);
      pendingByFolio.set(normalized, current);
    }

    const nextPayments = [...payments];
    let paymentsUpdated = false;
    const usedBankIndexes = new Set<number>();
    const reconciledCardIds = new Set<string>();
    let reconciledGroups = 0;
    let reconciledCardCount = 0;

    for (let index = 0; index < pendingBankItems.length; index += 1) {
      const bankItem = pendingBankItems[index];
      const normalizedBankFolio = normalizeFolioToken(bankItem.folio);
      if (!normalizedBankFolio) continue;
      if (usedBankIndexes.has(index)) continue;

      const groupedCards = pendingByFolio.get(normalizedBankFolio);
      if (!groupedCards || groupedCards.length === 0) continue;
      const groupedAmount = roundMoney(groupedCards.reduce((sum, item) => sum + roundMoney(item.amountExpected), 0));
      if (Math.abs(groupedAmount - roundMoney(bankItem.amountReceived)) > amountTolerance) continue;

      usedBankIndexes.add(index);
      reconciledGroups += 1;
      reconciledCardCount += groupedCards.length;

      for (const cardItem of groupedCards) {
        reconciledCardIds.add(cardItem.id);
        if (!cardItem.appliedPaymentId) continue;
        const paymentIndex = nextPayments.findIndex((p) => p.id === cardItem.appliedPaymentId);
        if (paymentIndex < 0) continue;
        const currentPayment = nextPayments[paymentIndex];
        const currentReference = currentPayment.reference?.trim() ?? "";
        const reconciliationTag = `TARJETA-CONCILIADA | FOLIO:${normalizedBankFolio} | FECHA-BANCO:${bankItem.dateApplied || operationalDateKey}`;
        if (currentReference.toUpperCase().includes("TARJETA-CONCILIADA")) continue;
        nextPayments[paymentIndex] = {
          ...currentPayment,
          reference: currentReference ? `${currentReference} | ${reconciliationTag}` : reconciliationTag
        };
        paymentsUpdated = true;
      }
    }

    if (reconciledCardIds.size === 0) return;

    const remainingCardItems = pendingCardItems.filter((item) => !reconciledCardIds.has(item.id));
    const remainingBankItems = pendingBankItems.filter((_, index) => !usedBankIndexes.has(index));
    reconcilingCardRef.current = true;
    if (paymentsUpdated) onPaymentsChange(nextPayments);
    setPendingBankItems(remainingBankItems);
    savePendingBankItems(remainingBankItems);
    setPendingCardItems(remainingCardItems);
    savePendingCardItems(remainingCardItems);
    setPendingImportError(`Tarjetas conciliadas automaticamente: ${reconciledCardCount} pago(s) en ${reconciledGroups} lote(s).`);
    setTimeout(() => { reconcilingCardRef.current = false; }, 0);
  }, [pendingCardItems, pendingBankItems, payments, operationalDateKey, onPaymentsChange]);

  useEffect(() => {
    if (!isPendingOpen) return;
    const top = pendingTopScrollRef.current;
    const bottom = pendingBottomScrollRef.current;
    if (!top || !bottom) return;

    let syncing = false;
    const onTopScroll = () => {
      if (syncing) return;
      syncing = true;
      bottom.scrollLeft = top.scrollLeft;
      syncing = false;
    };
    const onBottomScroll = () => {
      if (syncing) return;
      syncing = true;
      top.scrollLeft = bottom.scrollLeft;
      syncing = false;
    };

    top.addEventListener("scroll", onTopScroll, { passive: true });
    bottom.addEventListener("scroll", onBottomScroll, { passive: true });
    return () => {
      top.removeEventListener("scroll", onTopScroll);
      bottom.removeEventListener("scroll", onBottomScroll);
    };
  }, [isPendingOpen, pendingBankItems.length]);

  useEffect(() => {
    if (!isPendingOpen) return;
    const top = pendingTopScrollRef.current;
    const topInner = pendingTopInnerRef.current;
    const bottom = pendingBottomScrollRef.current;
    if (!top || !topInner || !bottom) return;

    const updateTopWidth = () => {
      const table = bottom.querySelector("table");
      const width = table ? table.scrollWidth : bottom.scrollWidth;
      topInner.style.width = `${Math.max(width, bottom.clientWidth)}px`;
      top.scrollLeft = bottom.scrollLeft;
    };

    updateTopWidth();
    window.addEventListener("resize", updateTopWidth);
    return () => {
      window.removeEventListener("resize", updateTopWidth);
    };
  }, [isPendingOpen, pendingBankItems.length, activeClients.length]);

  function isDateClosed(dateKey: string): boolean {
    return closedDateSet.has(dateKey);
  }

  function applyNextDayChargesFromClosing(closingDateKey: string): ChargeApplyResult {
    const closingDate = parseDateKey(closingDateKey);
    if (!closingDate) {
      return {
        targetDate: closingDateKey,
        alreadyProcessed: true,
        expectedClients: 0,
        chargedClients: 0,
        anomalyClients: 0,
        chargedTotal: 0,
        lateFeeClients: 0,
        lateFeeTotal: 0,
        rows: []
      };
    }
    const targetDate = new Date(closingDate);
    targetDate.setDate(targetDate.getDate() + 1);
    const targetDateKey = toDateKey(targetDate);
    const alreadyProcessed = chargeRuns.some((r) => r.targetDate === targetDateKey);

    const lateFeeResult = applyLateFeesForClosingDate({
      clients,
      payments,
      lateFeeLedger,
      lateFeeSettings,
      closingDateKey
    });
    const clientsWithLateFees = lateFeeResult.clients;
    const newLateFeeEntries = lateFeeResult.newEntries;
    const lateFeeClients = lateFeeResult.lateFeeClients;
    const lateFeeTotal = lateFeeResult.lateFeeTotal;

    if (alreadyProcessed) {
      if (newLateFeeEntries.length > 0) {
        const nextLedger = [...newLateFeeEntries, ...lateFeeLedger].slice(0, 10000);
        setLateFeeLedger(nextLedger);
        saveLateFeeLedger(nextLedger);
        onClientsChange(clientsWithLateFees);
      }
      return {
        targetDate: targetDateKey,
        alreadyProcessed: true,
        expectedClients: 0,
        chargedClients: 0,
        anomalyClients: 0,
        chargedTotal: 0,
        lateFeeClients,
        lateFeeTotal,
        rows: []
      };
    }

    let expectedClients = 0;
    let chargedClients = 0;
    let anomalyClients = 0;
    let chargedTotal = 0;
    const rows: ChargeReportRow[] = [];
    const nextClients = clientsWithLateFees.map((client) => {
      if (
        client.archivedAt ||
        client.status === "archivado" ||
        client.status === "taller" ||
        client.status === "chapisteria" ||
        client.status === "custodia"
      ) {
        return client;
      }
      const clientLastCharge = client.lastChargeDate ? parseDateKey(client.lastChargeDate) : null;
      const alreadyChargedThruTarget = clientLastCharge !== null && clientLastCharge >= targetDate;
      const canCharge = Number.isFinite(client.rentAmount) && client.rentAmount > 0;
      const shouldChargeByRule = canCharge && isChargeDay(client, targetDate);
      if (shouldChargeByRule) expectedClients += 1;
      const balanceBefore = roundMoney(client.balance);
      const lastBefore = client.lastChargeDate ?? "-";

      if (shouldChargeByRule && alreadyChargedThruTarget) {
        rows.push({
          clientId: client.id,
          unitId: client.unitId,
          name: client.name,
          shouldCharge: true,
          charged: false,
          anomaly: false,
          reason: "Cobro ya aplicado previamente",
          balanceBefore,
          balanceAfter: balanceBefore,
          chargedAmount: 0,
          lastChargeDateBefore: lastBefore,
          lastChargeDateAfter: lastBefore
        });
        return client;
      }

      const shouldCharge = !alreadyChargedThruTarget && shouldChargeByRule;
      if (!shouldCharge) {
        const reason = alreadyChargedThruTarget
          ? "Sin cobro: fecha ya cubierta"
          : shouldChargeByRule
            ? "Sin cobro por estado de fecha"
            : "No corresponde por regla";
        const lastAfter = alreadyChargedThruTarget
          ? (client.lastChargeDate ?? targetDateKey)
          : targetDateKey;
        rows.push({
          clientId: client.id,
          unitId: client.unitId,
          name: client.name,
          shouldCharge: shouldChargeByRule,
          charged: false,
          anomaly: false,
          reason,
          balanceBefore,
          balanceAfter: balanceBefore,
          chargedAmount: 0,
          lastChargeDateBefore: lastBefore,
          lastChargeDateAfter: lastAfter
        });
        if (alreadyChargedThruTarget) return client;
        return { ...client, lastChargeDate: targetDateKey };
      }
      chargedClients += 1;
      const isFirstSundayCharge = client.frequency === "daily" && targetDate.getDay() === 0 && !!client.chargeFirstSunday && !client.firstSundayChargedAt;
      const currentAdvance = roundMoney(client.advanceBalance ?? 0);
      const consumedAdvance = roundMoney(Math.min(currentAdvance, client.rentAmount));
      const uncoveredRent = roundMoney(Math.max(0, client.rentAmount - consumedAdvance));
      const balanceAfter = roundMoney(client.balance + uncoveredRent);
      chargedTotal = roundMoney(chargedTotal + uncoveredRent);
      rows.push({
        clientId: client.id,
        unitId: client.unitId,
        name: client.name,
        shouldCharge: true,
        charged: true,
        anomaly: false,
        reason: consumedAdvance > 0 ? "Cobrado con consumo de adelanto" : "Cobrado",
        balanceBefore,
        balanceAfter,
        chargedAmount: uncoveredRent,
        lastChargeDateBefore: lastBefore,
        lastChargeDateAfter: targetDateKey
      });
      return {
        ...client,
        balance: balanceAfter,
        advanceBalance: roundMoney(Math.max(0, currentAdvance - consumedAdvance)),
        firstSundayChargedAt: isFirstSundayCharge ? targetDateKey : client.firstSundayChargedAt,
        lastChargeDate: targetDateKey
      };
    });

    if (anomalyClients > 0) {
      return {
        targetDate: targetDateKey,
        alreadyProcessed,
        expectedClients,
        chargedClients,
        anomalyClients,
        chargedTotal,
        lateFeeClients: 0,
        lateFeeTotal: 0,
        rows,
        blockingError: `No se pudo cerrar: ${anomalyClients} cliente(s) tenian estado inconsistente para ${targetDateKey}.`
      };
    }

    if (newLateFeeEntries.length > 0) {
      const nextLedger = [...newLateFeeEntries, ...lateFeeLedger].slice(0, 10000);
      setLateFeeLedger(nextLedger);
      saveLateFeeLedger(nextLedger);
    }

    onClientsChange(nextClients);

    const run: ChargeRun = {
      id: crypto.randomUUID(),
      closingDate: closingDateKey,
      targetDate: targetDateKey,
      expectedClients,
      chargedClients,
      anomalyClients,
      chargedTotal,
      createdAt: new Date().toISOString()
    };
    const nextRuns = [run, ...chargeRuns].slice(0, 400);
    setChargeRuns(nextRuns);
    saveChargeRuns(nextRuns);

    return {
      targetDate: targetDateKey,
      alreadyProcessed,
      expectedClients,
      chargedClients,
      anomalyClients,
      chargedTotal,
      lateFeeClients,
      lateFeeTotal,
      rows
    };
  }

  function repairMojibake(value: string): string {
    if (!/[\u00C3\u00C2\u00E2]/.test(value)) return value;
    try {
      return decodeURIComponent(escape(value));
    } catch {
      return value;
    }
  }

  function normalizeBankText(value: string): string {
    return repairMojibake(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\x20-\x7E]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeBankName(value: string): string {
    return normalizeBankText(value).toUpperCase();
  }

  function normalizeAccountNumber(value: string): string {
    return normalizeBankText(value).replace(/\D+/g, "");
  }

  function normalizeFolioToken(value: string): string {
    return normalizeBankText(value).toUpperCase().replace(/\s+/g, "");
  }

  function extractFoliosFromReference(reference: string): string[] {
    const normalized = normalizeBankText(reference);
    if (!normalized) return [];

    const taggedFolios = Array.from(normalized.matchAll(/FOLIO\s*:\s*([^\s|]+)/gi))
      .map((match) => normalizeFolioToken(match[1] ?? ""))
      .filter((folio) => folio.length > 0);
    if (taggedFolios.length > 0) {
      return [...new Set(taggedFolios)];
    }

    const legacyFallback = normalizeFolioToken(
      normalized
        .replace(/^REFERENCIA\s*:\s*/i, "")
        .replace(/^REF\s*:\s*/i, "")
        .replace(/^FOLIO\s*:?/i, "")
    );
    return legacyFallback ? [legacyFallback] : [];
  }

  function buildExistingBankFolioSet(rows: Payment[]): Set<string> {
    const set = new Set<string>();
    for (const payment of rows) {
      if (!BANK_PAYMENT_METHODS.has(payment.paymentMethod)) continue;
      for (const folio of extractFoliosFromReference(payment.reference ?? "")) {
        set.add(folio);
      }
    }
    return set;
  }

  function buildExistingProcessedFolioSetForCsvImport(rows: Payment[]): Set<string> {
    const set = new Set<string>();
    for (const payment of rows) {
      const reference = payment.reference ?? "";
      const isBankPayment = BANK_PAYMENT_METHODS.has(payment.paymentMethod);
      const isReconciledCardPayment =
        payment.paymentMethod === "Tarjeta" &&
        reference.toUpperCase().includes("TARJETA-CONCILIADA");
      if (!isBankPayment && !isReconciledCardPayment) continue;
      for (const folio of extractFoliosFromReference(reference)) {
        set.add(folio);
      }
    }
    return set;
  }

  function buildExistingCardPendingFolioSet(rows: PendingCardItem[]): Set<string> {
    const set = new Set<string>();
    for (const item of rows) {
      const folio = normalizeFolioToken(item.folio);
      if (folio) set.add(folio);
    }
    return set;
  }

  function extractGroupCodeFromUnit(unitId: string): string {
    const match = normalizeBankText(unitId).match(/^([A-Za-z]+)/);
    return match ? match[1].toUpperCase() : "";
  }

  function findMappedGroupByAccount(accountNumber: string): string {
    const normalizedAccount = normalizeAccountNumber(accountNumber);
    if (!normalizedAccount) return "";
    const activeRule = bankRules.find(
      (rule) => rule.active && normalizeAccountNumber(rule.accountNumber) === normalizedAccount
    );
    return activeRule ? normalizeBankText(activeRule.groupCode).toUpperCase() : "";
  }

  function parseBankDescription(description: string): { referenceId: string; extractedName: string } {
    const clean = normalizeBankText(description);
    const byBancoGeneral = clean.match(/BANCO GENERAL-(\d+)/i) ?? clean.match(/ST\. GEORGES BANK-(\d+)/i);
    let referenceId = byBancoGeneral?.[1] ?? "";
    if (!referenceId) {
      const byHyphen = clean.match(/-(\d{4,})(?:-|$)/);
      referenceId = byHyphen?.[1] ?? "";
    }
    const segments = clean.split("-").map((s) => normalizeBankText(s)).filter(Boolean);
    const extractedNameRaw = segments.length > 0 ? segments[segments.length - 1] : "";
    const extractedName = extractedNameRaw.replace(/[^A-Za-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
    return { referenceId, extractedName };
  }

  function inferBankPaymentMethod(transactionCode: string | undefined, description: string): PaymentMethod {
    const code = normalizeBankText(transactionCode ?? "");
    const text = normalizeBankName(description);

    // Primary mapping by bank transaction code (validated from real CSV history)
    if (code === "253-215") return "ACH Express";
    if (code === "252" || code === "253-921") return "Deposito Bancario";
    if (code === "253-104" || code === "2627" || code === "253-934") return "Transferencia Bancaria";

    // Fallback mapping by description
    if (/\bXPRESS\b|\bX?PRESS\b|ACH\s*XP/.test(text)) return "ACH Express";
    if (/\bDEPOSITO\b|\bDEPOS\b|\bCNB\b|DEPOSITO COMERCIOS/.test(text)) return "Deposito Bancario";
    return "Transferencia Bancaria";
  }

  function findClientByNamePrefix(name: string, candidateClients: Client[]): Client | null {
    if (!name || name.length < 4) return null;
    const prefix = normalizeBankName(name);
    const matches = candidateClients.filter((c) => normalizeBankName(c.name).startsWith(prefix));
    return matches.length === 1 ? matches[0] : null;
  }

  function parseCsvRow(line: string): string[] {
    const row: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (ch === "\"") {
        const next = line[i + 1];
        if (inQuotes && next === "\"") {
          current += "\"";
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }
      if (ch === "," && !inQuotes) {
        row.push(current);
        current = "";
        continue;
      }
      current += ch;
    }
    row.push(current);
    return row;
  }

  function coerceCsvColumns(line: string, expectedColumns: number): string[] | null {
    const cols = parseCsvRow(line);
    if (cols.length === expectedColumns) return cols;
    if (cols.length < expectedColumns) return null;
    const tailColumnsCount = 13; // Debito..Moneda
    if (expectedColumns !== 18 || cols.length < 5 + tailColumnsCount) return null;
    const descriptionStart = 4;
    const descriptionEnd = cols.length - tailColumnsCount - 1;
    if (descriptionEnd < descriptionStart) return null;
    const mergedDescription = cols.slice(descriptionStart, descriptionEnd + 1).join(",");
    const reconstructed = [
      ...cols.slice(0, descriptionStart),
      mergedDescription,
      ...cols.slice(descriptionEnd + 1)
    ];
    return reconstructed.length === expectedColumns ? reconstructed : null;
  }

  function parseBankAmount(rawValue: string): number {
    const raw = normalizeBankText(rawValue);
    if (!raw) return NaN;

    let cleaned = raw.replace(/[^\d,.-]/g, "");
    const commaCount = (cleaned.match(/,/g) ?? []).length;
    const dotCount = (cleaned.match(/\./g) ?? []).length;

    if (commaCount > 0 && dotCount > 0) {
      if (cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".")) {
        cleaned = cleaned.replace(/\./g, "").replace(",", ".");
      } else {
        cleaned = cleaned.replace(/,/g, "");
      }
    } else if (commaCount > 0 && dotCount === 0) {
      cleaned = cleaned.replace(",", ".");
    } else {
      cleaned = cleaned.replace(/,/g, "");
    }

    return Number(cleaned);
  }

  function isIgnoredBankMovement(transactionCode: string, description: string): boolean {
    const code = normalizeBankText(transactionCode);
    const text = normalizeBankName(description);

    if (code.startsWith("264-")) return true;
    if (code === "52" || code === "253-592") return true;
    if (text.includes("ITBMS")) return true;
    if (text.includes("POLIZA") || text.includes("POLIZA")) return true;
    if (text.includes("PAGO DE CHEQUE")) return true;
    if (text.includes("RETENCION")) return true;
    if (text.includes("COMISION")) return true;
    if (text.includes("PRP PAGO")) return true;

    return false;
  }

  function parseNotifiedDateKey(createdAt: string): string {
    const d = new Date(createdAt);
    if (Number.isNaN(d.valueOf())) return "";
    return toDateKey(d);
  }

  function isNotifiedCandidateMatch(candidate: NotifiedPayment, clientId: string, amount: number, dateApplied: string): boolean {
    if (candidate.clientId !== clientId) return false;
    if (Math.abs(roundMoney(candidate.amount) - roundMoney(amount)) > NOTIFIED_AMOUNT_TOLERANCE) return false;

    const bankDate = parseDateKey(dateApplied);
    const notifiedDate = parseDateKey(parseNotifiedDateKey(candidate.createdAt));
    if (!bankDate || !notifiedDate) return true;
    const diffDays = Math.abs(Math.round((bankDate.getTime() - notifiedDate.getTime()) / 86400000));
    return diffDays <= NOTIFIED_DAYS_WINDOW;
  }

  function removeOneMatchingNotified(rows: NotifiedPayment[], clientId: string, amount: number, dateApplied: string): NotifiedPayment[] {
    const matchIndex = rows.findIndex((row) => isNotifiedCandidateMatch(row, clientId, amount, dateApplied));
    if (matchIndex === -1) return rows;
    return rows.filter((_, idx) => idx !== matchIndex);
  }

  function findClientFromNotified(amount: number, dateApplied: string, candidateClients: Client[]): Client | null {
    const candidateSet = new Set(candidateClients.map((c) => c.id));
    const candidates = notifiedPayments.filter((row) => {
      if (Math.abs(roundMoney(row.amount) - roundMoney(amount)) > NOTIFIED_AMOUNT_TOLERANCE) return false;
      if (!candidateSet.has(row.clientId)) return false;
      const bankDate = parseDateKey(dateApplied);
      const notifiedDate = parseDateKey(parseNotifiedDateKey(row.createdAt));
      if (!bankDate || !notifiedDate) return true;
      const diffDays = Math.abs(Math.round((bankDate.getTime() - notifiedDate.getTime()) / 86400000));
      return diffDays <= NOTIFIED_DAYS_WINDOW;
    });

    const matchedClients = candidates
      .map((row) => candidateClients.find((c) => c.id === row.clientId) ?? null)
      .filter((c): c is Client => c !== null);
    const uniqueById = new Map(matchedClients.map((c) => [c.id, c]));
    if (uniqueById.size !== 1) return null;
    return [...uniqueById.values()][0];
  }

  async function processBankCSV(text: string): Promise<void> {
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.replace(/\uFEFF/g, ""))
      .filter((line) => normalizeBankText(line).length > 0);
    if (lines.length < 2) {
      setPendingImportError("El archivo CSV no tiene filas de datos.");
      return;
    }

    const headerColumns = parseCsvRow(lines[0]);
    const expectedColumns = headerColumns.length;
    const headers = headerColumns.map((h) =>
      h.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, "")
    );
    const idxAccount = headers.findIndex((h) => h === "cuenta");
    const idxFolio = headers.findIndex((h) => h === "folio");
    const idxCredito = headers.findIndex((h) => h.includes("credito") || h === "credit");
    const idxDesc = headers.findIndex((h) => h.includes("descripcion") || h.includes("descripci") || h.includes("detalle"));
    const idxTransactionCode = headers.findIndex((h) => h === "codigodetransaccion" || h === "codigotransaccion");

    if (idxAccount === -1 || idxFolio === -1 || idxCredito === -1) {
      setPendingImportError("No se encontraron las columnas esperadas (Cuenta, Folio, Credito). Verifica el archivo.");
      return;
    }

    const existingFoliosInPayments = buildExistingProcessedFolioSetForCsvImport(payments);
    const existingFoliosInPending = new Set(pendingBankItems.map((i) => normalizeFolioToken(i.folio)));

    const accountsInFile = new Set<string>();
    let invalidRows = 0;
    for (let i = 1; i < lines.length; i += 1) {
      const cols = coerceCsvColumns(lines[i], expectedColumns);
      if (!cols) {
        invalidRows += 1;
        continue;
      }
      const amount = parseBankAmount(normalizeBankText(cols[idxCredito] ?? ""));
      if (!Number.isFinite(amount) || amount <= 0) continue;
      const accountNumber = normalizeAccountNumber(cols[idxAccount] ?? "");
      if (accountNumber) accountsInFile.add(accountNumber);
    }

    const missingRuleAccounts = [...accountsInFile].filter((accountNumber) => !findMappedGroupByAccount(accountNumber));
    if (missingRuleAccounts.length > 0) {
      setPendingImportError(`No hay regla bancaria activa para cuenta(s): ${missingRuleAccounts.join(", ")}. Configuralas en Configuraciones > Regla bancaria.`);
      return;
    }

    const newPendingItems: PendingBankItem[] = [];
    const importedAt = new Date().toISOString();
    let autoMatched = 0;
    let skipped = 0;
    let ignoredNonClient = 0;

    for (let i = 1; i < lines.length; i += 1) {
      const cols = coerceCsvColumns(lines[i], expectedColumns);
      if (!cols) continue;

      const accountNumber = normalizeAccountNumber(cols[idxAccount] ?? "");
      const mappedGroup = findMappedGroupByAccount(accountNumber);
      const folio = normalizeFolioToken(cols[idxFolio] ?? "");
      const creditoRaw = normalizeBankText(cols[idxCredito] ?? "");
      const description = normalizeBankText(cols[idxDesc] ?? "");
      const transactionCode = idxTransactionCode >= 0 ? normalizeBankText(cols[idxTransactionCode] ?? "") : "";
      const amount = parseBankAmount(creditoRaw);

      if (!Number.isFinite(amount) || amount <= 0) continue;
      if (!folio || !mappedGroup) continue;
      if (isIgnoredBankMovement(transactionCode, description)) {
        ignoredNonClient += 1;
        continue;
      }
      if (existingFoliosInPayments.has(folio) || existingFoliosInPending.has(folio)) {
        skipped += 1;
        continue;
      }

      const capitalPart = Math.floor(amount);
      const centsPart = Math.round((amount - capitalPart) * 100) / 100;
      const dateApplied = operationalDateKey;
      const { referenceId, extractedName } = parseBankDescription(description);
      const candidateClients = activeClients.filter((client) => extractGroupCodeFromUnit(client.unitId) === mappedGroup);

      let matched: Client | null = null;
      if (referenceId) {
        const byUnit = candidateClients.filter((c) =>
          normalizeBankText(c.unitId) === referenceId || normalizeBankText(c.cedula ?? "") === referenceId
        );
        if (byUnit.length === 1) matched = byUnit[0];
      }
      if (!matched && extractedName) {
        const byExact = candidateClients.filter((c) => normalizeBankName(c.name) === normalizeBankName(extractedName));
        if (byExact.length === 1) matched = byExact[0];
      }
      if (!matched && extractedName) {
        matched = findClientByNamePrefix(extractedName, candidateClients);
      }
      if (!matched) {
        matched = findClientFromNotified(amount, dateApplied, candidateClients);
      }

      const baseItem: PendingBankItem = {
        folio,
        dateApplied,
        amountReceived: amount,
        capitalPart,
        centsPart,
        transactionCode: transactionCode || undefined,
        referenceId,
        extractedName,
        description,
        importedAt,
        accountNumber: accountNumber || undefined,
        mappedGroup
      };

      if (matched) {
        newPendingItems.push({
          ...baseItem,
          suggestedClientId: matched.id,
          suggestedClientName: matched.name
        });
        autoMatched += 1;
      } else {
        newPendingItems.push(baseItem);
      }
      existingFoliosInPending.add(folio);
    }

    if (newPendingItems.length === 0 && skipped === 0 && ignoredNonClient === 0) {
      setPendingImportError("No se encontraron creditos aplicables en el archivo.");
      return;
    }

    const unmatched = newPendingItems.filter((i) => !i.suggestedClientId).length;
    const groupsFound = [...new Set(newPendingItems.map((item) => item.mappedGroup).filter(Boolean))];
    const parts: string[] = [];
    if (groupsFound.length > 0) parts.push(`Grupo detectado: ${groupsFound.join(", ")}`);
    if (autoMatched > 0) parts.push(`${autoMatched} identificado(s) listos para aplicar`);
    if (unmatched > 0) parts.push(`${unmatched} sin cliente identificado`);
    if (skipped > 0) parts.push(`${skipped} duplicado(s) omitido(s)`);
    if (ignoredNonClient > 0) parts.push(`${ignoredNonClient} movimiento(s) no cliente ignorado(s)`);
    if (invalidRows > 0) parts.push(`${invalidRows} fila(s) irregulares reparadas/omitidas`);

    if (newPendingItems.length > 0) {
      if (newPendingItems.length > 0) {
        const next = [...pendingBankItems, ...newPendingItems];
        setPendingBankItems(next);
        savePendingBankItems(next);
        setIsPendingOpen(true);
      }
    }

    setPendingImportError(parts.length > 0 ? `${parts.join(" - ")}.` : "Importacion completada.");
  }

  async function handlePickAndProcessBankCSV(): Promise<void> {
    setPendingImportError("");
    try {
      const [fileHandle] = await (window as Window & { showOpenFilePicker: (opts: object) => Promise<FileSystemFileHandle[]> }).showOpenFilePicker({
        types: [{ description: "Movimientos del banco (CSV)", accept: { "text/csv": [".csv"], "text/plain": [".csv", ".txt"] } }],
        multiple: false
      });
      const file = await fileHandle.getFile();
      const text = await file.text();
      await processBankCSV(text);
    } catch (err) {
      if ((err as { name?: string }).name === "AbortError") return;
      setPendingImportError("Error al leer el archivo CSV. Verifica que sea el archivo de movimientos del banco.");
    }
  }

  async function handleImportBankCSV(): Promise<void> {
    await handlePickAndProcessBankCSV();
  }
  function handleOpenClassify(item: PendingBankItem): void {
    setPendingClassifyTarget(item);
    setPendingManualOverrideForcedOtherCharges(roundMoney(item.centsPart) > 0);
    if (item.suggestedClientId) {
      const c = clients.find((cl) => cl.id === item.suggestedClientId);
      setPendingClassifyClientId(item.suggestedClientId);
      setPendingClassifySearch(c ? `${c.unitId} - ${c.name}` : "");
    } else {
      setPendingClassifyClientId("");
      setPendingClassifySearch("");
    }
    setPendingOtherChargesInput({});
  }

  function handleDismissPending(folio: string): void {
    const next = pendingBankItems.filter((i) => i.folio !== folio);
    setPendingBankItems(next);
    savePendingBankItems(next);
  }

  function handleDismissAllPending(): void {
    if (pendingBankItems.length === 0) return;
    const confirmed = window.confirm(
      `Vas a ignorar ${pendingBankItems.length} pendiente(s) del banco. Esta accion no se puede deshacer.`
    );
    if (!confirmed) return;
    setPendingBankItems([]);
    savePendingBankItems([]);
    setPendingClassifyTarget(null);
    setPendingImportError(`Se ignoraron ${pendingBankItems.length} pendiente(s) del banco.`);
  }

  function handleRemovePendingCard(id: string): void {
    if (editingPendingCardId === id) {
      setEditingPendingCardId(null);
      setEditingPendingCardForm({ folio: "", reference: "" });
    }
    const next = pendingCardItems.filter((item) => item.id !== id);
    setPendingCardItems(next);
    savePendingCardItems(next);
  }

  function handleStartEditPendingCard(item: PendingCardItem): void {
    setEditingPendingCardId(item.id);
    setEditingPendingCardForm({
      folio: item.folio,
      reference: item.reference ?? ""
    });
    setCardPendingMessage("");
  }

  function handleCancelEditPendingCard(): void {
    setEditingPendingCardId(null);
    setEditingPendingCardForm({ folio: "", reference: "" });
  }

  function handleSaveEditPendingCard(item: PendingCardItem): void {
    const normalizedFolio = normalizeFolioToken(editingPendingCardForm.folio);
    if (!normalizedFolio) {
      setCardPendingMessage("Debes indicar un folio valido para poder conciliar el pago de tarjeta.");
      return;
    }

    const takenFolios = buildTakenFolioSet(payments, pendingBankItems, pendingCardItems);
    takenFolios.delete(normalizeFolioToken(item.folio));
    if (takenFolios.has(normalizedFolio)) {
      setCardPendingMessage(`No se puede usar el folio ${normalizedFolio}: ya fue utilizado.`);
      return;
    }

    const cleanedReference = editingPendingCardForm.reference.trim();
    const next = pendingCardItems.map((row) => {
      if (row.id !== item.id) return row;
      return {
        ...row,
        folio: normalizedFolio,
        reference: cleanedReference || undefined
      };
    });
    setPendingCardItems(next);
    savePendingCardItems(next);
    setEditingPendingCardId(null);
    setEditingPendingCardForm({ folio: "", reference: "" });
    setCardPendingMessage(`Pendiente actualizado. Folio listo para conciliar: ${normalizedFolio}.`);
  }

  function handleApplyFolioToAllPendingCards(): void {
    if (pendingCardItems.length === 0) return;
    const normalizedFolio = normalizeFolioToken(bulkPendingCardFolio);
    if (!normalizedFolio) {
      setCardPendingMessage("Debes indicar un folio valido para aplicar en lote.");
      return;
    }
    const takenFolios = buildTakenFolioSet(payments, pendingBankItems, pendingCardItems);
    if (takenFolios.has(normalizedFolio)) {
      setCardPendingMessage(`No se puede usar el folio ${normalizedFolio}: ya fue utilizado.`);
      return;
    }
    const next = pendingCardItems.map((row) => ({ ...row, folio: normalizedFolio }));
    setPendingCardItems(next);
    savePendingCardItems(next);
    setCardPendingMessage(`Folio ${normalizedFolio} aplicado a ${next.length} pendiente(s) de tarjeta.`);
  }

  function handleGeneratePendingCardReceipt(item: PendingCardItem): void {
    if (item.appliedPaymentId) {
      const existingPayment = payments.find((payment) => payment.id === item.appliedPaymentId);
      if (existingPayment) {
        finalizeSuccessfulPayment(existingPayment, { openReceipt: true });
        setCardPendingMessage(`Comprobante generado para folio ${item.folio}.`);
        return;
      }
    }
    const client = clients.find((c) => c.id === item.clientId);
    if (!client) {
      setCardPendingMessage(`No se pudo generar comprobante: cliente no encontrado para folio ${item.folio}.`);
      return;
    }
    const previewAllocation = computeManualPaymentAllocation(
      client,
      item.amountExpected,
      {},
      otherChargesRetentionByClient,
      payments,
      item.dateRegistered || operationalDateKey
    );
    const previewPayment: Payment = {
      id: crypto.randomUUID(),
      receiptNumber: `T-PEND-${new Date().getTime()}`,
      clientId: client.id,
      clientName: client.name,
      clientUnit: client.unitId,
      clientCedula: client.cedula,
      dateApplied: item.dateRegistered || operationalDateKey,
      paymentMethod: "Tarjeta",
      reference: `FOLIO:${normalizeFolioToken(item.folio)} | TARJETA-PENDIENTE-CONCILIACION | ${item.reference || "N/A"}`,
      amountReceived: item.amountExpected,
      appliedToRent: previewAllocation.appliedToRent,
      centavosAhorro: previewAllocation.centavosAhorro,
      advanceApplied: previewAllocation.advanceApplied > 0 ? previewAllocation.advanceApplied : undefined,
      advanceBalanceAfter: roundMoney((client.advanceBalance ?? 0) + previewAllocation.advanceApplied),
      otherChargesApplied: previewAllocation.otherChargesApplied.length > 0 ? previewAllocation.otherChargesApplied : undefined,
      otherChargesDueAfter: computeOtherChargesDueAfter(client.otherCharges, previewAllocation.otherChargesApplied),
      installmentsDeducted: previewAllocation.installmentsDeducted,
      installmentsFromDebt: previewAllocation.installmentsDeducted,
      installmentsFromAdvance: previewAllocation.installmentsCoveredByAdvance,
      installmentsTotalInPayment: previewAllocation.installmentsTotalInPayment,
      balanceBefore: previewAllocation.balanceBefore,
      balanceAfter: previewAllocation.balanceAfter,
      savingsBefore: client.savings,
      savingsAfter: roundMoney(client.savings + previewAllocation.centavosAhorro),
      installmentsPaidAfter: client.installmentsPaid + previewAllocation.installmentsTotalInPayment,
      installmentsRemainingAfter: Math.max(0, client.installmentsRemaining - previewAllocation.installmentsTotalInPayment),
      rentAmount: client.rentAmount,
      frequency: client.frequency,
      weeklyChargeDay: client.weeklyChargeDay,
      monthlyChargeDay: client.monthlyChargeDay,
      travelFundAvailableSnapshot: roundMoney(Math.max(0, client.travelFundBalance ?? 0)),
      createdAt: new Date().toISOString()
    };
    finalizeSuccessfulPayment(previewPayment, { openReceipt: true });
    setCardPendingMessage(`Comprobante generado para folio ${item.folio}.`);
  }

  function handlePendingUnitChange(item: PendingBankItem, nextClientId: string): void {
    const previous = item.suggestedClientId
      ? clients.find((c) => c.id === item.suggestedClientId) ?? null
      : null;
    const selected = clients.find((c) => c.id === nextClientId) ?? null;
    const next = pendingBankItems.map((row) => {
      if (row.folio !== item.folio) return row;
      if (!selected) {
        return { ...row, suggestedClientId: undefined, suggestedClientName: undefined };
      }
      return { ...row, suggestedClientId: selected.id, suggestedClientName: selected.name };
    });
    setPendingBankItems(next);
    savePendingBankItems(next);

    if (previous?.id !== selected?.id) {
      const event: ManualBankAssignmentAudit = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        folio: item.folio,
        accountNumber: item.accountNumber,
        mappedGroup: item.mappedGroup,
        previousClientId: previous?.id,
        previousClientUnit: previous?.unitId,
        previousClientName: previous?.name,
        nextClientId: selected?.id,
        nextClientUnit: selected?.unitId,
        nextClientName: selected?.name,
        reason: "Asignacion manual desde pendientes"
      };
      const nextAudit = [event, ...manualAssignmentAudit].slice(0, 2000);
      setManualAssignmentAudit(nextAudit);
      saveManualBankAssignmentAudit(nextAudit);
    }
  }

  function handleConfirmClassify(): void {
    if (!pendingClassifyTarget || !pendingClassifyClientId) return;
    const client = clients.find((c) => c.id === pendingClassifyClientId);
    if (!client) return;
    const normalizedFolio = normalizeFolioToken(pendingClassifyTarget.folio);
    const takenFolios = buildTakenFolioSet(
      payments,
      pendingBankItems,
      pendingCardItems,
      { excludePendingBankFolios: new Set([normalizedFolio]) }
    );
    if (takenFolios.has(normalizedFolio)) {
      setErrors([`No se puede registrar el folio ${normalizedFolio}: ya fue utilizado.`]);
      return;
    }

    const item = pendingClassifyTarget;
    const balanceBefore = roundMoney(client.balance);
    const savingsBefore = roundMoney(client.savings);
    const advanceBefore = roundMoney(client.advanceBalance ?? 0);
    const wholePart = roundMoney(item.capitalPart);
    const centsPart = roundMoney(item.centsPart);

    const { otherChargesApplied, totalOtherCharges } = computeEffectiveOtherChargesAllocation(
      client,
      pendingOtherChargesInput,
      wholePart,
      otherChargesRetentionByClient,
      payments,
      item.dateApplied,
      pendingManualOverrideForcedOtherCharges
    );

    // Capital after deducting otros cargos goes to rent
    const capitalForRent = roundMoney(Math.max(0, wholePart - totalOtherCharges));
    const appliedToRent = roundMoney(Math.min(capitalForRent, Math.max(0, balanceBefore)));
    const advanceApplied = roundMoney(Math.max(0, wholePart - appliedToRent - totalOtherCharges));
    const centavosAhorro = centsPart;
    const balanceAfter = roundMoney(Math.max(0, balanceBefore - appliedToRent));
    const savingsAfter = roundMoney(savingsBefore + centavosAhorro);
    const advanceAfter = roundMoney(advanceBefore + advanceApplied);
    const rentAmount = client.rentAmount;
    const pendingBefore = rentAmount > 0 ? Math.ceil(balanceBefore / rentAmount) : 0;
    const pendingAfter = rentAmount > 0 && balanceAfter > 0 ? Math.ceil(balanceAfter / rentAmount) : 0;
    const installmentsDeducted = Math.max(0, pendingBefore - pendingAfter);
    const installmentsCoveredByAdvance = computeCoveredInstallmentsFromAdvance(advanceBefore, advanceAfter, rentAmount);
    const installmentsImpact = installmentsDeducted + installmentsCoveredByAdvance;
    const installmentsPaidAfter = Math.max(0, client.installmentsPaid) + installmentsDeducted;
    const installmentsRemainingAfter = Math.max(0, (client.installmentsRemaining || 0) - installmentsImpact);

    const payment: Payment = {
      id: crypto.randomUUID(),
      receiptNumber: nextReceiptNumber(),
      clientId: client.id,
      clientName: client.name,
      clientUnit: client.unitId,
      clientCedula: client.cedula,
      dateApplied: item.dateApplied || toDateKey(new Date()),
      paymentMethod: inferBankPaymentMethod(item.transactionCode, item.description),
      reference: `FOLIO:${item.folio} | REF:${item.referenceId || "N/A"} | CLASIFICADO-MANUAL | ${item.description}`,
      amountReceived: item.amountReceived,
      appliedToRent,
      centavosAhorro,
      advanceApplied: advanceApplied > 0 ? advanceApplied : undefined,
      advanceBalanceAfter: advanceAfter,
      otherChargesApplied: otherChargesApplied.length > 0 ? otherChargesApplied : undefined,
      otherChargesDueAfter: computeOtherChargesDueAfter(client.otherCharges, otherChargesApplied),
      installmentsDeducted,
      installmentsFromDebt: installmentsDeducted,
      installmentsFromAdvance: installmentsCoveredByAdvance,
      installmentsTotalInPayment: installmentsImpact,
      balanceBefore,
      balanceAfter,
      savingsBefore,
      savingsAfter,
      installmentsPaidAfter,
      installmentsRemainingAfter,
      rentAmount: client.rentAmount,
      frequency: client.frequency,
      weeklyChargeDay: client.weeklyChargeDay,
      monthlyChargeDay: client.monthlyChargeDay,
      travelFundAvailableSnapshot: roundMoney(Math.max(0, client.travelFundBalance ?? 0)),
      createdAt: new Date().toISOString()
    };

    const updatedClients = clients.map((c) => {
      if (c.id !== client.id) return c;
      const otherChargesDueAfter = computeOtherChargesDueAfter(c.otherCharges, otherChargesApplied) ?? [];
      return {
        ...c,
        balance: balanceAfter,
        advanceBalance: advanceAfter,
        savings: savingsAfter,
        installmentsPaid: installmentsPaidAfter,
        installmentsRemaining: installmentsRemainingAfter,
        otherCharges: otherChargesDueAfter
      };
    });

    onClientsChange(updatedClients);
    onPaymentsChange([...payments, payment]);
    finalizeSuccessfulPayment(payment);
    const remainingNotified = removeOneMatchingNotified(notifiedPayments, client.id, item.amountReceived, item.dateApplied);
    setNotifiedPayments(remainingNotified);
    saveNotifiedPayments(remainingNotified);

    const next = pendingBankItems.filter((i) => i.folio !== item.folio);
    setPendingBankItems(next);
    savePendingBankItems(next);
    setPendingClassifyTarget(null);
    setPendingManualOverrideForcedOtherCharges(false);
  }

  function getSimilaritySignals(item: PendingBankItem): { nombre: boolean; centavos: boolean; notificado: boolean; score: number } {
    const nombre = !!item.suggestedClientId;
    const centavos = item.centsPart > 0;
    const notificado = !!item.suggestedClientId && notifiedPayments.some((n) =>
      isNotifiedCandidateMatch(n, item.suggestedClientId!, item.amountReceived, item.dateApplied)
    );
    const score = (nombre ? 1 : 0) + (centavos ? 1 : 0) + (notificado ? 1 : 0);
    return { nombre, centavos, notificado, score };
  }

  function getPendingBankPreview(item: PendingBankItem, client: Client | null): PendingBankPreview | null {
    if (!client) return null;
    const balanceBefore = roundMoney(Math.max(0, client.balance));
    const wholePart = roundMoney(Math.max(0, item.capitalPart));
    const { totalOtherCharges } = computeEffectiveOtherChargesAllocation(
      client,
      {},
      wholePart,
      otherChargesRetentionByClient,
      payments,
      item.dateApplied
    );
    const capitalForRent = roundMoney(Math.max(0, wholePart - totalOtherCharges));
    const appliedToRent = roundMoney(Math.min(capitalForRent, balanceBefore));
    const advanceBefore = roundMoney(Math.max(0, client.advanceBalance ?? 0));
    const advanceApplied = roundMoney(Math.max(0, wholePart - appliedToRent - totalOtherCharges));
    const advanceAfter = roundMoney(advanceBefore + advanceApplied);
    const balanceAfter = roundMoney(Math.max(0, balanceBefore - appliedToRent));
    const rentAmount = roundMoney(Math.max(0, client.rentAmount));
    const pendingBefore = rentAmount > 0 ? Math.ceil(balanceBefore / rentAmount) : 0;
    const pendingAfter = rentAmount > 0 && balanceAfter > 0 ? Math.ceil(balanceAfter / rentAmount) : 0;
    const installmentsDeducted = Math.max(0, pendingBefore - pendingAfter);
    const installmentsCoveredByAdvance = computeCoveredInstallmentsFromAdvance(advanceBefore, advanceAfter, rentAmount);
    const installmentsImpact = installmentsDeducted + installmentsCoveredByAdvance;
    const installmentsRemainingAfter = Math.max(0, (client.installmentsRemaining ?? 0) - installmentsImpact);
    let upToDateUntil: string | null = null;
    if (balanceAfter <= 0) {
      const referenceDate = parseDateKey(item.dateApplied) ?? operationalDate;
      const projectedClient: Client = {
        ...client,
        balance: balanceAfter,
        advanceBalance: advanceAfter
      };
      const nextChargeDate = findNextChargeDay(projectedClient, referenceDate);
      if (nextChargeDate) {
        const coveredUntilDate = new Date(nextChargeDate);
        coveredUntilDate.setDate(coveredUntilDate.getDate() - 1);
        upToDateUntil = toDateKey(coveredUntilDate);
      }
    }
    return {
      rentAmount,
      frequencyLabel: FREQUENCY_LABEL[client.frequency] ?? client.frequency,
      installmentsAgreed: Math.max(0, client.installmentsAgreed ?? 0),
      installmentsRemainingAfter,
      installmentsDeducted,
      balanceAfter,
      installmentsCoveredByAdvance,
      upToDateUntil
    };
  }

  function applyPendingItem(item: PendingBankItem, client: Client): { updatedClient: Client; payment: Payment } {
    const balanceBefore = roundMoney(client.balance);
    const savingsBefore = roundMoney(client.savings);
    const advanceBefore = roundMoney(client.advanceBalance ?? 0);
    const wholePart = roundMoney(item.capitalPart);
    const centsPart = roundMoney(item.centsPart);
    const { otherChargesApplied, totalOtherCharges } = computeEffectiveOtherChargesAllocation(
      client,
      {},
      wholePart,
      otherChargesRetentionByClient,
      payments,
      item.dateApplied
    );
    const capitalForRent = roundMoney(Math.max(0, wholePart - totalOtherCharges));
    const appliedToRent = roundMoney(Math.min(capitalForRent, Math.max(0, balanceBefore)));
    const advanceApplied = roundMoney(Math.max(0, wholePart - appliedToRent - totalOtherCharges));
    const centavosAhorro = centsPart;
    const balanceAfter = roundMoney(Math.max(0, balanceBefore - appliedToRent));
    const savingsAfter = roundMoney(savingsBefore + centavosAhorro);
    const advanceAfter = roundMoney(advanceBefore + advanceApplied);
    const rentAmount = client.rentAmount;
    const pendingBefore = rentAmount > 0 ? Math.ceil(balanceBefore / rentAmount) : 0;
    const pendingAfterN = rentAmount > 0 && balanceAfter > 0 ? Math.ceil(balanceAfter / rentAmount) : 0;
    const installmentsDeducted = Math.max(0, pendingBefore - pendingAfterN);
    const installmentsCoveredByAdvance = computeCoveredInstallmentsFromAdvance(advanceBefore, advanceAfter, rentAmount);
    const installmentsImpact = installmentsDeducted + installmentsCoveredByAdvance;
    const installmentsPaidAfter = Math.max(0, client.installmentsPaid) + installmentsDeducted;
    const installmentsRemainingAfter = Math.max(0, (client.installmentsRemaining || 0) - installmentsImpact);

    const payment: Payment = {
      id: crypto.randomUUID(),
      receiptNumber: nextReceiptNumber(),
      clientId: client.id,
      clientName: client.name,
      clientUnit: client.unitId,
      clientCedula: client.cedula,
      dateApplied: item.dateApplied || toDateKey(new Date()),
      paymentMethod: inferBankPaymentMethod(item.transactionCode, item.description),
      reference: `FOLIO:${item.folio} | REF:${item.referenceId || "N/A"} | AUTO-ALTA-SIMILITUD | ${item.description}`,
      amountReceived: item.amountReceived,
      appliedToRent,
      centavosAhorro,
      advanceApplied: advanceApplied > 0 ? advanceApplied : undefined,
      advanceBalanceAfter: advanceAfter,
      otherChargesApplied: otherChargesApplied.length > 0 ? otherChargesApplied : undefined,
      otherChargesDueAfter: computeOtherChargesDueAfter(client.otherCharges, otherChargesApplied),
      installmentsDeducted,
      installmentsFromDebt: installmentsDeducted,
      installmentsFromAdvance: installmentsCoveredByAdvance,
      installmentsTotalInPayment: installmentsImpact,
      balanceBefore,
      balanceAfter,
      savingsBefore,
      savingsAfter,
      installmentsPaidAfter,
      installmentsRemainingAfter,
      rentAmount: client.rentAmount,
      frequency: client.frequency,
      weeklyChargeDay: client.weeklyChargeDay,
        monthlyChargeDay: client.monthlyChargeDay,
        travelFundAvailableSnapshot: roundMoney(Math.max(0, client.travelFundBalance ?? 0)),
        createdAt: new Date().toISOString()
    };

    const updatedClient = {
      ...client,
      balance: balanceAfter,
      advanceBalance: advanceAfter,
      savings: savingsAfter,
      installmentsPaid: installmentsPaidAfter,
      installmentsRemaining: installmentsRemainingAfter,
      otherCharges: computeOtherChargesDueAfter(client.otherCharges, otherChargesApplied) ?? []
    };
    return { updatedClient, payment };
  }

  function handleQuickApply(item: PendingBankItem): void {
    if (!item.suggestedClientId) return;
    const client = clients.find((c) => c.id === item.suggestedClientId);
    if (!client) return;
    const normalizedFolio = normalizeFolioToken(item.folio);
    const takenFolios = buildTakenFolioSet(
      payments,
      pendingBankItems,
      pendingCardItems,
      { excludePendingBankFolios: new Set([normalizedFolio]) }
    );
    if (takenFolios.has(normalizedFolio)) {
      setErrors([`No se puede registrar el folio ${normalizedFolio}: ya fue utilizado.`]);
      return;
    }
    // If has otros cargos, open classify modal instead
    if (client.otherCharges && client.otherCharges.length > 0) {
      handleOpenClassify(item);
      return;
    }
    const { updatedClient, payment } = applyPendingItem(item, client);
    const updatedClients = clients.map((c) => (c.id === updatedClient.id ? updatedClient : c));
    onClientsChange(updatedClients);
    onPaymentsChange([...payments, payment]);
    finalizeSuccessfulPayment(payment);
    const remainingNotified = removeOneMatchingNotified(notifiedPayments, client.id, item.amountReceived, item.dateApplied);
    setNotifiedPayments(remainingNotified);
    saveNotifiedPayments(remainingNotified);
    const next = pendingBankItems.filter((i) => i.folio !== item.folio);
    setPendingBankItems(next);
    savePendingBankItems(next);
  }

  function handleApplyAllHighSimilarity(): void {
    const highSim = pendingBankItems.filter((item) => {
      const { score } = getSimilaritySignals(item);
      if (score < 2) return false;
      const client = clients.find((c) => c.id === item.suggestedClientId);
      // Skip items with otros cargos - need manual review
      if (!client || (client.otherCharges && client.otherCharges.length > 0)) return false;
      return true;
    });
    if (highSim.length === 0) return;

    let updatedClientsMap = new Map(clients.map((c) => [c.id, { ...c }]));
    const newPayments: Payment[] = [];
    const highSimFolios = new Set(highSim.map((item) => normalizeFolioToken(item.folio)).filter((folio) => folio.length > 0));
    const usedFolios = buildTakenFolioSet(
      payments,
      pendingBankItems,
      pendingCardItems,
      { excludePendingBankFolios: highSimFolios }
    );
    let skippedDuplicates = 0;

    for (const item of highSim) {
      const normalizedFolio = normalizeFolioToken(item.folio);
      if (usedFolios.has(normalizedFolio)) {
        skippedDuplicates += 1;
        continue;
      }
      const client = updatedClientsMap.get(item.suggestedClientId!)!;
      const { updatedClient, payment } = applyPendingItem(item, client);
      updatedClientsMap.set(updatedClient.id, updatedClient);
      newPayments.push(payment);
      usedFolios.add(normalizedFolio);
    }

    if (newPayments.length === 0) {
      if (skippedDuplicates > 0) {
        setErrors([`No se aplicaron pagos en lote: ${skippedDuplicates} folio(s) ya existian.`]);
      }
      return;
    }

    if (skippedDuplicates > 0) {
      setErrors([`Se omitieron ${skippedDuplicates} pago(s) en lote porque su folio ya existia.`]);
    }

    const appliedFolios = new Set(newPayments.flatMap((p) => extractFoliosFromReference(p.reference ?? "")));
    const remainingPending = pendingBankItems.filter((i) => !appliedFolios.has(normalizeFolioToken(i.folio)));

    onClientsChange([...updatedClientsMap.values()]);
    onPaymentsChange([...payments, ...newPayments]);
    for (const payment of newPayments) {
      finalizeSuccessfulPayment(payment);
    }
    let remainingNotified = [...notifiedPayments];
    for (const item of highSim) {
      const normalizedFolio = normalizeFolioToken(item.folio);
      if (!appliedFolios.has(normalizedFolio)) continue;
      if (!item.suggestedClientId) continue;
      remainingNotified = removeOneMatchingNotified(remainingNotified, item.suggestedClientId, item.amountReceived, item.dateApplied);
    }
    setNotifiedPayments(remainingNotified);
    saveNotifiedPayments(remainingNotified);
    setPendingBankItems(remainingPending);
    savePendingBankItems(remainingPending);
  }

  function handleSelectClient(client: Client): void {
    setForm((f) => ({ ...f, clientId: client.id }));
    setClientSearch("");
    setDropdownOpen(false);
    setManualOtherChargesInput({});
    setManualOverrideForcedOtherCharges(false);
    setAutoAmountInfo("");
    setPaymentInfo("");
    setRegisterTravelFundInput(toInputMoney(roundMoney(Math.max(0, client.travelFundBalance ?? 0))));
  }

  function buildTakenFolioSet(
    paymentRows: Payment[],
    pendingBankRows: PendingBankItem[],
    pendingCardRows: PendingCardItem[],
    options?: {
      excludePendingBankFolios?: Set<string>;
      excludePendingCardIds?: Set<string>;
    }
  ): Set<string> {
    const set = new Set<string>();
    const excludePendingBankFolios = options?.excludePendingBankFolios ?? new Set<string>();
    const excludePendingCardIds = options?.excludePendingCardIds ?? new Set<string>();
    for (const payment of paymentRows) {
      for (const folio of extractFoliosFromReference(payment.reference ?? "")) {
        if (folio) set.add(folio);
      }
    }
    for (const item of pendingBankRows) {
      const folio = normalizeFolioToken(item.folio);
      if (excludePendingBankFolios.has(folio)) continue;
      if (folio) set.add(folio);
    }
    for (const item of pendingCardRows) {
      if (excludePendingCardIds.has(item.id)) continue;
      const folio = normalizeFolioToken(item.folio);
      if (folio) set.add(folio);
    }
    return set;
  }

  function handleClearClient(): void {
    setForm((f) => ({ ...f, clientId: "" }));
    setClientSearch("");
    setDropdownOpen(false);
    setManualOverrideForcedOtherCharges(false);
    setAutoAmountInfo("");
    setPaymentInfo("");
    setRegisterTravelFundInput("");
  }

  function handleSaveSelectedClientTravelFund(): void {
    if (!selectedClient) return;
    const amount = parseFloat(registerTravelFundInput);
    if (!Number.isFinite(amount) || amount < 0) {
      setErrors(["El fondo de viaje debe ser un numero valido mayor o igual a 0."]);
      return;
    }
    const nextFund = roundMoney(Math.max(0, amount));
    const updatedClients = clients.map((client) =>
      client.id === selectedClient.id ? { ...client, travelFundBalance: nextFund } : client
    );
    onClientsChange(updatedClients);
    setRegisterTravelFundInput(toInputMoney(nextFund));
    setPaymentInfo(`Fondo de viaje actualizado para ${selectedClient.unitId}: ${formatCurrency(nextFund)}.`);
    setErrors([]);
  }

  function handleSavePendingClientTravelFund(client: Client, folio: string): void {
    const rawValue = pendingTravelFundInputByFolio[folio] ?? "";
    const amount = parseFloat(rawValue);
    if (!Number.isFinite(amount) || amount < 0) {
      setPendingImportError("El fondo de viaje debe ser un numero valido mayor o igual a 0.");
      return;
    }
    const nextFund = roundMoney(Math.max(0, amount));
    const updatedClients = clients.map((row) =>
      row.id === client.id ? { ...row, travelFundBalance: nextFund } : row
    );
    onClientsChange(updatedClients);
    setPendingImportError(`Fondo de viaje actualizado para ${client.unitId}: ${formatCurrency(nextFund)}.`);
  }

  function handleAutoFillToMonthEnd(): void {
    if (!selectedClient || !monthEndSuggestion) return;
    const amount = monthEndSuggestion.requiredWholeAmount;
    setForm((f) => ({ ...f, amountReceived: toInputMoney(amount) }));
    const resultingLabel = monthEndSuggestion.resultingNextDate ? formatDate(monthEndSuggestion.resultingNextDate) : "sin fecha";
    if (amount <= 0) {
      setAutoAmountInfo(`Ya esta cubierto hasta ${resultingLabel}.`);
      return;
    }
    setAutoAmountInfo(`Monto cargado: ${formatCurrency(amount)}. Quedara al dia hasta ${resultingLabel}.`);
  }

  function validate(): string[] {
    const errs: string[] = [];
    const takenFolios = buildTakenFolioSet(payments, pendingBankItems, pendingCardItems);
    if (!form.clientId) errs.push("Debes seleccionar un cliente.");
    const amount = parseFloat(form.amountReceived);
    if (!Number.isFinite(amount) || amount <= 0) errs.push("El monto recibido debe ser mayor a 0.");
    if (form.paymentMethod === "Tarjeta") {
      const enteredFolios = extractFoliosFromReference(form.reference);
      if (enteredFolios.length > 0) {
        const duplicate = enteredFolios.find((folio) => takenFolios.has(folio));
        if (duplicate) errs.push(`El folio ${duplicate} ya fue utilizado.`);
      }
    }
    if (isBankPayment) {
      const enteredFolios = extractFoliosFromReference(form.reference);
      if (enteredFolios.length === 0) {
        errs.push("Debes indicar el folio/referencia para pagos bancarios.");
      } else {
        const duplicate = enteredFolios.find((folio) => takenFolios.has(folio));
        if (duplicate) errs.push(`El folio ${duplicate} ya fue utilizado.`);
      }
    }
    if (isDateClosed(operationalDateKey)) errs.push(`La caja de ${operationalDateKey} ya esta cerrada.`);
    return errs;
  }

  function handleCloseCashForDate(): void {
    const date = cashClosingDate.trim();
    const actor = cashClosingActor.trim() || "Operador";
    const reason = cashClosingReason.trim();
    if (!date) {
      setCashClosingError("Debes seleccionar una fecha para cerrar caja.");
      setCashClosingInfo("");
      return;
    }
    if (!reason) {
      setCashClosingError("Debes indicar un motivo para cerrar caja.");
      setCashClosingInfo("");
      return;
    }
    if (isDateClosed(date)) {
      setCashClosingError(`La caja de ${date} ya estaba cerrada.`);
      setCashClosingInfo("");
      return;
    }

    const chargeResult = applyNextDayChargesFromClosing(date);
    const closeReport: ChargeCloseReport = {
      closingDate: date,
      targetDate: chargeResult.targetDate,
      status: chargeResult.blockingError ? "warning" : "ok",
      expectedClients: chargeResult.expectedClients,
      chargedClients: chargeResult.chargedClients,
      anomalyClients: chargeResult.anomalyClients,
      chargedTotal: chargeResult.chargedTotal,
      generatedAt: new Date().toISOString(),
      rows: chargeResult.rows
    };
    setLastCloseReport(closeReport);

    if (chargeResult.blockingError) {
      setCashClosingError(chargeResult.blockingError);
      setCashClosingInfo("");
      return;
    }

    const closing: CashClosing = { date, closedAt: new Date().toISOString() };
    const nextClosings = [...cashClosings, closing].sort((a, b) => b.date.localeCompare(a.date));
    setCashClosings(nextClosings);
    saveCashClosings(nextClosings);

    const paymentsOfDay = payments.filter((p) => p.dateApplied === date);
    const dayTotal = roundMoney(paymentsOfDay.reduce((acc, p) => acc + p.amountReceived, 0));
    const event: CashClosingAuditEvent = {
      id: crypto.randomUUID(),
      date,
      action: "close",
      actor,
      reason,
      createdAt: new Date().toISOString()
    };
    const nextAudit = [event, ...cashClosingAudit].slice(0, 300);
    setCashClosingAudit(nextAudit);
    saveCashClosingAudit(nextAudit);

    // Snapshot final de gestion de cobros para consulta historica y bloqueo del dia cerrado.
    const closureDateRef = parseDateKey(date) ?? startOfDay(new Date());
    const receivableRows = buildReceivableRows(clients, payments, closureDateRef);
    const statusesByClient = parseCollectionStatusesFromStorage();
    const closureTotals: Record<CollectionStatus, number> = {
      no_answer: 0,
      reminder: 0,
      call_later: 0,
      paid: 0
    };
    const closureItems: CollectionClosureItem[] = receivableRows.map((row) => {
      const resolved = resolveCollectionStatusForClosure(row, statusesByClient, date);
      closureTotals[resolved.status] += 1;
      return {
        clientId: row.id,
        unitId: row.unitId,
        clientName: row.name,
        lastPaymentDate: row.lastPaymentDate,
        receivableState: row.state,
        totalPending: row.totalPending,
        collectionStatus: resolved.status,
        comment: resolved.comment,
        autoApplied: resolved.autoApplied
      };
    });
    const collectionClosureSnapshot: CollectionClosureSnapshot = {
      date,
      closedAt: new Date().toISOString(),
      actor,
      reason,
      totals: closureTotals,
      items: closureItems
    };
    const existingClosures = loadCollectionClosuresFromStorage();
    localStorage.setItem(
      COLLECTION_CLOSURES_KEY,
      JSON.stringify({
        ...existingClosures,
        [date]: collectionClosureSnapshot
      })
    );

    const chargeInfo = chargeResult.alreadyProcessed
      ? `Cobros de ${chargeResult.targetDate} ya estaban aplicados previamente.`
      : `Cobros aplicados para ${chargeResult.targetDate}: esperados ${chargeResult.expectedClients}, cobrados ${chargeResult.chargedClients}, total ${formatCurrency(chargeResult.chargedTotal)}.`;
    const lateFeeInfo = chargeResult.lateFeeClients > 0
      ? ` Recargos por tardanza: ${chargeResult.lateFeeClients} cliente(s), total ${formatCurrency(chargeResult.lateFeeTotal)}.`
      : "";
    setCashClosingError("");
    setCashClosingReason("");
    setCashClosingInfo(
      `Caja cerrada para ${date}. Pagos del dia: ${paymentsOfDay.length}. Total del dia: ${formatCurrency(dayTotal)}. ${chargeInfo}${lateFeeInfo}`
    );
    onCashClose?.();
  }

  function openReopenDialog(date: string): void {
    setReopenTargetDate(date);
    setReopenReason("");
    setCashClosingError("");
  }

  function handleConfirmReopen(): void {
    if (!reopenTargetDate) return;
    const reason = reopenReason.trim();
    const actor = cashClosingActor.trim() || "Operador";
    if (!reason) {
      setCashClosingError("Debes indicar un motivo para reabrir caja.");
      return;
    }
    if (!isDateClosed(reopenTargetDate)) {
      setCashClosingError(`La caja de ${reopenTargetDate} ya no esta cerrada.`);
      setReopenTargetDate(null);
      return;
    }

    const nextClosings = cashClosings.filter((c) => c.date !== reopenTargetDate);
    setCashClosings(nextClosings);
    saveCashClosings(nextClosings);

    const feesFromDate = lateFeeLedger.filter((entry) => entry.date === reopenTargetDate);
    if (feesFromDate.length > 0) {
      const entriesByClient = new Map<string, LateFeeLedgerEntry[]>();
      for (const entry of feesFromDate) {
        const rows = entriesByClient.get(entry.clientId) ?? [];
        rows.push(entry);
        entriesByClient.set(entry.clientId, rows);
      }
      const revertedClients = clients.map((client) => {
        const entries = entriesByClient.get(client.id);
        if (!entries || entries.length === 0) return client;
        let otherCharges = [...(client.otherCharges ?? [])];
        for (const entry of entries) {
          otherCharges = subtractOtherCharge(otherCharges, entry.chargeLabel, entry.amount);
        }
        return { ...client, otherCharges };
      });
      onClientsChange(revertedClients);
      const nextLedger = lateFeeLedger.filter((entry) => entry.date !== reopenTargetDate);
      setLateFeeLedger(nextLedger);
      saveLateFeeLedger(nextLedger);
    }

    const event: CashClosingAuditEvent = {
      id: crypto.randomUUID(),
      date: reopenTargetDate,
      action: "reopen",
      actor,
      reason,
      createdAt: new Date().toISOString()
    };
    const nextAudit = [event, ...cashClosingAudit].slice(0, 300);
    setCashClosingAudit(nextAudit);
    saveCashClosingAudit(nextAudit);

    const rollbackCount = lateFeeLedger.filter((entry) => entry.date === reopenTargetDate).length;
    setCashClosingInfo(
      rollbackCount > 0
        ? `Caja reabierta para ${reopenTargetDate}. Se reversaron ${rollbackCount} recargo(s) de mora de esa fecha.`
        : `Caja reabierta para ${reopenTargetDate}.`
    );
    setCashClosingError("");
    setReopenTargetDate(null);
    setReopenReason("");
  }

  function handleConfirmPayment(): void {
    const errs = validate();
    if (errs.length > 0) { setErrors(errs); return; }
    if (!selectedClient || !preview) return;
    const amountReceived = roundMoney(parseFloat(form.amountReceived));
    if (form.paymentMethod === "Tarjeta") {
      const allocation = computeManualPaymentAllocation(
        selectedClient,
        amountReceived,
        manualOtherChargesInput,
        otherChargesRetentionByClient,
        payments,
        operationalDateKey,
        manualOverrideForcedOtherCharges
      );

      const enteredFolios = extractFoliosFromReference(form.reference);
      const normalizedFolio = enteredFolios[0] ?? buildTemporaryCardFolio(operationalDateKey);
      const receiptNumber = nextReceiptNumber();
      const cardPayment: Payment = {
        id: crypto.randomUUID(),
        receiptNumber,
        clientId: selectedClient.id,
        clientName: selectedClient.name,
        clientUnit: selectedClient.unitId,
        clientCedula: selectedClient.cedula,
        dateApplied: operationalDateKey,
        paymentMethod: "Tarjeta",
        reference: `FOLIO:${normalizedFolio} | TARJETA-PENDIENTE-CONCILIACION | ${form.reference.trim() || "PENDIENTE-FOLIO"}`,
        amountReceived,
        appliedToRent: allocation.appliedToRent,
        centavosAhorro: allocation.centavosAhorro,
        advanceApplied: allocation.advanceApplied > 0 ? allocation.advanceApplied : undefined,
        advanceBalanceAfter: roundMoney((selectedClient.advanceBalance ?? 0) + allocation.advanceApplied),
        otherChargesApplied: allocation.otherChargesApplied.length > 0 ? allocation.otherChargesApplied : undefined,
        otherChargesDueAfter: computeOtherChargesDueAfter(selectedClient.otherCharges, allocation.otherChargesApplied),
        installmentsDeducted: allocation.installmentsDeducted,
        installmentsFromDebt: allocation.installmentsDeducted,
        installmentsFromAdvance: allocation.installmentsCoveredByAdvance,
        installmentsTotalInPayment: allocation.installmentsTotalInPayment,
        balanceBefore: allocation.balanceBefore,
        balanceAfter: allocation.balanceAfter,
        savingsBefore: selectedClient.savings,
        savingsAfter: roundMoney(selectedClient.savings + allocation.centavosAhorro),
        installmentsPaidAfter: selectedClient.installmentsPaid + allocation.installmentsTotalInPayment,
        installmentsRemainingAfter: Math.max(0, selectedClient.installmentsRemaining - allocation.installmentsTotalInPayment),
        rentAmount: selectedClient.rentAmount,
        frequency: selectedClient.frequency,
        weeklyChargeDay: selectedClient.weeklyChargeDay,
        monthlyChargeDay: selectedClient.monthlyChargeDay,
        travelFundAvailableSnapshot: roundMoney(Math.max(0, selectedClient.travelFundBalance ?? 0)),
        createdAt: new Date().toISOString()
      };

      const updatedClients = clients.map((c) => {
        if (c.id !== selectedClient.id) return c;
        const otherChargesDueAfter = computeOtherChargesDueAfter(c.otherCharges, allocation.otherChargesApplied) ?? [];
        return {
          ...c,
          balance: allocation.balanceAfter,
          advanceBalance: roundMoney((c.advanceBalance ?? 0) + allocation.advanceApplied),
          savings: roundMoney(c.savings + allocation.centavosAhorro),
          installmentsRemaining: Math.max(0, c.installmentsRemaining - allocation.installmentsTotalInPayment),
          installmentsPaid: c.installmentsPaid + allocation.installmentsTotalInPayment,
          otherCharges: otherChargesDueAfter
        };
      });

      const pendingCard: PendingCardItem = {
        id: crypto.randomUUID(),
        appliedPaymentId: cardPayment.id,
        folio: normalizedFolio,
        clientId: selectedClient.id,
        clientName: selectedClient.name,
        clientUnit: selectedClient.unitId,
        clientCedula: selectedClient.cedula,
        amountExpected: amountReceived,
        dateRegistered: operationalDateKey,
        expectedSettlementDate: getNextDateKey(operationalDateKey),
        reference: form.reference.trim() || undefined,
        createdAt: new Date().toISOString()
      };
      const nextPendingCardItems = [...pendingCardItems, pendingCard];

      onClientsChange(updatedClients);
      onPaymentsChange([...payments, cardPayment]);
      setPendingCardItems(nextPendingCardItems);
      savePendingCardItems(nextPendingCardItems);
      setErrors([]);
      setPaymentInfo(
        enteredFolios.length > 0
          ? `Pago en tarjeta aplicado. Pendiente de conciliacion bancaria con folio ${normalizedFolio} para ${pendingCard.expectedSettlementDate}.`
          : `Pago en tarjeta aplicado con folio temporal ${normalizedFolio}. Debes corregirlo manana para conciliar con el CSV.`
      );
      finalizeSuccessfulPayment(cardPayment, { openReceipt: true });
      setForm({
        clientId: "",
        dateApplied: operationalDateKey,
        paymentMethod: "Efectivo",
        reference: "",
        amountReceived: ""
      });
      setManualOtherChargesInput({});
      setManualOverrideForcedOtherCharges(false);
      return;
    }
    const allocation = computeManualPaymentAllocation(
      selectedClient,
      amountReceived,
      manualOtherChargesInput,
      otherChargesRetentionByClient,
      payments,
      operationalDateKey,
      manualOverrideForcedOtherCharges
    );

    setErrors([]);
    setPaymentInfo("");
    const receiptNumber = nextReceiptNumber();

    const payment: Payment = {
      id: crypto.randomUUID(),
      receiptNumber,
      clientId: selectedClient.id,
      clientName: selectedClient.name,
      clientUnit: selectedClient.unitId,
      clientCedula: selectedClient.cedula,
      dateApplied: operationalDateKey,
      paymentMethod: form.paymentMethod,
      reference: form.reference.trim() || undefined,
      amountReceived,
      appliedToRent: allocation.appliedToRent,
      centavosAhorro: allocation.centavosAhorro,
      advanceApplied: allocation.advanceApplied > 0 ? allocation.advanceApplied : undefined,
      advanceBalanceAfter: roundMoney((selectedClient.advanceBalance ?? 0) + allocation.advanceApplied),
      otherChargesApplied: allocation.otherChargesApplied.length > 0 ? allocation.otherChargesApplied : undefined,
      otherChargesDueAfter: computeOtherChargesDueAfter(selectedClient.otherCharges, allocation.otherChargesApplied),
      installmentsDeducted: allocation.installmentsDeducted,
      installmentsFromDebt: allocation.installmentsDeducted,
      installmentsFromAdvance: allocation.installmentsCoveredByAdvance,
      installmentsTotalInPayment: allocation.installmentsTotalInPayment,
      balanceBefore: allocation.balanceBefore,
      balanceAfter: allocation.balanceAfter,
      savingsBefore: selectedClient.savings,
      savingsAfter: roundMoney(selectedClient.savings + allocation.centavosAhorro),
      installmentsPaidAfter: selectedClient.installmentsPaid + allocation.installmentsTotalInPayment,
      installmentsRemainingAfter: Math.max(0, selectedClient.installmentsRemaining - allocation.installmentsTotalInPayment),
      rentAmount: selectedClient.rentAmount,
      frequency: selectedClient.frequency,
      weeklyChargeDay: selectedClient.weeklyChargeDay,
      monthlyChargeDay: selectedClient.monthlyChargeDay,
      travelFundAvailableSnapshot: roundMoney(Math.max(0, selectedClient.travelFundBalance ?? 0)),
      createdAt: new Date().toISOString()
    };

    const updatedClients = clients.map((c) => {
      if (c.id !== selectedClient.id) return c;
      const otherChargesDueAfter = computeOtherChargesDueAfter(c.otherCharges, allocation.otherChargesApplied) ?? [];
      return {
        ...c,
        balance: allocation.balanceAfter,
        advanceBalance: roundMoney((c.advanceBalance ?? 0) + allocation.advanceApplied),
        savings: roundMoney(c.savings + allocation.centavosAhorro),
        installmentsRemaining: Math.max(0, c.installmentsRemaining - allocation.installmentsTotalInPayment),
        installmentsPaid: c.installmentsPaid + allocation.installmentsTotalInPayment,
        otherCharges: otherChargesDueAfter
      };
    });

    onClientsChange(updatedClients);
    onPaymentsChange([...payments, payment]);
    finalizeSuccessfulPayment(payment, { openReceipt: true });
    setForm({
      clientId: "",
      dateApplied: operationalDateKey,
      paymentMethod: "Efectivo",
      reference: "",
      amountReceived: ""
    });
    setManualOtherChargesInput({});
    setManualOverrideForcedOtherCharges(false);
  }

  function handleDeletePayment(payment: Payment): void {
    if (isDateClosed(payment.dateApplied)) {
      setErrors([`No se puede eliminar el recibo ${payment.receiptNumber}: la caja de ${payment.dateApplied} esta cerrada.`]);
      setDeleteTarget(null);
      return;
    }
    const updatedClients = clients.map((c) => {
      if (c.id !== payment.clientId) return c;
      return {
        ...c,
        balance: roundMoney(c.balance + payment.appliedToRent),
        advanceBalance: roundMoney(Math.max(0, (c.advanceBalance ?? 0) - (payment.advanceApplied ?? 0))),
        savings: roundMoney(Math.max(0, c.savings - payment.centavosAhorro)),
        installmentsRemaining: c.installmentsRemaining + getInstallmentsTotalInPayment(payment),
        installmentsPaid: Math.max(0, c.installmentsPaid - getInstallmentsTotalInPayment(payment)),
        otherCharges: restoreOtherChargesAfterDelete(c.otherCharges, payment.otherChargesApplied)
      };
    });
    onClientsChange(updatedClients);
    onPaymentsChange(payments.filter((p) => p.id !== payment.id));
    setDeleteTarget(null);
  }

  function validateNotified(): string[] {
    const errs: string[] = [];
    const unit = notifiedForm.unitId.trim();
    if (!unit) errs.push("Debes indicar la unidad del pago notificado.");
    if (unit && !notifiedClientMatch) errs.push(`No existe un cliente activo con la unidad "${unit}".`);
    const amount = parseFloat(notifiedForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) errs.push("El monto notificado debe ser mayor a 0.");
    return errs;
  }

  function validateEditingNotified(): string[] {
    const errs: string[] = [];
    const unit = editingNotifiedForm.unitId.trim();
    if (!unit) errs.push("Debes indicar la unidad del pago notificado.");
    if (unit && !editingNotifiedClientMatch) errs.push(`No existe un cliente activo con la unidad "${unit}".`);
    const amount = parseFloat(editingNotifiedForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) errs.push("El monto notificado debe ser mayor a 0.");
    return errs;
  }

  function handleAddNotifiedPayment(): void {
    const errs = validateNotified();
    if (errs.length > 0) {
      setNotifiedErrors(errs);
      return;
    }
    setNotifiedErrors([]);
    if (!notifiedClientMatch) return;
    const next: NotifiedPayment = {
      id: crypto.randomUUID(),
      clientId: notifiedClientMatch.id,
      amount: roundMoney(parseFloat(notifiedForm.amount)),
      createdAt: new Date().toISOString()
    };
    const rows = [...notifiedPayments, next];
    setNotifiedPayments(rows);
    saveNotifiedPayments(rows);
    setNotifiedForm({
      unitId: "",
      amount: ""
    });
  }

  function handleDeleteNotifiedPayment(id: string): void {
    const rows = notifiedPayments.filter((r) => r.id !== id);
    setNotifiedPayments(rows);
    saveNotifiedPayments(rows);
  }

  function handleStartEditNotified(row: NotifiedPayment): void {
    const client = clients.find((c) => c.id === row.clientId);
    setEditingNotifiedId(row.id);
    setEditingNotifiedForm({
      unitId: client?.unitId ?? "",
      amount: String(row.amount)
    });
    setNotifiedErrors([]);
  }

  function handleCancelEditNotified(): void {
    setEditingNotifiedId(null);
    setEditingNotifiedForm({ unitId: "", amount: "" });
  }

  function handleSaveEditNotified(row: NotifiedPayment): void {
    const errs = validateEditingNotified();
    if (errs.length > 0) {
      setNotifiedErrors(errs);
      return;
    }
    if (!editingNotifiedClientMatch) return;
    const updatedRows = notifiedPayments.map((r) =>
      r.id === row.id
        ? { ...r, clientId: editingNotifiedClientMatch.id, amount: roundMoney(parseFloat(editingNotifiedForm.amount)) }
        : r
    );
    setNotifiedPayments(updatedRows);
    saveNotifiedPayments(updatedRows);
    handleCancelEditNotified();
  }

  function handleSortNotified(field: NotifiedSortField): void {
    if (notifiedSortField === field) {
      setNotifiedSortDirection((prev) => (prev === "desc" ? "asc" : "desc"));
      return;
    }
    setNotifiedSortField(field);
    setNotifiedSortDirection("desc");
  }

  function handleSortHistory(field: HistorySortField): void {
    if (historySortField === field) {
      setHistorySortDirection((prev) => (prev === "desc" ? "asc" : "desc"));
      return;
    }
    setHistorySortField(field);
    setHistorySortDirection("desc");
  }

  function renderHistorySortIcon(field: HistorySortField): string {
    if (historySortField !== field) return "";
    return historySortDirection === "desc" ? "v" : "^";
  }

  function updateHistoryColumnFilter(field: keyof HistoryColumnFilters, value: string): void {
    setHistoryColumnFilters((prev) => ({ ...prev, [field]: value }));
  }

  function clearHistoryColumnFilters(): void {
    setHistoryColumnFilters({ ...EMPTY_HISTORY_COLUMN_FILTERS });
  }

  const historyAvailableGroups = useMemo(() => {
    return [...new Set(
      payments
        .map((p) => extractGroupCodeFromUnit(p.clientUnit))
        .filter((group) => group.length > 0)
    )].sort((a, b) => a.localeCompare(b));
  }, [payments]);

  const historyDateRangeError = useMemo(() => {
    if (historyDateFrom && historyDateTo && historyDateFrom > historyDateTo) {
      return "La fecha desde no puede ser mayor que la fecha hasta.";
    }
    return "";
  }, [historyDateFrom, historyDateTo]);

  const hasHistoryColumnFilters = useMemo(
    () => Object.values(historyColumnFilters).some((value) => value.trim().length > 0),
    [historyColumnFilters]
  );

  const historyRows = useMemo(() => {
    if (historyDateRangeError) return [];

    const byClient = historyClientId === "all"
      ? payments
      : payments.filter((p) => p.clientId === historyClientId);
    const byGroup = historyGroupFilter === "all"
      ? byClient
      : byClient.filter((p) => extractGroupCodeFromUnit(p.clientUnit) === historyGroupFilter);
    const filteredByDate = byGroup.filter((p) => {
      if (historyDateFrom && p.dateApplied < historyDateFrom) return false;
      if (historyDateTo && p.dateApplied > historyDateTo) return false;
      return true;
    });
    const normalize = (value: string): string => value.trim().toLowerCase();
    const includesFilter = (target: string, filterValue: string): boolean => {
      const query = normalize(filterValue);
      if (!query) return true;
      return normalize(target).includes(query);
    };
    const filtered = filteredByDate.filter((p) => {
      const installments = getInstallmentsTotalInPayment(p);
      const amountLabel = `${p.amountReceived.toFixed(2)} ${formatCurrency(p.amountReceived)}`;
      const appliedLabel = `${p.appliedToRent.toFixed(2)} ${formatCurrency(p.appliedToRent)}`;
      const savingsLabel = `${p.centavosAhorro.toFixed(2)} ${formatCurrency(p.centavosAhorro)}`;
      const installmentsLabel = installments > 0 ? `-${installments}` : "-";
      return (
        includesFilter(p.receiptNumber, historyColumnFilters.receipt) &&
        includesFilter(p.dateApplied, historyColumnFilters.date) &&
        includesFilter(p.clientUnit, historyColumnFilters.unit) &&
        includesFilter(p.clientName, historyColumnFilters.client) &&
        includesFilter(amountLabel, historyColumnFilters.amount) &&
        includesFilter(appliedLabel, historyColumnFilters.applied) &&
        includesFilter(savingsLabel, historyColumnFilters.savings) &&
        includesFilter(installmentsLabel, historyColumnFilters.installments) &&
        includesFilter(p.paymentMethod, historyColumnFilters.method)
      );
    });
    const dir = historySortDirection === "asc" ? 1 : -1;
    const sorted = [...filtered].sort((a, b) => {
      let comparison = 0;
      if (historySortField === "receipt") comparison = a.receiptNumber.localeCompare(b.receiptNumber);
      if (historySortField === "date") comparison = a.dateApplied.localeCompare(b.dateApplied);
      if (historySortField === "unit") comparison = a.clientUnit.localeCompare(b.clientUnit);
      if (historySortField === "client") comparison = a.clientName.localeCompare(b.clientName);
      if (historySortField === "amount") comparison = a.amountReceived - b.amountReceived;
      if (historySortField === "applied") comparison = a.appliedToRent - b.appliedToRent;
      if (historySortField === "savings") comparison = a.centavosAhorro - b.centavosAhorro;
      if (historySortField === "installments") comparison = getInstallmentsTotalInPayment(a) - getInstallmentsTotalInPayment(b);
      if (historySortField === "method") comparison = a.paymentMethod.localeCompare(b.paymentMethod);
      if (comparison !== 0) return comparison * dir;
      return b.createdAt.localeCompare(a.createdAt);
    });
    return sorted;
  }, [payments, historyClientId, historyGroupFilter, historyDateFrom, historyDateTo, historySortDirection, historySortField, historyDateRangeError, historyColumnFilters]);

  useEffect(() => {
    if (!isHistoryOpen) return;
    const top = historyTopScrollRef.current;
    const bottom = historyBottomScrollRef.current;
    if (!top || !bottom) return;

    let syncing = false;
    const onTopScroll = () => {
      if (syncing) return;
      syncing = true;
      bottom.scrollLeft = top.scrollLeft;
      syncing = false;
    };
    const onBottomScroll = () => {
      if (syncing) return;
      syncing = true;
      top.scrollLeft = bottom.scrollLeft;
      syncing = false;
    };

    top.addEventListener("scroll", onTopScroll, { passive: true });
    bottom.addEventListener("scroll", onBottomScroll, { passive: true });
    return () => {
      top.removeEventListener("scroll", onTopScroll);
      bottom.removeEventListener("scroll", onBottomScroll);
    };
  }, [isHistoryOpen, historyRows.length]);

  useEffect(() => {
    if (!isHistoryOpen) return;
    const top = historyTopScrollRef.current;
    const topInner = historyTopInnerRef.current;
    const bottom = historyBottomScrollRef.current;
    if (!top || !topInner || !bottom) return;

    const updateTopWidth = () => {
      const table = bottom.querySelector("table");
      const width = table ? table.scrollWidth : bottom.scrollWidth;
      topInner.style.width = `${Math.max(width, bottom.clientWidth)}px`;
      top.scrollLeft = bottom.scrollLeft;
    };

    updateTopWidth();
    window.addEventListener("resize", updateTopWidth);
    return () => {
      window.removeEventListener("resize", updateTopWidth);
    };
  }, [isHistoryOpen, historyRows.length]);

  const historyRowsById = useMemo(() => {
    return new Map(historyRows.map((row) => [row.id, row]));
  }, [historyRows]);
  const historySelectedIdSet = useMemo(() => new Set(historySelectedPaymentIds), [historySelectedPaymentIds]);

  const historySelectedRows = useMemo(() => {
    return historySelectedPaymentIds
      .map((id) => historyRowsById.get(id))
      .filter((row): row is Payment => Boolean(row));
  }, [historySelectedPaymentIds, historyRowsById]);

  const isAllHistoryRowsSelected = historyRows.length > 0 && historySelectedRows.length === historyRows.length;

  useEffect(() => {
    setHistorySelectedPaymentIds((previous) => previous.filter((id) => historyRowsById.has(id)));
  }, [historyRowsById]);

  function toggleHistoryRowSelection(paymentId: string): void {
    setHistorySelectedPaymentIds((previous) =>
      previous.includes(paymentId)
        ? previous.filter((id) => id !== paymentId)
        : [...previous, paymentId]
    );
  }

  function toggleSelectAllHistoryRows(): void {
    if (historyRows.length === 0) {
      setHistorySelectedPaymentIds([]);
      return;
    }
    if (isAllHistoryRowsSelected) {
      setHistorySelectedPaymentIds([]);
      return;
    }
    setHistorySelectedPaymentIds(historyRows.map((row) => row.id));
  }

  async function handleDownloadHistorySelection(): Promise<void> {
    if (historySelectedRows.length === 0 || isHistoryBulkDownloading) return;
    setHistoryBulkDownloadError("");
    setIsHistoryBulkDownloading(true);
    try {
      await downloadPaymentsReceiptsZip(historySelectedRows);
    } catch {
      setHistoryBulkDownloadError("No se pudo generar el ZIP de recibos. Intenta nuevamente.");
    } finally {
      setIsHistoryBulkDownloading(false);
    }
  }

  async function handleDownloadFilteredHistory(): Promise<void> {
    if (historyRows.length === 0 || isHistoryBulkDownloading) return;
    setHistoryBulkDownloadError("");
    setIsHistoryBulkDownloading(true);
    try {
      await downloadPaymentsReceiptsZip(historyRows);
    } catch {
      setHistoryBulkDownloadError("No se pudo generar el ZIP de recibos. Intenta nuevamente.");
    } finally {
      setIsHistoryBulkDownloading(false);
    }
  }

  function scrollToWorkSection(sectionRef: React.RefObject<HTMLElement>): void {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  }

  function handleQuickToggleSection(
    isOpen: boolean,
    setOpen: React.Dispatch<React.SetStateAction<boolean>>,
    sectionRef: React.RefObject<HTMLElement>
  ): void {
    if (isOpen) {
      setOpen(false);
      return;
    }
    setOpen(true);
    scrollToWorkSection(sectionRef);
  }

  function handleQuickImportCSV(): void {
    if (!isPendingOpen) {
      setIsPendingOpen(true);
    }
    scrollToWorkSection(pendingSectionRef);
    void handleImportBankCSV();
  }


  if (confirmedPayment) {
    return (
      <div className="page-inner">
        <header className="hero">
        <h1>Pagos</h1>
          <p>Recibo generado correctamente.</p>
        </header>
        <PaymentReceipt payment={confirmedPayment} onClose={() => setConfirmedPayment(null)} />
      </div>
    );
  }

  return (
    <div className="page-inner">
      {/* -- Payment form -- */}
      <section ref={cashSectionRef} className="panel" style={{ display: isCashClosingOpen ? undefined : "none" }}>
        <div className="panel-head">
          <h2>Cierre de caja</h2>
        </div>
        {isCashClosingOpen && (
        <>
        <div className="payment-form-grid" style={{ marginTop: 12 }}>
          <div className="payment-field-group">
            <label className="payment-label">Usuario</label>
            <input
              type="text"
              className="payment-input"
              placeholder="Ej. Admin Turno A"
              value={cashClosingActor}
              onChange={(e) => setCashClosingActor(e.target.value)}
            />
          </div>
          <div className="payment-field-group">
            <label className="payment-label">Fecha a cerrar</label>
            <input
              type="date"
              className="payment-input"
              value={cashClosingDate}
              onChange={(e) => setCashClosingDate(e.target.value)}
            />
          </div>
          <div className="payment-field-group" style={{ gridColumn: "1 / -1" }}>
            <label className="payment-label">Motivo de cierre</label>
            <input
              type="text"
              className="payment-input"
              placeholder="Ej. Cierre diario despues del corte bancario"
              value={cashClosingReason}
              onChange={(e) => setCashClosingReason(e.target.value)}
            />
          </div>
          <div className="payment-field-group" style={{ display: "flex", alignItems: "flex-end" }}>
            <button type="button" className="button primary" onClick={handleCloseCashForDate}>
              Cerrar caja del dia
            </button>
          </div>
        </div>
        <p className="hint" style={{ marginTop: 8 }}>
          Al cerrar caja, no se podran crear ni eliminar pagos con esa fecha.
        </p>
        {cashClosingInfo && <p className="hint recon-info">{cashClosingInfo}</p>}
        {cashClosingError && <p className="hint error-text">{cashClosingError}</p>}
        {lastCloseReport && (
          <div className="panel" style={{ marginTop: 10, padding: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div>
                <strong>Reporte de cierre {lastCloseReport.closingDate} - cobro {lastCloseReport.targetDate}</strong>
                <div className="hint">
                  Esperados: {lastCloseReport.expectedClients}. Cobrados: {lastCloseReport.chargedClients}. Anomalias: {lastCloseReport.anomalyClients}. Total: {formatCurrency(lastCloseReport.chargedTotal)}.
                </div>
              </div>
              <div>
                <button
                  type="button"
                  className="button ghost small"
                  onClick={() => downloadChargeCloseReportCsv(lastCloseReport)}
                >
                  Descargar reporte CSV
                </button>
              </div>
            </div>
            {lastCloseReport.anomalyClients > 0 && (
              <div className="table-scroll" style={{ marginTop: 10 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Unidad</th>
                      <th>Cliente</th>
                      <th>Motivo</th>
                      <th>LastCharge antes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lastCloseReport.rows
                      .filter((row) => row.anomaly)
                      .slice(0, 50)
                      .map((row) => (
                        <tr key={`anomaly-${row.clientId}`}>
                          <td>{row.unitId}</td>
                          <td>{row.name}</td>
                          <td>{row.reason}</td>
                          <td>{row.lastChargeDateBefore}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
        {cashClosings.length > 0 && (
          <div className="table-scroll" style={{ marginTop: 10 }}>
            <table>
              <thead>
                <tr>
                  <th>Fecha cerrada</th>
                  <th>Cerrado en</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {cashClosings.slice(0, 12).map((c) => (
                  <tr key={c.date}>
                    <td>{c.date}</td>
                    <td>{formatDate(new Date(c.closedAt))}</td>
                    <td className="actions-cell">
                      <button type="button" className="button danger small" onClick={() => openReopenDialog(c.date)}>
                        Reabrir
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {cashClosingAudit.length > 0 && (
          <div className="table-scroll" style={{ marginTop: 10 }}>
            <table>
              <thead>
                <tr>
                  <th>Fecha caja</th>
                  <th>Accion</th>
                  <th>Usuario</th>
                  <th>Motivo</th>
                  <th>Registrado</th>
                </tr>
              </thead>
              <tbody>
                {cashClosingAudit.slice(0, 15).map((event) => (
                  <tr key={event.id}>
                    <td>{event.date}</td>
                    <td>{event.action === "close" ? "Cierre" : "Reapertura"}</td>
                    <td>{event.actor}</td>
                    <td>{event.reason}</td>
                    <td>{formatDate(new Date(event.createdAt))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {chargeRuns.length > 0 && (
          <div className="table-scroll" style={{ marginTop: 10 }}>
            <table>
              <thead>
                <tr>
                  <th>Cierre base</th>
                  <th>Fecha cobrada</th>
                  <th>Esperados</th>
                  <th>Clientes cargados</th>
                  <th>Anomalias</th>
                  <th>Total cargado</th>
                </tr>
              </thead>
              <tbody>
                {chargeRuns.slice(0, 15).map((run) => (
                  <tr key={run.id}>
                    <td>{run.closingDate}</td>
                    <td>{run.targetDate}</td>
                    <td>{run.expectedClients ?? run.chargedClients}</td>
                    <td>{run.chargedClients}</td>
                    <td>{run.anomalyClients ?? 0}</td>
                    <td>{formatCurrency(run.chargedTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        </>
        )}
      </section>

      <section className="panel payment-quick-actions-panel">
        <div className="payment-quick-actions-grid">
          <button
            type="button"
            className={`payment-quick-action${isCashClosingOpen ? " payment-quick-action--active" : ""}`}
            onClick={() => handleQuickToggleSection(isCashClosingOpen, setIsCashClosingOpen, cashSectionRef)}
          >
            <span className="payment-quick-action-title">Cierre de caja</span>
            <span className="payment-quick-action-state">{isCashClosingOpen ? "Ocultar" : "Abrir"}</span>
          </button>

          <button
            type="button"
            className={`payment-quick-action${isRegisterOpen ? " payment-quick-action--active" : ""}`}
            onClick={() => handleQuickToggleSection(isRegisterOpen, setIsRegisterOpen, registerSectionRef)}
          >
            <span className="payment-quick-action-title">Registrar pago</span>
            <span className="payment-quick-action-state">{isRegisterOpen ? "Ocultar" : "Abrir"}</span>
          </button>

          <button
            type="button"
            className={`payment-quick-action${isNotifiedOpen ? " payment-quick-action--active" : ""}`}
            onClick={() => handleQuickToggleSection(isNotifiedOpen, setIsNotifiedOpen, notifiedSectionRef)}
          >
            <span className="payment-quick-action-title">Pago notificado</span>
            <span className="payment-quick-action-state">{isNotifiedOpen ? "Ocultar" : "Abrir"}</span>
          </button>

          <button
            type="button"
            className="payment-quick-action"
            onClick={handleQuickImportCSV}
          >
            <span className="payment-quick-action-title">Importar CSV</span>
            <span className="payment-quick-action-state">Banco</span>
          </button>


          <button
            type="button"
            className={`payment-quick-action${isPendingOpen ? " payment-quick-action--active" : ""}`}
            onClick={() => handleQuickToggleSection(isPendingOpen, setIsPendingOpen, pendingSectionRef)}
          >
            <span className="payment-quick-action-title">Ver pendientes</span>
            <span className="payment-quick-action-state">{isPendingOpen ? "Ocultar" : "Abrir"}</span>
          </button>

          <button
            type="button"
            className={`payment-quick-action${isCardPendingOpen ? " payment-quick-action--active" : ""}`}
            aria-label="Pendientes de conciliacion TDC"
            onClick={() => handleQuickToggleSection(isCardPendingOpen, setIsCardPendingOpen, pendingCardSectionRef)}
          >
            <span className="payment-quick-action-title">Pendientes tarjeta</span>
            <span className="payment-quick-action-state">{isCardPendingOpen ? "Ocultar" : "Abrir"}</span>
          </button>

          <button
            type="button"
            className={`payment-quick-action${isHistoryOpen ? " payment-quick-action--active" : ""}`}
            onClick={() => handleQuickToggleSection(isHistoryOpen, setIsHistoryOpen, historySectionRef)}
          >
            <span className="payment-quick-action-title">Historial pagos</span>
            <span className="payment-quick-action-state">{isHistoryOpen ? "Ocultar" : "Abrir"}</span>
          </button>
        </div>
      </section>

      <section ref={registerSectionRef} className="panel" style={{ display: isRegisterOpen ? undefined : "none" }}>
        <div className="panel-head">
          <h2>Registrar pago</h2>
        </div>

        {isRegisterOpen && (
        <>
        {/* Client selector */}
        <div className="payment-form-grid" style={{ marginTop: 16 }}>
          <div className="payment-field-group" style={{ gridColumn: "1 / -1" }}>
            <label className="payment-label">Cliente</label>
            {selectedClient ? (
              <div className="client-selected-pill">
                <span><strong>{selectedClient.unitId}</strong> - {selectedClient.name}{selectedClient.cedula ? ` (${selectedClient.cedula})` : ""}</span>
                <button type="button" className="client-pill-clear" onClick={handleClearClient} title="Cambiar cliente">X</button>
              </div>
            ) : (
              <div className="client-selector">
                <input
                  ref={searchRef}
                  type="text"
                  className="client-search-input"
                  placeholder="Buscar por unidad, nombre o cedula..."
                  value={clientSearch}
                  onChange={(e) => { setClientSearch(e.target.value); setDropdownOpen(true); }}
                  onFocus={() => setDropdownOpen(true)}
                  onBlur={() => setTimeout(() => setDropdownOpen(false), 150)}
                  autoComplete="off"
                />
                {dropdownOpen && filteredClients.length > 0 && (
                  <div className="client-dropdown">
                    {filteredClients.map((c) => (
                      <div key={c.id} className="client-dropdown-item" onMouseDown={() => handleSelectClient(c)}>
                        <strong>{c.unitId}</strong> - {c.name}
                        {c.cedula && <span className="client-dropdown-cedula"> - {c.cedula}</span>}
                        <span className="client-dropdown-balance"> - {formatCurrency(c.balance)}</span>
                      </div>
                    ))}
                  </div>
                )}
                {dropdownOpen && filteredClients.length === 0 && clientSearch.trim() && (
                  <div className="client-dropdown">
                    <div className="client-dropdown-empty">Sin resultados para "{clientSearch}"</div>
                  </div>
                )}
              </div>
            )}
          </div>

          {selectedClient && (
            <div className="payment-field-group" style={{ gridColumn: "1 / -1" }}>
              <label className="payment-label">Fondo de viaje (USD)</label>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <input
                  type="number"
                  className="payment-input"
                  min="0"
                  step="0.01"
                  value={registerTravelFundInput}
                  onChange={(e) => setRegisterTravelFundInput(e.target.value)}
                  placeholder="0.00"
                  style={{ maxWidth: 180 }}
                />
                <button type="button" className="button ghost small" onClick={handleSaveSelectedClientTravelFund}>
                  Guardar fondo
                </button>
                <span className="payment-inline-hint">
                  Disponible actual: {formatCurrency(roundMoney(Math.max(0, selectedClient.travelFundBalance ?? 0)))}
                </span>
              </div>
            </div>
          )}

          {/* Date */}
          <div className="payment-field-group">
            <label className="payment-label">Fecha aplicada (automatica por cierre)</label>
            <input
              type="date"
              className="payment-input"
              value={operationalDateKey}
              disabled
              readOnly
            />
            <span className="payment-inline-hint">Se calcula como ultimo cierre + 1 dia.</span>
          </div>

          {/* Method */}
          <div className="payment-field-group">
            <label className="payment-label">Forma de pago</label>
            <div className="payment-method-grid" role="radiogroup" aria-label="Forma de pago">
              {PAYMENT_METHODS.map((m) => {
                const isSelected = form.paymentMethod === m;
                return (
                  <button
                    key={m}
                    type="button"
                    className={`payment-method-option${isSelected ? " payment-method-option--active" : ""}`}
                    aria-pressed={isSelected}
                    onClick={() => setForm((f) => ({ ...f, paymentMethod: m }))}
                  >
                    {m}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="payment-field-group">
            <label className="payment-label">{(isBankPayment || isCardPayment) ? "Referencia (Folio)" : "Referencia (Opcional)"}</label>
            <input
              type="text"
              className="payment-input"
              placeholder={isBankPayment ? "Obligatorio para pago bancario" : isCardPayment ? "Opcional (si no, se crea folio temporal)" : "Opcional"}
              value={form.reference}
              onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
            />
            {(isBankPayment || isCardPayment) && (
              <span className="payment-inline-hint">
                {isCardPayment
                  ? "El pago en tarjeta se aplica de inmediato y queda pendiente solo para conciliacion bancaria por folio."
                  : "Para pagos bancarios debes colocar el folio o referencia."}
              </span>
            )}
          </div>

          {/* Amount */}
          <div className="payment-field-group">
            <label className="payment-label">Monto recibido (USD)</label>
            <input
              type="number"
              className="payment-input payment-input--amount"
              step="0.01"
              min="0.01"
              placeholder="0.00"
              value={form.amountReceived}
              onChange={(e) => {
                setForm((f) => ({ ...f, amountReceived: e.target.value }));
                setAutoAmountInfo("");
              }}
            />
            {monthEndSuggestion && (
              <div style={{ marginTop: 8 }}>
                <button
                  type="button"
                  className="button ghost small"
                  onClick={handleAutoFillToMonthEnd}
                >
                  Auto hasta fin de mes
                </button>
                <span className="payment-inline-hint" style={{ display: "inline-block", marginLeft: 8 }}>
                  Objetivo: {formatDate(monthEndSuggestion.targetDate)}
                </span>
              </div>
            )}
            {autoAmountInfo && <span className="payment-inline-hint">{autoAmountInfo}</span>}
          </div>
        </div>

        {/* Zero balance notice */}
        {isZeroBalance && (
          <div className="payment-notice">
            Este cliente no tiene saldo pendiente. El monto se aplicara como pago adelantado de renta.
          </div>
        )}

        {/* Otros cargos */}
        {selectedClient && (selectedClient.otherCharges ?? []).length > 0 && (
          <div className="other-charges-section" style={{ marginTop: 14 }}>
            <div className="other-charges-title">Otros cargos de este cliente</div>
            {isForcedOtherChargesRuleClient && (
              <>
                <p className="hint" style={{ marginTop: 4, marginBottom: 8 }}>
                  {isForcedOtherChargesRuleActive
                    ? `Regla automatica activa (${getRetentionCycleLabel(selectedClientRetentionConfig.cycle)}): monto base ${formatCurrency(selectedClientRetentionConfig.amount)}.`
                    : "Edicion manual activa para este pago: puedes definir otros cargos manualmente."}
                </p>
                <button
                  type="button"
                  className="button ghost small"
                  onClick={() => setManualOverrideForcedOtherCharges((prev) => !prev)}
                >
                  {isForcedOtherChargesRuleActive ? "Editar este pago" : "Volver a automatico"}
                </button>
              </>
            )}
            {(selectedClient.otherCharges ?? []).map((charge, index) => (
              <div key={getOtherChargeKey(charge, index)} className="other-charges-row">
                <label className="payment-label">{charge.label} <span className="amount-muted">(configurado: {formatCurrency(charge.amount)})</span></label>
                {isForcedOtherChargesRuleActive ? (
                  <div className="payment-input" style={{ display: "flex", alignItems: "center" }}>
                    Aplicacion automatica
                  </div>
                ) : (
                  <input
                    type="number"
                    className="payment-input"
                    min="0"
                    step="0.01"
                    placeholder={String(charge.amount)}
                    value={manualOtherChargesInput[getOtherChargeKey(charge, index)] ?? charge.amount}
                    onChange={(e) => setManualOtherChargesInput((prev) => ({ ...prev, [getOtherChargeKey(charge, index)]: e.target.value }))}
                  />
                )}
              </div>
            ))}
          </div>
        )}

        {/* Preview */}
        {preview && selectedClient && (
          <div className="payment-preview">
            <div className="payment-preview-title">Vista previa del pago</div>
            <div className="payment-preview-body">
              <div className="payment-preview-col">
                <div className="payment-preview-row">
                  <span>Saldo actual</span>
                  <strong className="amount-debt">{formatCurrency(preview.balanceBefore)}</strong>
                </div>
                <div className="payment-preview-row">
                  <span>Aplicado a renta</span>
                  <strong>{formatCurrency(preview.appliedToRent)}</strong>
                </div>
                {preview.totalOtherCharges > 0 && (
                  <div className="payment-preview-row">
                    <span>{preview.forcedOtherChargesRuleApplied ? "Otros cargos (regla automatica)" : "Otros cargos (manual)"}</span>
                    <strong className="amount-warning">{formatCurrency(preview.totalOtherCharges)}</strong>
                  </div>
                )}
                {preview.centavosAhorro > 0 && (
                  <div className="payment-preview-row">
                    <span>Ahorro (centavos)</span>
                    <strong>{formatCurrency(preview.centavosAhorro)}</strong>
                  </div>
                )}
                {preview.advanceApplied > 0 && (
                  <div className="payment-preview-row">
                    <span>Pago adelantado</span>
                    <strong>{formatCurrency(preview.advanceApplied)}</strong>
                  </div>
                )}
                {previewAdvanceLetterLabel && (
                  <div className="payment-preview-row">
                    <span>Adelanto aplica a</span>
                    <strong>{previewAdvanceLetterLabel}</strong>
                  </div>
                )}
              </div>
              <div className="payment-preview-col">
                <div className="payment-preview-row">
                  <span>Nuevo saldo</span>
                  <strong className={preview.balanceAfter <= 0 ? "amount-good" : "amount-debt"}>{formatCurrency(preview.balanceAfter)}</strong>
                </div>
                <div className="payment-preview-row">
                  <span>Cuotas deducidas</span>
                  <strong>{preview.installmentsDeducted}</strong>
                </div>
                <div className="payment-preview-row">
                  <span>Cuotas restantes</span>
                  <strong>{Math.max(0, selectedClient.installmentsRemaining - preview.installmentsDeducted)}</strong>
                </div>
                {projectedNextChargeDate && (
                  <div className="payment-preview-row">
                    <span>Prox. fecha de pago</span>
                    <strong>{formatDate(projectedNextChargeDate)}</strong>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {errors.length > 0 && (
          <ul className="error-list">{errors.map((e) => <li key={e}>{e}</li>)}</ul>
        )}
        {paymentInfo && <p className="hint recon-info">{paymentInfo}</p>}

        <div style={{ marginTop: 20 }}>
          <button
            type="button"
            className="button primary"
            onClick={handleConfirmPayment}
            disabled={!form.clientId || !preview || isDateClosed(operationalDateKey)}
          >
            Confirmar pago y generar recibo
          </button>
        </div>
        </>
        )}
      </section>

      <section ref={notifiedSectionRef} className="panel" style={{ display: isNotifiedOpen ? undefined : "none" }}>
        <div className="panel-head">
          <h2>Pagos notificados (pendientes)</h2>
        </div>

        {isNotifiedOpen && (
        <>
        <p className="hint">Ingresa la unidad y el monto. El sistema trae automaticamente el cliente.</p>

        <div className="payment-form-grid" style={{ marginTop: 12 }}>
          <div className="payment-field-group">
            <label className="payment-label">Unidad</label>
            <input
              type="text"
              className="payment-input"
              placeholder="Ej. T01"
              value={notifiedForm.unitId}
              onChange={(e) => setNotifiedForm((f) => ({ ...f, unitId: e.target.value }))}
            />
          </div>

          <div className="payment-field-group">
            <label className="payment-label">Monto notificado (USD)</label>
            <input
              type="number"
              className="payment-input payment-input--amount"
              min="0.01"
              step="0.01"
              placeholder="0.00"
              value={notifiedForm.amount}
              onChange={(e) => setNotifiedForm((f) => ({ ...f, amount: e.target.value }))}
            />
          </div>
        </div>

        <div className="hint" style={{ marginTop: 6 }}>
          {notifiedForm.unitId.trim() === ""
            ? "Cliente detectado: -"
            : notifiedClientMatch
              ? `Cliente detectado: ${notifiedClientMatch.unitId} - ${notifiedClientMatch.name}`
              : "Cliente detectado: unidad no encontrada"}
        </div>

        {notifiedErrors.length > 0 && (
          <ul className="error-list">{notifiedErrors.map((e) => <li key={e}>{e}</li>)}</ul>
        )}

        <div style={{ marginTop: 14 }}>
          <button type="button" className="button primary" onClick={handleAddNotifiedPayment}>
            Guardar pago notificado
          </button>
        </div>

        {notifiedRows.length === 0 ? (
          <p className="empty">No hay pagos notificados pendientes.</p>
        ) : (
          <div className="table-scroll" style={{ marginTop: 14 }}>
            <table>
              <thead>
                <tr>
                  <th>
                    <button type="button" className="button ghost small" onClick={() => handleSortNotified("unit")}>
                      Unidad {notifiedSortField === "unit" ? (notifiedSortDirection === "desc" ? "v" : "^") : ""}
                    </button>
                  </th>
                  <th>
                    <button type="button" className="button ghost small" onClick={() => handleSortNotified("client")}>
                      Cliente {notifiedSortField === "client" ? (notifiedSortDirection === "desc" ? "v" : "^") : ""}
                    </button>
                  </th>
                  <th>
                    <button type="button" className="button ghost small" onClick={() => handleSortNotified("amount")}>
                      Monto {notifiedSortField === "amount" ? (notifiedSortDirection === "desc" ? "v" : "^") : ""}
                    </button>
                  </th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {notifiedRows.map((row) => {
                  const client = clients.find((c) => c.id === row.clientId);
                  const isEditing = editingNotifiedId === row.id;
                  return (
                    <tr key={row.id}>
                      <td>
                        {isEditing ? (
                          <input
                            type="text"
                            className="payment-input"
                            value={editingNotifiedForm.unitId}
                            onChange={(e) => setEditingNotifiedForm((prev) => ({ ...prev, unitId: e.target.value }))}
                            placeholder="Unidad"
                            style={{ minWidth: 90 }}
                          />
                        ) : (
                          client?.unitId ?? "-"
                        )}
                      </td>
                      <td>
                        {isEditing
                          ? (editingNotifiedClientMatch?.name ?? "Cliente no encontrado")
                          : (client?.name ?? "Cliente no encontrado")}
                      </td>
                      <td>
                        {isEditing ? (
                          <input
                            type="number"
                            className="payment-input payment-input--amount"
                            min="0.01"
                            step="0.01"
                            value={editingNotifiedForm.amount}
                            onChange={(e) => setEditingNotifiedForm((prev) => ({ ...prev, amount: e.target.value }))}
                            style={{ minWidth: 100 }}
                          />
                        ) : (
                          <span className="amount-good">{formatCurrency(row.amount)}</span>
                        )}
                      </td>
                      <td className="actions-cell">
                        {isEditing ? (
                          <>
                            <button
                              type="button"
                              className="button primary small"
                              onClick={() => handleSaveEditNotified(row)}
                            >
                              Guardar
                            </button>
                            <button
                              type="button"
                              className="button ghost small"
                              onClick={handleCancelEditNotified}
                            >
                              Cancelar
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="button ghost small"
                            onClick={() => handleStartEditNotified(row)}
                          >
                            Editar
                          </button>
                        )}
                        <button
                          type="button"
                          className="button danger small"
                          onClick={() => handleDeleteNotifiedPayment(row.id)}
                        >
                          Eliminar
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        </>
        )}
      </section>

      <section ref={pendingCardSectionRef} className="panel" style={{ display: isCardPendingOpen ? undefined : "none" }}>
        <div className="panel-head">
          <h2>Pendientes por folio (Tarjeta)</h2>
        </div>
        {isCardPendingOpen && (
          <>
            <p className="hint">Estos pagos ya fueron aplicados al cliente. Este panel es solo para conciliacion bancaria por lote/folio.</p>
            {cardPendingMessage && (
              <p className={`hint ${cardPendingMessage.startsWith("No se") || cardPendingMessage.startsWith("Debes") ? "error-text" : "recon-info"}`}>
                {cardPendingMessage}
              </p>
            )}
            {pendingCardItems.length === 0 ? (
              <p className="empty">No hay pagos de tarjeta pendientes.</p>
            ) : (
              <>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, marginBottom: 8 }}>
                  <input
                    type="text"
                    className="payment-input"
                    style={{ maxWidth: 280 }}
                    placeholder="Folio final del lote"
                    value={bulkPendingCardFolio}
                    onChange={(e) => setBulkPendingCardFolio(e.target.value)}
                  />
                  <button type="button" className="button primary small" onClick={handleApplyFolioToAllPendingCards}>
                    Aplicar folio a todos
                  </button>
                </div>
                <div className="table-scroll" style={{ marginTop: 10 }}>
                  <table>
                  <thead>
                    <tr>
                      <th>Folio</th>
                      <th>Fecha registro</th>
                      <th>Fecha esperada banco</th>
                      <th>Unidad</th>
                      <th>Cliente</th>
                      <th>Monto esperado</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingCardItems.map((item) => (
                      <tr key={item.id}>
                        <td>
                          {editingPendingCardId === item.id ? (
                            <input
                              type="text"
                              className="payment-input"
                              value={editingPendingCardForm.folio}
                              onChange={(e) => setEditingPendingCardForm((prev) => ({ ...prev, folio: e.target.value }))}
                            />
                          ) : (
                            <code>{item.folio}</code>
                          )}
                        </td>
                        <td>{item.dateRegistered}</td>
                        <td>{item.expectedSettlementDate}</td>
                        <td>{item.clientUnit}</td>
                        <td>{item.clientName}</td>
                        <td><strong>{formatCurrency(item.amountExpected)}</strong></td>
                        <td className="actions-cell">
                          {editingPendingCardId === item.id ? (
                            <>
                              <input
                                type="text"
                                className="payment-input"
                                placeholder="Referencia opcional"
                                value={editingPendingCardForm.reference}
                                onChange={(e) => setEditingPendingCardForm((prev) => ({ ...prev, reference: e.target.value }))}
                                style={{ minWidth: 180 }}
                              />
                              <button type="button" className="button primary small" onClick={() => handleSaveEditPendingCard(item)}>
                                Guardar
                              </button>
                              <button type="button" className="button ghost small" onClick={handleCancelEditPendingCard}>
                                Cancelar
                              </button>
                            </>
                          ) : (
                            <>
                              <button type="button" className="button primary small" onClick={() => handleGeneratePendingCardReceipt(item)}>
                                Comprobante
                              </button>
                              <button type="button" className="button ghost small" onClick={() => handleStartEditPendingCard(item)}>
                                Editar
                              </button>
                              <button type="button" className="button danger small" onClick={() => handleRemovePendingCard(item.id)}>
                                Eliminar
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}
      </section>

      {/* -- Pending bank items -- */}
      <section ref={pendingSectionRef} className="panel" style={{ display: isPendingOpen ? undefined : "none" }}>
        <div className="panel-head">
          <h2>
            Pendientes del banco
            {pendingBankItems.length > 0 && (
              <span className="badge-count">{pendingBankItems.length}</span>
            )}
          </h2>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {pendingBankItems.some((item) => {
              const { score } = getSimilaritySignals(item);
              if (score < 2) return false;
              const c = clients.find((cl) => cl.id === item.suggestedClientId);
              return c && !(c.otherCharges?.length);
            }) && (
              <button type="button" className="button primary small" onClick={handleApplyAllHighSimilarity}>
                Aplicar alta similitud
              </button>
            )}
            {pendingBankItems.length > 0 && (
              <button type="button" className="button danger small" onClick={handleDismissAllPending}>
                Ignorar todos
              </button>
            )}
          </div>
        </div>

        {pendingImportError && (
          <p className={`hint ${pendingImportError.startsWith("Error") || pendingImportError.startsWith("No se") ? "error-text" : "recon-info"}`} style={{ marginTop: 8 }}>
            {pendingImportError}
          </p>
        )}

        {isPendingOpen && (
          <>
            <p className="hint" style={{ marginTop: 8 }}>
              La importacion aplica regla automatica por cuenta y grupo. En edicion manual puedes asignar cualquier cliente.
            </p>
            {hasPendingColumnFilters && (
              <div style={{ marginTop: 8 }}>
                <button type="button" className="button ghost small" onClick={clearPendingFilters}>
                  Limpiar filtros
                </button>
              </div>
            )}
            {pendingBankItems.length === 0 ? (
            <p className="empty">No hay movimientos pendientes de asignar cliente.</p>
            ) : (
              <>
              <div className="top-scroll" ref={pendingTopScrollRef} style={{ marginTop: 10 }}>
                <div ref={pendingTopInnerRef} className="top-scroll-inner" />
              </div>
              <div className="table-scroll" ref={pendingBottomScrollRef}>
                <table>
                  <thead>
                    <tr>
                      <th>Folio</th>
                      <th>Cuenta</th>
                      <th>Grupo</th>
                      <th>Fecha</th>
                      <th>Monto</th>
                      <th>Nombre extraido</th>
                      <th>Similitud</th>
                      <th>Unidad</th>
                      <th>Vista previa</th>
                      <th>Descripcion</th>
                      <th>Acciones</th>
                    </tr>
                    <tr>
                      <th><input type="text" className="payment-input" placeholder="Buscar" value={pendingFilters.folio} onChange={(e) => updatePendingFilter("folio", e.target.value)} /></th>
                      <th><input type="text" className="payment-input" placeholder="Buscar" value={pendingFilters.account} onChange={(e) => updatePendingFilter("account", e.target.value)} /></th>
                      <th><input type="text" className="payment-input" placeholder="Buscar" value={pendingFilters.group} onChange={(e) => updatePendingFilter("group", e.target.value)} /></th>
                      <th><input type="text" className="payment-input" placeholder="Buscar" value={pendingFilters.date} onChange={(e) => updatePendingFilter("date", e.target.value)} /></th>
                      <th><input type="text" className="payment-input" placeholder="Buscar" value={pendingFilters.amount} onChange={(e) => updatePendingFilter("amount", e.target.value)} /></th>
                      <th><input type="text" className="payment-input" placeholder="Buscar" value={pendingFilters.name} onChange={(e) => updatePendingFilter("name", e.target.value)} /></th>
                      <th><input type="text" className="payment-input" placeholder="Buscar" value={pendingFilters.similarity} onChange={(e) => updatePendingFilter("similarity", e.target.value)} /></th>
                      <th><input type="text" className="payment-input" placeholder="Buscar" value={pendingFilters.unit} onChange={(e) => updatePendingFilter("unit", e.target.value)} /></th>
                      <th><input type="text" className="payment-input" placeholder="Buscar" value={pendingFilters.preview} onChange={(e) => updatePendingFilter("preview", e.target.value)} /></th>
                      <th><input type="text" className="payment-input" placeholder="Buscar" value={pendingFilters.description} onChange={(e) => updatePendingFilter("description", e.target.value)} /></th>
                      <th><input type="text" className="payment-input" placeholder="Buscar" value={pendingFilters.actions} onChange={(e) => updatePendingFilter("actions", e.target.value)} /></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPendingBankItems.map((item) => {
                      const assignedClient = item.suggestedClientId ? clients.find((c) => c.id === item.suggestedClientId) : null;
                      const hasOtherCharges = !!(assignedClient?.otherCharges?.length);
                      const isPreMatched = !!item.suggestedClientId;
                      const { nombre, centavos, notificado, score } = getSimilaritySignals(item);
                      const isHighSim = score >= 2 && !hasOtherCharges && !!assignedClient;
                      const unitProbability = score >= 3 ? "Alta" : score === 2 ? "Media" : score === 1 ? "Baja" : "Sin datos";
                      const rowClass = hasOtherCharges ? "pending-row--other-charges" : isHighSim ? "pending-row--high-sim" : isPreMatched ? "pending-row--ready" : "";
                      const pendingPreview = getPendingBankPreview(item, assignedClient);
                      const upToDateUntilDate = pendingPreview?.upToDateUntil
                        ? parseDateKey(pendingPreview.upToDateUntil)
                        : null;
                      const installmentsImpact = (pendingPreview?.installmentsDeducted ?? 0) + (pendingPreview?.installmentsCoveredByAdvance ?? 0);
                      return (
                        <tr key={item.folio} className={rowClass}>
                          <td><code>{item.folio}</code></td>
                          <td>{item.accountNumber ? <code>{item.accountNumber}</code> : <span className="amount-muted">-</span>}</td>
                          <td>{item.mappedGroup ? `Grupo ${item.mappedGroup}` : <span className="amount-muted">-</span>}</td>
                          <td>{item.dateApplied}</td>
                          <td><span className="amount-good">{formatCurrency(item.amountReceived)}</span></td>
                          <td>
                            {isPreMatched
                              ? <>
                                  {hasOtherCharges && <span className="badge-other-charges" title="Cliente con otros cargos">*</span>}
                                  {notificado && <span className="badge-notified" title="Pago notificado">OK</span>}
                                  {centavos && <span className="badge-cents" title="Pago con centavos">c</span>}
                                  {item.suggestedClientName}
                                </>
                              : item.extractedName || <span className="amount-muted">-</span>}
                          </td>
                          <td>
                            {isHighSim && (
                              <span className="badge-sim" title={`Alta similitud: ${[nombre && "nombre", centavos && "centavos", notificado && "notificado"].filter(Boolean).join(", ")}`}>
                                Alta similitud
                              </span>
                            )}
                          </td>
                          <td>
                            <div className={`unit-prob unit-prob--${score >= 3 ? "high" : score === 2 ? "medium" : "low"}`}>
                              Probabilidad: {unitProbability}
                            </div>
                            {assignedClient && (
                              <div className="unit-preview">{assignedClient.unitId} - {assignedClient.name}</div>
                            )}
                            <select
                              className="payment-input pending-unit-select"
                              value={item.suggestedClientId ?? ""}
                              onChange={(e) => handlePendingUnitChange(item, e.target.value)}
                            >
                              <option value="">Asignar cliente</option>
                              {activeClients.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.unitId} - {c.name}
                                </option>
                              ))}
                            </select>
                            {!item.suggestedClientId && (
                              <div className="hint" style={{ marginTop: 4, fontSize: 11 }}>Asignar Cliente</div>
                            )}
                            {assignedClient && (
                              <div style={{ marginTop: 8, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                                <input
                                  type="number"
                                  className="payment-input"
                                  min="0"
                                  step="0.01"
                                  value={pendingTravelFundInputByFolio[item.folio] ?? toInputMoney(roundMoney(Math.max(0, assignedClient.travelFundBalance ?? 0)))}
                                  onChange={(e) =>
                                    setPendingTravelFundInputByFolio((prev) => ({ ...prev, [item.folio]: e.target.value }))
                                  }
                                  placeholder="Fondo viaje"
                                  style={{ width: 120 }}
                                />
                                <button
                                  type="button"
                                  className="button ghost small"
                                  onClick={() => handleSavePendingClientTravelFund(assignedClient, item.folio)}
                                >
                                  Guardar fondo
                                </button>
                              </div>
                            )}
                          </td>
                          <td>
                            {pendingPreview ? (
                              <div className="pending-preview-card">
                                <div className="pending-preview-row"><span>Renta</span><strong>{formatCurrency(pendingPreview.rentAmount)}</strong></div>
                                <div className="pending-preview-row"><span>Frecuencia</span><strong>{pendingPreview.frequencyLabel}</strong></div>
                                <div className="pending-preview-row"><span>Cuotas pactadas</span><strong>{pendingPreview.installmentsAgreed}</strong></div>
                                <div className="pending-preview-row"><span>Cuotas restantes despues del pago</span><strong>{pendingPreview.installmentsRemainingAfter}</strong></div>
                                {pendingPreview.balanceAfter <= 0 && (
                                  <div className="pending-preview-row">
                                    <span>Al dia hasta</span>
                                    <strong className="amount-good">{upToDateUntilDate ? formatDate(upToDateUntilDate) : "-"}</strong>
                                  </div>
                                )}
                                <div className="pending-preview-row">
                                  <span>Impacto de cuotas</span>
                                  <strong className={installmentsImpact > 0 ? "amount-good" : "amount-muted"}>
                                    {installmentsImpact > 0
                                      ? `-${installmentsImpact} ${installmentsImpact === 1 ? "cuota" : "cuotas"}`
                                      : "Sin cambio"}
                                  </strong>
                                </div>
                                <div className="pending-preview-row"><span>Monto a cobrar</span><strong className={pendingPreview.balanceAfter > 0 ? "amount-debt" : "amount-good"}>{formatCurrency(pendingPreview.balanceAfter)}</strong></div>
                              </div>
                            ) : (
                              <span className="amount-muted">Asigna cliente para ver vista previa</span>
                            )}
                          </td>
                          <td style={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={item.description}>{item.description}</td>
                          <td className="actions-cell">
                            {isHighSim && assignedClient && (
                              <button type="button" className="button primary small" onClick={() => handleQuickApply(item)}>
                                Aplicar
                              </button>
                            )}
                            {assignedClient && (!isHighSim || hasOtherCharges) && (
                              <button type="button" className="button ghost small" onClick={() => handleOpenClassify(item)}>
                                {hasOtherCharges ? "Revisar cargos" : "Revisar"}
                              </button>
                            )}
                            <button type="button" className="button danger small" onClick={() => handleDismissPending(item.folio)}>
                              Ignorar
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {filteredPendingBankItems.length === 0 && (
                      <tr>
                        <td colSpan={11}>
                          <span className="amount-muted">No hay resultados con los filtros actuales.</span>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              </>
            )}
          </>
        )}
      </section>

      {/* -- Payment history -- */}
      <section ref={historySectionRef} className="panel" style={{ display: isHistoryOpen ? undefined : "none" }}>
        <div className="panel-head">
          <h2>Historial de pagos</h2>
        </div>
        {isHistoryOpen && (
        <>
        <div className="panel-head" style={{ marginTop: 10, gap: 8, flexWrap: "wrap" }}>
          <select
            value={historyClientId}
            onChange={(e) => setHistoryClientId(e.target.value)}
            className="history-filter-select"
          >
            <option value="all">Todos los clientes</option>
            {activeClients.map((c) => (
              <option key={c.id} value={c.id}>{c.unitId} - {c.name}</option>
            ))}
          </select>
          <select
            value={historyGroupFilter}
            onChange={(e) => setHistoryGroupFilter(e.target.value)}
            className="history-filter-select"
          >
            <option value="all">Todos los grupos</option>
            {historyAvailableGroups.map((group) => (
              <option key={group} value={group}>Grupo {group}</option>
            ))}
          </select>
          <input
            type="date"
            className="payment-input"
            value={historyDateFrom}
            onChange={(e) => setHistoryDateFrom(e.target.value)}
            title="Filtrar desde fecha"
            style={{ width: 180 }}
          />
          <input
            type="date"
            className="payment-input"
            value={historyDateTo}
            onChange={(e) => setHistoryDateTo(e.target.value)}
            title="Filtrar hasta fecha"
            style={{ width: 180 }}
          />
          {(historyDateFrom || historyDateTo) && (
            <button
              type="button"
              className="button ghost small"
              onClick={() => {
                setHistoryDateFrom("");
                setHistoryDateTo("");
              }}
            >
              Limpiar fechas
            </button>
          )}
        </div>

        {historyDateRangeError && <p className="hint error-text">{historyDateRangeError}</p>}

        {historyRows.length === 0 ? (
          <p className="empty">No hay pagos registrados aun.</p>
        ) : (
          <>
          <div className="history-bulk-bar">
            <div className="history-bulk-summary">
              {historySelectedRows.length > 0
                ? `${historySelectedRows.length} seleccionados de ${historyRows.length}`
                : `${historyRows.length} recibos filtrados`}
            </div>
            <div className="history-bulk-actions">
              <button
                type="button"
                className="button ghost small"
                onClick={toggleSelectAllHistoryRows}
                disabled={isHistoryBulkDownloading}
              >
                {isAllHistoryRowsSelected ? "Limpiar seleccion" : "Seleccionar todo"}
              </button>
              <button
                type="button"
                className="button primary small"
                onClick={handleDownloadHistorySelection}
                disabled={isHistoryBulkDownloading || historySelectedRows.length === 0}
                title="Descarga los recibos seleccionados en un ZIP"
              >
                {isHistoryBulkDownloading ? "Generando ZIP..." : `Descargar seleccionados (${historySelectedRows.length})`}
              </button>
              <button
                type="button"
                className="button ghost small"
                onClick={handleDownloadFilteredHistory}
                disabled={isHistoryBulkDownloading}
                title="Descarga todos los recibos del filtro actual en un ZIP"
              >
                Descargar filtrados ({historyRows.length})
              </button>
          </div>
          </div>
          {historyBulkDownloadError && <p className="hint error-text">{historyBulkDownloadError}</p>}
          {hasHistoryColumnFilters && (
            <div style={{ marginBottom: 8 }}>
              <button type="button" className="button ghost small" onClick={clearHistoryColumnFilters}>
                Limpiar filtros de columnas
              </button>
            </div>
          )}
          <div className="top-scroll" ref={historyTopScrollRef}>
            <div ref={historyTopInnerRef} className="top-scroll-inner" />
          </div>
          <div className="table-scroll" ref={historyBottomScrollRef}>
            <table>
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      className="history-checkbox"
                      checked={isAllHistoryRowsSelected}
                      onChange={toggleSelectAllHistoryRows}
                      aria-label={isAllHistoryRowsSelected ? "Deseleccionar todos los recibos" : "Seleccionar todos los recibos"}
                    />
                  </th>
                  <th><button type="button" className="sort-button" onClick={() => handleSortHistory("receipt")}>Recibo <span className={`sort-icon ${historySortField === "receipt" ? "active" : ""}`}>{renderHistorySortIcon("receipt")}</span></button></th>
                  <th><button type="button" className="sort-button" onClick={() => handleSortHistory("date")}>Fecha <span className={`sort-icon ${historySortField === "date" ? "active" : ""}`}>{renderHistorySortIcon("date")}</span></button></th>
                  <th><button type="button" className="sort-button" onClick={() => handleSortHistory("unit")}>Unidad <span className={`sort-icon ${historySortField === "unit" ? "active" : ""}`}>{renderHistorySortIcon("unit")}</span></button></th>
                  <th><button type="button" className="sort-button" onClick={() => handleSortHistory("client")}>Cliente <span className={`sort-icon ${historySortField === "client" ? "active" : ""}`}>{renderHistorySortIcon("client")}</span></button></th>
                  <th><button type="button" className="sort-button" onClick={() => handleSortHistory("amount")}>Monto <span className={`sort-icon ${historySortField === "amount" ? "active" : ""}`}>{renderHistorySortIcon("amount")}</span></button></th>
                  <th><button type="button" className="sort-button" onClick={() => handleSortHistory("applied")}>A renta <span className={`sort-icon ${historySortField === "applied" ? "active" : ""}`}>{renderHistorySortIcon("applied")}</span></button></th>
                  <th><button type="button" className="sort-button" onClick={() => handleSortHistory("savings")}>Ahorro <span className={`sort-icon ${historySortField === "savings" ? "active" : ""}`}>{renderHistorySortIcon("savings")}</span></button></th>
                  <th><button type="button" className="sort-button" onClick={() => handleSortHistory("installments")}>Cuotas <span className={`sort-icon ${historySortField === "installments" ? "active" : ""}`}>{renderHistorySortIcon("installments")}</span></button></th>
                  <th><button type="button" className="sort-button" onClick={() => handleSortHistory("method")}>Metodo <span className={`sort-icon ${historySortField === "method" ? "active" : ""}`}>{renderHistorySortIcon("method")}</span></button></th>
                  <th></th>
                </tr>
                <tr>
                  <th></th>
                  <th><input type="text" className="payment-input history-column-filter-input" placeholder="Filtrar" value={historyColumnFilters.receipt} onChange={(e) => updateHistoryColumnFilter("receipt", e.target.value)} /></th>
                  <th><input type="text" className="payment-input history-column-filter-input" placeholder="Filtrar" value={historyColumnFilters.date} onChange={(e) => updateHistoryColumnFilter("date", e.target.value)} /></th>
                  <th><input type="text" className="payment-input history-column-filter-input" placeholder="Filtrar" value={historyColumnFilters.unit} onChange={(e) => updateHistoryColumnFilter("unit", e.target.value)} /></th>
                  <th><input type="text" className="payment-input history-column-filter-input" placeholder="Filtrar" value={historyColumnFilters.client} onChange={(e) => updateHistoryColumnFilter("client", e.target.value)} /></th>
                  <th><input type="text" className="payment-input history-column-filter-input" placeholder="Filtrar" value={historyColumnFilters.amount} onChange={(e) => updateHistoryColumnFilter("amount", e.target.value)} /></th>
                  <th><input type="text" className="payment-input history-column-filter-input" placeholder="Filtrar" value={historyColumnFilters.applied} onChange={(e) => updateHistoryColumnFilter("applied", e.target.value)} /></th>
                  <th><input type="text" className="payment-input history-column-filter-input" placeholder="Filtrar" value={historyColumnFilters.savings} onChange={(e) => updateHistoryColumnFilter("savings", e.target.value)} /></th>
                  <th><input type="text" className="payment-input history-column-filter-input" placeholder="Filtrar" value={historyColumnFilters.installments} onChange={(e) => updateHistoryColumnFilter("installments", e.target.value)} /></th>
                  <th><input type="text" className="payment-input history-column-filter-input" placeholder="Filtrar" value={historyColumnFilters.method} onChange={(e) => updateHistoryColumnFilter("method", e.target.value)} /></th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {historyRows.map((p) => (
                  <tr key={p.id} className={historySelectedIdSet.has(p.id) ? "history-row--selected" : ""}>
                    <td>
                      <input
                        type="checkbox"
                        className="history-checkbox"
                        checked={historySelectedIdSet.has(p.id)}
                        onChange={() => toggleHistoryRowSelection(p.id)}
                        aria-label={`Seleccionar recibo ${p.receiptNumber}`}
                      />
                    </td>
                    <td><strong>{p.receiptNumber}</strong></td>
                    <td>{formatDate(new Date(`${p.dateApplied}T12:00:00`))}</td>
                    <td>{p.clientUnit}</td>
                    <td>{p.clientName}</td>
                    <td><span className="amount-good">{formatCurrency(p.amountReceived)}</span></td>
                    <td>{formatCurrency(p.appliedToRent)}</td>
                    <td>{p.centavosAhorro > 0 ? formatCurrency(p.centavosAhorro) : <span className="amount-muted">-</span>}</td>
                    <td>{getInstallmentsTotalInPayment(p) > 0 ? `-${getInstallmentsTotalInPayment(p)}` : <span className="amount-muted">-</span>}</td>
                    <td>{p.paymentMethod}</td>
                    <td>
                      <button
                        type="button"
                        className="action-btn action-btn--edit"
                        title="Vista previa del recibo"
                        onClick={() => setHistoryPreviewPayment(p)}
                      >Ver</button>
                      <button
                        type="button"
                        className="action-btn action-btn--delete"
                        title={isDateClosed(p.dateApplied) ? "Caja cerrada: no se puede eliminar" : "Eliminar pago"}
                        disabled={isDateClosed(p.dateApplied)}
                        onClick={() => setDeleteTarget(p)}
                      >X</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
        {historyRows.length > 0 && (
          <p className="hint">Mostrando {historyRows.length} pagos filtrados.</p>
        )}
        </>
        )}
      </section>

      {historyPreviewPayment && (
        <div className="modal-overlay">
          <div className="modal payment-receipt-modal">
            <PaymentReceipt
              payment={historyPreviewPayment}
              onClose={() => setHistoryPreviewPayment(null)}
              closeLabel="Cerrar vista previa"
            />
          </div>
        </div>
      )}

      {reopenTargetDate && (
        <div className="modal-overlay">
          <div className="modal">
            <h3 className="modal-title">Reabrir caja</h3>
            <div className="modal-body">
              Vas a reabrir la caja de <strong>{reopenTargetDate}</strong>.<br /><br />
              Indica el motivo de reapertura:
              <div style={{ marginTop: 10 }}>
                <input
                  type="text"
                  className="payment-input"
                  placeholder="Ej. Correccion por pago omitido en corte"
                  value={reopenReason}
                  onChange={(e) => setReopenReason(e.target.value)}
                />
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="button ghost" onClick={() => setReopenTargetDate(null)}>Cancelar</button>
              <button type="button" className="button danger" onClick={handleConfirmReopen}>Confirmar reapertura</button>
            </div>
          </div>
        </div>
      )}

      {pendingClassifyTarget && (
        <div className="modal-overlay">
          <div className="modal">
            <h3 className="modal-title">Asignar cliente</h3>
            <div className="modal-body">
              <p style={{ marginBottom: 10 }}>
                <strong>Folio:</strong> {pendingClassifyTarget.folio}<br />
                <strong>Cuenta:</strong> {pendingClassifyTarget.accountNumber || "-"}<br />
                <strong>Grupo por regla:</strong> {pendingClassifyTarget.mappedGroup ? `Grupo ${pendingClassifyTarget.mappedGroup}` : "-"}<br />
                <strong>Monto:</strong> {formatCurrency(pendingClassifyTarget.amountReceived)}<br />
                <strong>Fecha:</strong> {pendingClassifyTarget.dateApplied}<br />
                <strong>Nombre del banco:</strong> {pendingClassifyTarget.extractedName || "-"}<br />
                <strong>Descripcion:</strong> <span style={{ wordBreak: "break-word" }}>{pendingClassifyTarget.description}</span>
              </p>
              <label className="payment-label">Buscar cliente</label>
              <input
                type="text"
                className="payment-input"
                placeholder="Unidad, nombre o cedula..."
                value={pendingClassifySearch}
                onChange={(e) => { setPendingClassifySearch(e.target.value); setPendingClassifyClientId(""); }}
                autoFocus
              />
              {pendingClassifySearch.trim() && (
                <div className="client-dropdown" style={{ position: "relative", maxHeight: 200, overflowY: "auto" }}>
                  {activeClients
                    .filter((c) => `${c.unitId} ${c.name} ${c.cedula ?? ""}`.toLowerCase().includes(pendingClassifySearch.trim().toLowerCase()))
                    .map((c) => (
                      <div
                        key={c.id}
                        className={`client-dropdown-item ${pendingClassifyClientId === c.id ? "client-dropdown-item--selected" : ""}`}
                        onMouseDown={() => { setPendingClassifyClientId(c.id); setPendingClassifySearch(`${c.unitId} - ${c.name}`); }}
                      >
                        <strong>{c.unitId}</strong> - {c.name}
                        {c.cedula && <span className="client-dropdown-cedula"> - {c.cedula}</span>}
                        <span className="client-dropdown-balance"> - {formatCurrency(c.balance)}</span>
                      </div>
                    ))}
                </div>
              )}
              {pendingClassifyClientId && (() => {
                const c = clients.find((cl) => cl.id === pendingClassifyClientId);
                if (!c) return null;
                const wholePart = roundMoney(pendingClassifyTarget.capitalPart);
                const centsPart = roundMoney(pendingClassifyTarget.centsPart);
                const classifyRetentionConfig = getConfiguredOtherChargesRetentionConfig(c, otherChargesRetentionByClient);
                const forcedRuleForClassifyClient = shouldForceRetentionToOtherCharges(
                  c,
                  otherChargesRetentionByClient,
                  payments,
                  pendingClassifyTarget.dateApplied
                );
                const forcedRuleActiveInClassify = forcedRuleForClassifyClient && !pendingManualOverrideForcedOtherCharges;
                const { totalOtherCharges, forcedRuleApplied } = computeEffectiveOtherChargesAllocation(
                  c,
                  pendingOtherChargesInput,
                  wholePart,
                  otherChargesRetentionByClient,
                  payments,
                  pendingClassifyTarget.dateApplied,
                  pendingManualOverrideForcedOtherCharges
                );
                const capitalForRent = roundMoney(Math.max(0, wholePart - totalOtherCharges));
                const applied = roundMoney(Math.min(capitalForRent, Math.max(0, c.balance)));
                const extras = roundMoney(Math.max(0, wholePart - applied - totalOtherCharges));
                const balanceAfterPreview = roundMoney(Math.max(0, c.balance - applied));
                const advanceLetterLabel = getAdvanceLetterLabel(c, extras);
                const previewReferenceDate = parseDateKey(pendingClassifyTarget.dateApplied) ?? startOfDay(new Date());
                const projectedClient: Client = {
                  ...c,
                  balance: balanceAfterPreview,
                  advanceBalance: roundMoney((c.advanceBalance ?? 0) + extras),
                  savings: roundMoney((c.savings ?? 0) + centsPart)
                };
                const projectedNextPayDate = findNextChargeDay(projectedClient, previewReferenceDate);
                return (
                  <>
                    {(c.otherCharges ?? []).length > 0 && (
                      <div className="other-charges-section" style={{ marginTop: 14 }}>
                        <div className="other-charges-title">Otros cargos de este cliente</div>
                        {forcedRuleForClassifyClient && (
                          <>
                            <p className="hint" style={{ marginTop: 4, marginBottom: 8 }}>
                              {forcedRuleActiveInClassify
                                ? `Regla automatica activa (${getRetentionCycleLabel(classifyRetentionConfig.cycle)}): monto base ${formatCurrency(classifyRetentionConfig.amount)}.`
                                : "Edicion manual activa para este pago: puedes definir otros cargos manualmente."}
                            </p>
                            <button
                              type="button"
                              className="button ghost small"
                              onClick={() => setPendingManualOverrideForcedOtherCharges((prev) => !prev)}
                            >
                              {forcedRuleActiveInClassify ? "Editar este pago" : "Volver a automatico"}
                            </button>
                          </>
                        )}
                        {(c.otherCharges ?? []).map((charge, index) => (
                          <div key={getOtherChargeKey(charge, index)} className="other-charges-row">
                            <label className="payment-label">{charge.label} <span className="amount-muted">(configurado: {formatCurrency(charge.amount)})</span></label>
                            {forcedRuleActiveInClassify ? (
                              <div className="payment-input" style={{ display: "flex", alignItems: "center" }}>
                                Aplicacion automatica
                              </div>
                            ) : (
                              <input
                                type="number"
                                className="payment-input"
                                min="0"
                                step="0.01"
                                placeholder="0.00"
                                value={pendingOtherChargesInput[getOtherChargeKey(charge, index)] ?? ""}
                                onChange={(e) => setPendingOtherChargesInput((prev) => ({ ...prev, [getOtherChargeKey(charge, index)]: e.target.value }))}
                              />
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="payment-preview" style={{ marginTop: 12 }}>
                      <div className="payment-preview-title">Vista previa</div>
                      <div className="payment-preview-body">
                        <div className="payment-preview-col">
                          <div className="payment-preview-row"><span>Saldo actual</span><strong className="amount-debt">{formatCurrency(c.balance)}</strong></div>
                          <div className="payment-preview-row"><span>Aplicado a renta</span><strong>{formatCurrency(applied)}</strong></div>
                          {totalOtherCharges > 0 && <div className="payment-preview-row"><span>{forcedRuleApplied ? "Otros cargos (regla automatica)" : "Otros cargos (manual)"}</span><strong className="amount-warning">{formatCurrency(totalOtherCharges)}</strong></div>}
                          {centsPart > 0 && <div className="payment-preview-row"><span>Ahorro (centavos)</span><strong>{formatCurrency(centsPart)}</strong></div>}
                          {extras > 0 && <div className="payment-preview-row"><span>Pago adelantado</span><strong>{formatCurrency(extras)}</strong></div>}
                          {advanceLetterLabel && <div className="payment-preview-row"><span>Adelanto aplica a</span><strong>{advanceLetterLabel}</strong></div>}
                        </div>
                        <div className="payment-preview-col">
                          <div className="payment-preview-row"><span>Nuevo saldo</span><strong className={balanceAfterPreview <= 0 ? "amount-good" : "amount-debt"}>{formatCurrency(balanceAfterPreview)}</strong></div>
                          {projectedNextPayDate && <div className="payment-preview-row"><span>Prox. fecha de pago</span><strong>{formatDate(projectedNextPayDate)}</strong></div>}
                        </div>
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="button ghost"
                onClick={() => {
                  setPendingClassifyTarget(null);
                  setPendingManualOverrideForcedOtherCharges(false);
                }}
              >
                Cancelar
              </button>
              <button type="button" className="button primary" disabled={!pendingClassifyClientId} onClick={handleConfirmClassify}>
                Confirmar y registrar pago
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="modal-overlay">
          <div className="modal">
            <h3 className="modal-title">Eliminar pago</h3>
            <p className="modal-body">
              Confirmas que deseas eliminar el recibo <strong>{deleteTarget.receiptNumber}</strong> de{" "}
              <strong>{deleteTarget.clientName}</strong> por{" "}
              <strong>{formatCurrency(deleteTarget.amountReceived)}</strong>?<br /><br />
              El saldo del cliente sera revertido automaticamente.
              {isDateClosed(deleteTarget.dateApplied) && (
                <>
                  <br /><br />
                  Esta fecha tiene caja cerrada. Debes gestionar un ajuste, no eliminar el pago.
                </>
              )}
            </p>
            <div className="modal-actions">
              <button type="button" className="button ghost" onClick={() => setDeleteTarget(null)}>Cancelar</button>
              <button
                type="button"
                className="button danger"
                disabled={isDateClosed(deleteTarget.dateApplied)}
                onClick={() => handleDeletePayment(deleteTarget)}
              >
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


