import type { Client } from "./types";

const CLIENTS_KEY = "cobrapp.module1.clients.v1";

const WEEKLY_DAYS = new Set([
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday"
]);

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
    typeof raw.rentAmount === "number" &&
    typeof raw.balance === "number" &&
    typeof raw.createdAt === "string";

  if (!base) {
    return null;
  }

  const normalized: Client = {
    id: raw.id,
    unitId:
      typeof raw.unitId === "string" && raw.unitId.trim()
        ? raw.unitId
        : `LEG-${raw.id.slice(0, 6)}`,
    name: raw.name,
    rentAmount: raw.rentAmount,
    frequency,
    balance: raw.balance,
    installmentsAgreed: Number(raw.installmentsAgreed) || 0,
    installmentsRemaining: Number(raw.installmentsRemaining) || 0,
    installmentsPaid: Number(raw.installmentsPaid) || 0,
    otherChargeLabel:
      typeof raw.otherChargeLabel === "string" && raw.otherChargeLabel.trim()
        ? raw.otherChargeLabel
        : undefined,
    otherChargeAmount:
      Number.isFinite(Number(raw.otherChargeAmount)) && Number(raw.otherChargeAmount) !== 0
        ? Number(raw.otherChargeAmount)
        : undefined,
    createdAt: raw.createdAt
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
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown[];
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((item) => normalizeClient(item))
      .filter((item): item is Client => item !== null);
  } catch {
    return [];
  }
}

export function saveClients(clients: Client[]): void {
  localStorage.setItem(CLIENTS_KEY, JSON.stringify(clients));
}
