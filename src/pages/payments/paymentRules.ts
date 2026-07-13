import { findNextChargeDay, isChargeDay, parseDateKey, startOfDay, toDateKey } from "../../billing";
import type {
  BillingFrequency,
  Client,
  OtherCharge,
  OtherChargesRetentionByClient,
  OtherChargesRetentionCycle,
  Payment
} from "../../types";
import type {
  CollectionStatus,
  CollectionStatusRecord,
  ManualPaymentAllocation
} from "./paymentTypes";

export function getNextDateKey(dateKey: string): string {
  const parsed = parseDateKey(dateKey);
  if (!parsed) return dateKey;
  const next = new Date(parsed);
  next.setDate(next.getDate() + 1);
  return toDateKey(next);
}

export function buildTemporaryCardFolio(dateKey: string): string {
  const compactDate = dateKey.replace(/-/g, "");
  const token = String(Date.now()).slice(-6);
  return `TMP-${compactDate}-${token}`;
}


export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function getInstallmentsFromAdvance(payment: Pick<Payment, "installmentsFromAdvance" | "advanceApplied" | "rentAmount">): number {
  if (typeof payment.installmentsFromAdvance === "number" && Number.isInteger(payment.installmentsFromAdvance) && payment.installmentsFromAdvance >= 0) {
    return payment.installmentsFromAdvance;
  }
  if (payment.rentAmount > 0 && (payment.advanceApplied ?? 0) > 0) {
    return Math.floor((payment.advanceApplied ?? 0) / payment.rentAmount);
  }
  return 0;
}

export function getInstallmentsTotalInPayment(payment: Pick<Payment, "installmentsTotalInPayment" | "installmentsFromDebt" | "installmentsDeducted" | "installmentsFromAdvance" | "advanceApplied" | "rentAmount">): number {
  if (typeof payment.installmentsTotalInPayment === "number" && Number.isInteger(payment.installmentsTotalInPayment) && payment.installmentsTotalInPayment >= 0) {
    return payment.installmentsTotalInPayment;
  }
  const fromDebt = typeof payment.installmentsFromDebt === "number"
    ? payment.installmentsFromDebt
    : Math.max(0, payment.installmentsDeducted ?? 0);
  return Math.max(0, fromDebt + getInstallmentsFromAdvance(payment));
}

export function computeCoveredInstallmentsFromAdvance(advanceBefore: number, advanceAfter: number, rentAmount: number): number {
  const normalizedRent = roundMoney(Math.max(0, rentAmount));
  if (!Number.isFinite(normalizedRent) || normalizedRent <= 0) return 0;
  const coveredBefore = Math.floor(roundMoney(Math.max(0, advanceBefore)) / normalizedRent);
  const coveredAfter = Math.floor(roundMoney(Math.max(0, advanceAfter)) / normalizedRent);
  return Math.max(0, coveredAfter - coveredBefore);
}

