import type { Client, WeeklyChargeDay } from "./types";

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

export function isChargeDay(client: Client, date: Date): boolean {
  const weekDay = date.getDay();
  if (client.frequency === "daily") return weekDay >= 1 && weekDay <= 6;

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

export function applyAutomaticCharges(currentClients: Client[], now: Date): { clients: Client[]; changed: boolean } {
  const today = startOfDay(now);
  const todayKey = toDateKey(today);
  let changed = false;

  const next = currentClients.map((client) => {
    if (client.archivedAt || client.status === "inactive") return client;

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
    for (let cursor = addDays(lastChargeDate, 1); cursor <= today; cursor = addDays(cursor, 1)) {
      if (isChargeDay(client, cursor)) pendingCharges += 1;
    }

    changed = true;
    if (pendingCharges === 0) return { ...client, lastChargeDate: todayKey };

    return {
      ...client,
      balance: roundMoney(client.balance + roundMoney(client.rentAmount * pendingCharges)),
      lastChargeDate: todayKey
    };
  });

  return { clients: next, changed };
}

export function findNextChargeDay(client: Client, fromDate: Date): Date | null {
  let cursor = addDays(startOfDay(fromDate), 1);
  for (let i = 0; i < 36600; i += 1) {
    if (isChargeDay(client, cursor)) return cursor;
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
