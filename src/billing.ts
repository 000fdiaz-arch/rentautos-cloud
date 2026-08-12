import type { Client, WeeklyChargeDay } from "./types";

export const BUSINESS_TIME_ZONE = "America/Panama";

export function getBusinessDateKey(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseDateKey(value: string): Date | null {
  const parts = value.split("-");
  if (parts.length !== 3) return null;

  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;

  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function getAdjustedMonthlyChargeDate(year: number, monthIndex: number, monthlyChargeDay: number): Date {
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  const day = Math.min(monthlyChargeDay, lastDay);
  const adjusted = new Date(year, monthIndex, day);
  if (adjusted.getDay() === 0) adjusted.setDate(adjusted.getDate() + 1);
  return adjusted;
}

function hasFirstSundayAlreadyCounted(client: Client): boolean {
  return !!client.firstSundayChargedAt || (client.installmentsPaid ?? 0) > 7;
}

export function isChargeDay(client: Client, date: Date): boolean {
  const weekDay = date.getDay();
  if (client.frequency === "daily") {
    if (weekDay >= 1 && weekDay <= 6) return true;
    if (weekDay === 0) return !!client.chargeFirstSunday && !hasFirstSundayAlreadyCounted(client);
    return false;
  }

  if (client.frequency === "weekly") {
    const dayMap: Record<WeeklyChargeDay, number> = {
      monday: 1,
      tuesday: 2,
      wednesday: 3,
      thursday: 4,
      friday: 5,
      saturday: 6
    };
    return weekDay === dayMap[client.weeklyChargeDay ?? "monday"];
  }

  if (client.frequency === "biweekly") {
    const day = date.getDate();
    const month = date.getMonth();
    if (day === 15) return true;
    if (month === 1) {
      const lastDay = new Date(date.getFullYear(), month + 1, 0).getDate();
      return day === lastDay;
    }
    return day === 30;
  }

  const monthlyChargeDay = client.monthlyChargeDay ?? 1;
  const adjusted = getAdjustedMonthlyChargeDate(date.getFullYear(), date.getMonth(), monthlyChargeDay);
  return adjusted.getDate() === date.getDate();
}

export function isBeforeFirstChargeDate(client: Client, date: Date): boolean {
  const firstChargeDate = client.firstChargeDate ? parseDateKey(client.firstChargeDate) : null;
  return firstChargeDate !== null && startOfDay(date) < startOfDay(firstChargeDate);
}

export type InstallmentIssuance = {
  issued: number;
  needsReview: boolean;
};

/**
 * Resolves the immutable issuance counter used to cap contractual rent charges.
 * The financial estimate uses paid installments plus installments represented by
 * the outstanding rent balance. It never reduces a counter already persisted.
 */
export function resolveInstallmentIssuance(client: Client): InstallmentIssuance {
  const agreed = Math.max(0, Math.floor(client.installmentsAgreed ?? 0));
  const paid = Math.max(0, Math.floor(client.installmentsPaid ?? 0));
  const debtCycles = client.rentAmount > 0
    ? Math.ceil(Math.max(0, client.balance) / client.rentAmount)
    : 0;
  const persisted = Number.isFinite(client.installmentsIssued)
    ? Math.max(0, Math.floor(client.installmentsIssued ?? 0))
    : 0;
  const issued = Math.max(persisted, paid + debtCycles);
  return {
    issued,
    needsReview: client.installmentsIssuedEstimateNeedsReview === true || issued > agreed
  };
}

export function withResolvedInstallmentIssuance(client: Client): Client {
  const issuance = resolveInstallmentIssuance(client);
  if (
    client.installmentsIssued === issuance.issued &&
    client.installmentsIssuedEstimateNeedsReview === issuance.needsReview
  ) return client;
  return {
    ...client,
    installmentsIssued: issuance.issued,
    installmentsIssuedEstimateNeedsReview: issuance.needsReview
  };
}

export function applyAutomaticCharges(currentClients: Client[], now: Date): { clients: Client[]; changed: boolean } {
  const today = startOfDay(now);
  const todayKey = toDateKey(today);
  let changed = false;

  const next = currentClients.map((client) => {
    const issuance = resolveInstallmentIssuance(client);
    const issuanceWasNormalized =
      client.installmentsIssued !== issuance.issued ||
      client.installmentsIssuedEstimateNeedsReview !== issuance.needsReview;
    const clientWithIssuance: Client = {
      ...client,
      installmentsIssued: issuance.issued,
      installmentsIssuedEstimateNeedsReview: issuance.needsReview
    };
    client = clientWithIssuance;
    if (issuanceWasNormalized) changed = true;
    if (
      client.archivedAt ||
      client.status === "archivado" ||
      client.status === "taller" ||
      client.status === "chapisteria" ||
      client.status === "custodia"
    ) {
      return client;
    }
    const firstChargeDate = client.firstChargeDate ? parseDateKey(client.firstChargeDate) : null;
    if (firstChargeDate && firstChargeDate > today) {
      const targetLastCharge = toDateKey(addDays(firstChargeDate, -1));
      if (client.lastChargeDate === targetLastCharge) return client;
      changed = true;
      return { ...client, lastChargeDate: targetLastCharge };
    }

    let lastChargeDate = client.lastChargeDate ? parseDateKey(client.lastChargeDate) : null;
    if (lastChargeDate === null) {
      const createdAt = new Date(client.createdAt);
      lastChargeDate = Number.isNaN(createdAt.getTime()) ? today : startOfDay(createdAt);
      if (lastChargeDate > today) lastChargeDate = today;
      changed = true;
    }

    if (lastChargeDate >= today) {
      const lastKnown = toDateKey(lastChargeDate);
      if (client.lastChargeDate === lastKnown) return client;
      changed = true;
      return { ...client, lastChargeDate: lastKnown };
    }

    let pendingCharges = 0;
    let firstSundayChargedAt = client.firstSundayChargedAt;
    if (client.frequency === "daily") {
      let sundayAlreadyCounted = hasFirstSundayAlreadyCounted(client);
      for (let cursor = addDays(lastChargeDate, 1); cursor <= today; cursor = addDays(cursor, 1)) {
        const day = cursor.getDay();
        if (day >= 1 && day <= 6) {
          pendingCharges += 1;
          continue;
        }
        if (day === 0 && client.chargeFirstSunday && !sundayAlreadyCounted) {
          pendingCharges += 1;
          sundayAlreadyCounted = true;
          firstSundayChargedAt = toDateKey(cursor);
        }
      }
    } else {
      for (let cursor = addDays(lastChargeDate, 1); cursor <= today; cursor = addDays(cursor, 1)) {
        if (isChargeDay(client, cursor)) pendingCharges += 1;
      }
    }

    changed = true;
    const remainingIssuable = Math.max(0, Math.floor(client.installmentsAgreed) - issuance.issued);
    pendingCharges = Math.min(pendingCharges, remainingIssuable);
    if (pendingCharges === 0) return { ...client, lastChargeDate: todayKey };

    const chargeTotal = roundMoney(client.rentAmount * pendingCharges);
    const currentAdvance = roundMoney(client.advanceBalance ?? 0);
    const consumedAdvance = roundMoney(Math.min(currentAdvance, chargeTotal));
    const remainingCharge = roundMoney(Math.max(0, chargeTotal - consumedAdvance));

    return {
      ...client,
      balance: roundMoney(client.balance + remainingCharge),
      advanceBalance: roundMoney(Math.max(0, currentAdvance - consumedAdvance)),
      installmentsIssued: issuance.issued + pendingCharges,
      firstSundayChargedAt,
      lastChargeDate: todayKey
    };
  });

  return { clients: next, changed };
}

export function findNextChargeDay(client: Client, fromDate: Date): Date | null {
  const issuance = resolveInstallmentIssuance(client);
  const agreed = Math.max(0, Math.floor(client.installmentsAgreed));
  if (issuance.issued >= agreed) return null;
  const coveredCharges = Number.isFinite(client.advanceBalance) && client.rentAmount > 0
    ? Math.floor((client.advanceBalance ?? 0) / client.rentAmount)
    : 0;
  if (issuance.issued + coveredCharges >= agreed) return null;
  let remainingSkips = Math.max(0, coveredCharges);
  const firstChargeDate = client.firstChargeDate ? parseDateKey(client.firstChargeDate) : null;
  const searchStart = firstChargeDate && firstChargeDate > startOfDay(fromDate)
    ? addDays(firstChargeDate, -1)
    : startOfDay(fromDate);
  let cursor = addDays(searchStart, 1);
  for (let i = 0; i < 36600; i += 1) {
    if (isChargeDay(client, cursor)) {
      if (remainingSkips > 0) {
        remainingSkips -= 1;
      } else {
        return cursor;
      }
    }
    cursor = addDays(cursor, 1);
  }
  return null;
}

export function getPendingInstallments(client: Client): number {
  if (!Number.isFinite(client.rentAmount) || client.rentAmount <= 0) return 0;
  if (client.balance <= 0) return 0;
  return Math.max(0, Math.ceil(client.balance / client.rentAmount));
}

export function getDebtStartDate(client: Client, referenceDate: Date): Date | null {
  const pending = getPendingInstallments(client);
  if (pending === 0) return null;

  let remaining = pending;
  let cursor = startOfDay(referenceDate);
  for (let i = 0; i < 36600; i += 1) {
    if (isChargeDay(client, cursor)) {
      remaining -= 1;
      if (remaining === 0) return cursor;
    }
    cursor = addDays(cursor, -1);
  }
  return null;
}