export function getAdvanceLetterLabel(client: Client, advanceAdded: number): string | null {
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

export function toInputMoney(value: number): string {
  const normalized = roundMoney(value);
  return Number.isInteger(normalized) ? String(normalized) : normalized.toFixed(2);
}

export function getMonthEndDate(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

export function computeRequiredWholeAmountToReachDate(client: Client, fromDate: Date, targetDate: Date): { requiredWholeAmount: number; resultingNextDate: Date | null } {
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

export function splitWholeAndCents(amount: number): { wholePart: number; centsPart: number } {
  const normalized = roundMoney(Math.max(0, amount));
  const wholePart = Math.floor(normalized + Number.EPSILON);
  const centsPart = roundMoney(normalized - wholePart);
  return { wholePart, centsPart };
}


export function resolveCollectionStatusForClosure(
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


export const DEFAULT_OTHER_CHARGES_RETENTION = 5;

export function getConfiguredOtherChargesRetentionConfig(
  client: Client,
  retentionByClient: OtherChargesRetentionByClient
): { amount: number; cycle: OtherChargesRetentionCycle } {
  const configured = retentionByClient[client.id];
  const amount = Number.isFinite(configured?.amount) ? roundMoney(Math.max(0, configured.amount)) : DEFAULT_OTHER_CHARGES_RETENTION;
  const cycle = configured?.cycle ?? client.frequency;
  return { amount, cycle };
}

export function getRetentionCycleLabel(cycle: OtherChargesRetentionCycle): string {
  if (cycle === "daily") return "Diario";
  if (cycle === "weekly") return "Semanal";
  if (cycle === "biweekly") return "Quincenal";
  if (cycle === "monthly") return "Mensual";
  return "Cuando paga";
}

export function getLastPaymentDateKey(clientId: string, payments: Payment[], beforeOrOnDateKey: string): string | null {
  const last = payments
    .filter((payment) => payment.clientId === clientId && payment.dateApplied <= beforeOrOnDateKey)
    .sort((a, b) => b.dateApplied.localeCompare(a.dateApplied))[0];
  return last?.dateApplied ?? null;
}

export function getRetentionCycleClient(client: Client, cycle: OtherChargesRetentionCycle): Client {
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

export function countRetentionEventsInRange(
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

export function computeConfiguredRetentionForPayment(
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

export function shouldForceRetentionToOtherCharges(
  client: Client,
  retentionByClient: OtherChargesRetentionByClient,
  payments: Payment[],
  paymentDateKey: string
): boolean {
  const hasPendingOtherCharges = (client.otherCharges ?? []).some((charge) => roundMoney(charge.amount) > 0);
  if (!hasPendingOtherCharges) return false;
  return computeConfiguredRetentionForPayment(client, retentionByClient, payments, paymentDateKey) > 0;
}

export function getOtherChargeKey(charge: Pick<OtherCharge, "id" | "label">, fallbackIndex = 0): string {
  if (charge.id && charge.id.trim()) return `id:${charge.id.trim()}`;
  return `legacy:${charge.label.trim().toUpperCase()}:${fallbackIndex}`;
}

export function distributeAcrossOtherCharges(configured: OtherCharge[] | undefined, amount: number): OtherCharge[] {
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

export function computeAppliedOtherCharges(
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

export function computeEffectiveOtherChargesAllocation(
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


export function computeManualPaymentAllocation(
  client: Client,
  rawAmount: number,
  manualOtherChargesInput: Record<string, string>,
  retentionByClient: OtherChargesRetentionByClient,
  payments: Payment[],
  paymentDateKey: string,
  allowManualOverrideForForcedRule = false
): ManualPaymentAllocation {
  const projectedClient = client;
  const amount = roundMoney(Math.max(0, rawAmount));
  const { wholePart, centsPart } = splitWholeAndCents(amount);
  const balanceBefore = roundMoney(projectedClient.balance);

  const { otherChargesApplied, totalOtherCharges, forcedRuleApplied } = computeEffectiveOtherChargesAllocation(
    projectedClient,
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
  const rentAmount = projectedClient.rentAmount;
  const advanceBefore = roundMoney(Math.max(0, projectedClient.advanceBalance ?? 0));
  const advanceAfter = roundMoney(advanceBefore + advanceApplied);
  const pendingBefore = rentAmount > 0 ? Math.ceil(balanceBefore / rentAmount) : 0;
  const pendingAfter = rentAmount > 0 && balanceAfter > 0 ? Math.ceil(balanceAfter / rentAmount) : 0;
  const installmentsDeducted = Math.max(0, pendingBefore - pendingAfter);
  const installmentsCoveredByAdvance = computeCoveredInstallmentsFromAdvance(advanceBefore, advanceAfter, rentAmount);
  const installmentsTotalInPayment = installmentsDeducted + installmentsCoveredByAdvance;

  return {
    projectedClient,
    balanceBefore,
    appliedToRent,
    centavosAhorro,
    advanceBefore,
    advanceApplied,
    advanceAfter,
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

export function findDebtStartDateForClientBalance(client: Client, balance: number, referenceDate: Date): Date | null {
  if (!Number.isFinite(client.rentAmount) || client.rentAmount <= 0) return null;
  const pending = Math.max(0, Math.ceil(Math.max(0, balance) / client.rentAmount));
  if (pending === 0) return null;

  let remaining = pending;
  let cursor = startOfDay(referenceDate);
  for (let i = 0; i < 36600; i += 1) {
    if (isChargeDay(client, cursor)) {
      remaining -= 1;
      if (remaining === 0) return cursor;
    }
    const previous = new Date(cursor);
    previous.setDate(previous.getDate() - 1);
    cursor = previous;
  }
  return null;
}

export function collectClientChargeDatesFrom(startDate: Date | null, count: number, client: Client): Date[] {
  if (!startDate || count <= 0) return [];
  const dates: Date[] = [];
  let cursor = startOfDay(startDate);
  for (let i = 0; i < 36600 && dates.length < count; i += 1) {
    if (isChargeDay(client, cursor)) {
      dates.push(new Date(cursor));
    }
    const next = new Date(cursor);
    next.setDate(next.getDate() + 1);
    cursor = next;
  }
  return dates;
}

export function findFirstSundayCoveredByManualPayment(
  client: Client,
  allocation: Pick<ManualPaymentAllocation, "installmentsTotalInPayment" | "projectedClient"> &
    Partial<Pick<ManualPaymentAllocation, "balanceBefore" | "appliedToRent" | "advanceBefore" | "advanceAfter" | "advanceApplied">>,
  paymentDateKey: string
): string | undefined {
  if (allocation.projectedClient.firstSundayChargedAt) return allocation.projectedClient.firstSundayChargedAt;
  if (client.frequency !== "daily") return allocation.projectedClient.firstSundayChargedAt;
  if ((client.installmentsPaid ?? 0) > 7) return allocation.projectedClient.firstSundayChargedAt;

  const paymentDate = parseDateKey(paymentDateKey);
  if (!paymentDate || !Number.isFinite(client.rentAmount) || client.rentAmount <= 0) {
    return allocation.projectedClient.firstSundayChargedAt;
  }

  const sundayAwareClient: Client = { ...client, chargeFirstSunday: true };
  const balanceBefore = roundMoney(Math.max(0, allocation.balanceBefore ?? client.balance));
  const appliedToRent = roundMoney(Math.max(0, allocation.appliedToRent ?? 0));
  if (appliedToRent > 0) {
    const pendingBefore = Math.ceil((balanceBefore + Number.EPSILON) / client.rentAmount);
    const debtStart = findDebtStartDateForClientBalance(sundayAwareClient, balanceBefore, paymentDate);
    const debtDates = collectClientChargeDatesFrom(debtStart, pendingBefore, sundayAwareClient);
    const oldestPartial = roundMoney(balanceBefore % client.rentAmount);
    let remainingApplied = appliedToRent;

    for (let index = 0; index < debtDates.length && remainingApplied > 0; index += 1) {
      const date = debtDates[index];
      if (!date) continue;
      const owedForCycle = index === 0 && oldestPartial > 0 ? oldestPartial : client.rentAmount;
      const amountForCycle = roundMoney(Math.min(owedForCycle, remainingApplied));
      if (amountForCycle > 0 && date.getDay() === 0) return toDateKey(date);
      remainingApplied = roundMoney(remainingApplied - amountForCycle);
    }
  }

  const advanceApplied = roundMoney(
    Math.max(0, allocation.advanceApplied ?? roundMoney((allocation.advanceAfter ?? 0) - (allocation.advanceBefore ?? 0)))
  );
  if (advanceApplied > 0) {
    const clientWithoutAdvance: Client = { ...sundayAwareClient, advanceBalance: 0 };
    let nextAdvanceDate = findNextChargeDay(clientWithoutAdvance, paymentDate);
    let remainingAdvance = advanceApplied;
    for (let i = 0; i < 36600 && remainingAdvance > 0 && nextAdvanceDate; i += 1) {
      const amountForCycle = roundMoney(Math.min(client.rentAmount, remainingAdvance));
      if (amountForCycle > 0 && nextAdvanceDate.getDay() === 0) return toDateKey(nextAdvanceDate);
      remainingAdvance = roundMoney(remainingAdvance - amountForCycle);
      const cursor = new Date(nextAdvanceDate);
      nextAdvanceDate = findNextChargeDay(clientWithoutAdvance, cursor);
    }
  }

  return allocation.projectedClient.firstSundayChargedAt;
}

export function resolveFirstSundayChargedAtForManualPayment(
  client: Client,
  allocation: Pick<ManualPaymentAllocation, "installmentsTotalInPayment" | "projectedClient"> &
    Partial<Pick<ManualPaymentAllocation, "balanceBefore" | "appliedToRent" | "advanceBefore" | "advanceAfter" | "advanceApplied">>,
  paymentDateKey: string
): string | undefined {
  if (allocation.projectedClient.firstSundayChargedAt) return allocation.projectedClient.firstSundayChargedAt;
  const hasRentMovement = roundMoney(Math.max(0, allocation.appliedToRent ?? 0)) > 0 ||
    roundMoney(Math.max(0, allocation.advanceApplied ?? roundMoney((allocation.advanceAfter ?? 0) - (allocation.advanceBefore ?? 0)))) > 0;
  if (allocation.installmentsTotalInPayment <= 0 && !hasRentMovement) return allocation.projectedClient.firstSundayChargedAt;
  if (client.frequency !== "daily" || !client.chargeFirstSunday) return allocation.projectedClient.firstSundayChargedAt;

  const coveredFirstSunday = findFirstSundayCoveredByManualPayment(client, allocation, paymentDateKey);
  if (coveredFirstSunday) return coveredFirstSunday;

  const paymentDate = parseDateKey(paymentDateKey);
  if (!paymentDate || paymentDate.getDay() !== 0) return allocation.projectedClient.firstSundayChargedAt;
  return isChargeDay(client, paymentDate) ? paymentDateKey : allocation.projectedClient.firstSundayChargedAt;
}

export function computeOtherChargesDueAfter(configured: OtherCharge[] | undefined, applied: OtherCharge[] | undefined): OtherCharge[] | undefined {
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

export function restoreOtherChargesAfterDelete(current: OtherCharge[] | undefined, applied: OtherCharge[] | undefined): OtherCharge[] {
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
