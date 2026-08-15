import { isBeforeFirstChargeDate, isChargeDay, parseDateKey } from "./billing";
import type { Client, LateFeeLedgerEntry, LateFeeSettings, OtherCharge, Payment } from "./types";

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function normalizeUnitId(value: string): string {
  return value.trim().toUpperCase();
}

export function upsertOtherCharge(existing: OtherCharge[] | undefined, label: string, amountToAdd: number): OtherCharge[] {
  const normalizedAmount = roundMoney(Math.max(0, amountToAdd));
  const normalizedLabel = label.trim();
  const current = [...(existing ?? [])];
  if (!normalizedLabel || normalizedAmount <= 0) return current;
  const index = current.findIndex((charge) => charge.label.trim().toUpperCase() === normalizedLabel.toUpperCase());
  if (index >= 0) {
    const previous = roundMoney(Math.max(0, current[index]?.amount ?? 0));
    current[index] = { ...current[index], label: normalizedLabel, amount: roundMoney(previous + normalizedAmount) };
    return current;
  }
  return [...current, { id: crypto.randomUUID(), label: normalizedLabel, amount: normalizedAmount }];
}

export function subtractOtherCharge(existing: OtherCharge[] | undefined, label: string, amountToSubtract: number): OtherCharge[] {
  const normalizedAmount = roundMoney(Math.max(0, amountToSubtract));
  const normalizedLabel = label.trim().toUpperCase();
  if (normalizedAmount <= 0 || !normalizedLabel) return [...(existing ?? [])];
  let remaining = normalizedAmount;
  const next: OtherCharge[] = [];
  for (const charge of existing ?? []) {
    if (charge.label.trim().toUpperCase() !== normalizedLabel) {
      next.push(charge);
      continue;
    }
    const available = roundMoney(Math.max(0, charge.amount));
    const deducted = roundMoney(Math.min(available, remaining));
    remaining = roundMoney(Math.max(0, remaining - deducted));
    const balance = roundMoney(Math.max(0, available - deducted));
    if (balance > 0) next.push({ ...charge, amount: balance });
  }
  return next;
}

function getScheduledLateFeeLookbackDays(client: Client): number {
  if (client.frequency === "weekly") return 7;
  if (client.frequency === "biweekly") return 20;
  if (client.frequency === "monthly") return 62;
  return 0;
}

function findLastScheduledDueDate(client: Client, date: Date): Date | null {
  const lookbackDays = getScheduledLateFeeLookbackDays(client);
  if (lookbackDays <= 0) return null;
  const startOffset = isChargeDay(client, date) ? 1 : 0;
  for (let i = startOffset; i <= lookbackDays; i += 1) {
    const candidate = new Date(date);
    candidate.setDate(candidate.getDate() - i);
    if (isChargeDay(client, candidate)) return candidate;
  }
  return null;
}

export type LateFeeApplyResult = {
  clients: Client[];
  newEntries: LateFeeLedgerEntry[];
  lateFeeClients: number;
  lateFeeTotal: number;
};

type LateFeeApplyParams = {
  clients: Client[];
  payments: Payment[];
  lateFeeLedger: LateFeeLedgerEntry[];
  lateFeeSettings: LateFeeSettings;
  closingDateKey: string;
};

export function applyLateFeesForClosingDate({
  clients,
  payments,
  lateFeeLedger,
  lateFeeSettings,
  closingDateKey
}: LateFeeApplyParams): LateFeeApplyResult {
  const closingDate = parseDateKey(closingDateKey);
  if (!closingDate) {
    return { clients, newEntries: [], lateFeeClients: 0, lateFeeTotal: 0 };
  }

  const selectedUnits = new Set((lateFeeSettings.selectedUnits ?? []).map((unit) => normalizeUnitId(unit)));
  const lateFeeEnabled = lateFeeSettings.active && selectedUnits.size > 0 && lateFeeSettings.dailyAmount > 0;
  const lateFeeAmount = roundMoney(Math.max(0, lateFeeSettings.dailyAmount));
  const lateFeeLabel = lateFeeSettings.chargeLabel?.trim() || "RECARGO POR TARDANZA DE PAGO";
  if (!lateFeeEnabled || lateFeeAmount <= 0) {
    return { clients, newEntries: [], lateFeeClients: 0, lateFeeTotal: 0 };
  }

  const paymentsOfClosingDate = payments.filter((payment) => payment.dateApplied === closingDateKey);
  const rentAppliedByClient = new Map<string, number>();
  const paymentCountByClient = new Map<string, number>();
  for (const payment of paymentsOfClosingDate) {
    const currentRentApplied = rentAppliedByClient.get(payment.clientId) ?? 0;
    rentAppliedByClient.set(payment.clientId, roundMoney(currentRentApplied + roundMoney(Math.max(0, payment.appliedToRent))));
    const currentCount = paymentCountByClient.get(payment.clientId) ?? 0;
    paymentCountByClient.set(payment.clientId, currentCount + 1);
  }

  const existingLateFeeKeys = new Set(
    lateFeeLedger
      .filter((entry) => entry.date === closingDateKey)
      .map((entry) => `${entry.clientId}|${entry.date}|${entry.reason}`)
  );

  let lateFeeClients = 0;
  let lateFeeTotal = 0;
  const newEntries: LateFeeLedgerEntry[] = [];
  const nextClients = clients.map((client) => {
    if (
      client.activeProvisionalRental ||
      client.archivedAt ||
      client.status === "archivado" ||
      client.status === "taller" ||
      client.status === "chapisteria" ||
      client.status === "custodia"
    ) {
      return client;
    }
    if (!selectedUnits.has(normalizeUnitId(client.unitId))) return client;
    if (isBeforeFirstChargeDate(client, closingDate)) return client;

    let reason: LateFeeLedgerEntry["reason"] | null = null;
    if (client.frequency === "daily") {
      const paymentsToday = paymentCountByClient.get(client.id) ?? 0;
      if (isChargeDay(client, closingDate) && paymentsToday === 0) reason = "DAILY_MISSED_PROOF";
    } else if (client.frequency === "weekly" || client.frequency === "biweekly" || client.frequency === "monthly") {
      const dueDate = findLastScheduledDueDate(client, closingDate);
      const appliedToRentToday = rentAppliedByClient.get(client.id) ?? 0;
      const balanceAtStartOfDay = roundMoney(client.balance + appliedToRentToday);
      const isNewCycleDay = isChargeDay(client, closingDate);
      const currentCycleThreshold = isNewCycleDay ? roundMoney(Math.max(0, client.rentAmount)) : 0;
      if (dueDate && closingDate > dueDate && balanceAtStartOfDay > currentCycleThreshold) {
        reason = client.frequency === "weekly" ? "WEEKLY_LATE_DAY" : "SCHEDULED_LATE_DAY";
      }
    }

    if (!reason) return client;
    const lateFeeKey = `${client.id}|${closingDateKey}|${reason}`;
    if (existingLateFeeKeys.has(lateFeeKey)) return client;

    const entry: LateFeeLedgerEntry = {
      id: crypto.randomUUID(),
      clientId: client.id,
      unitId: client.unitId,
      date: closingDateKey,
      amount: lateFeeAmount,
      reason,
      chargeLabel: lateFeeLabel,
      createdAt: new Date().toISOString()
    };
    newEntries.push(entry);
    existingLateFeeKeys.add(lateFeeKey);
    lateFeeClients += 1;
    lateFeeTotal = roundMoney(lateFeeTotal + lateFeeAmount);
    return {
      ...client,
      otherCharges: upsertOtherCharge(client.otherCharges, lateFeeLabel, lateFeeAmount)
    };
  });

  return {
    clients: nextClients,
    newEntries,
    lateFeeClients,
    lateFeeTotal
  };
}
