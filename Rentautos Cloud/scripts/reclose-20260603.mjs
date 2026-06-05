import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

function loadDotEnv(envPath = ".env") {
  if (!fs.existsSync(envPath)) return {};
  const out = {};
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim();
    out[key] = val;
  }
  return out;
}

function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateKey(value) {
  const parts = String(value ?? "").split("-");
  if (parts.length !== 3) return null;
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function hasFirstSundayAlreadyCounted(client) {
  return !!client.firstSundayChargedAt || (client.installmentsPaid ?? 0) > 7;
}

function getAdjustedMonthlyChargeDate(year, monthIndex, monthlyChargeDay) {
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  const day = Math.min(monthlyChargeDay, lastDay);
  const adjusted = new Date(year, monthIndex, day);
  if (adjusted.getDay() === 0) adjusted.setDate(adjusted.getDate() + 1);
  return adjusted;
}

function isChargeDay(client, date) {
  const weekDay = date.getDay();
  if (client.frequency === "daily") {
    if (weekDay >= 1 && weekDay <= 6) return true;
    if (weekDay === 0) return !!client.chargeFirstSunday && !hasFirstSundayAlreadyCounted(client);
    return false;
  }
  if (client.frequency === "weekly") {
    const dayMap = { monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
    return weekDay === (dayMap[client.weeklyChargeDay ?? "monday"] ?? 1);
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

function normalizeUnitId(value) {
  return String(value ?? "").trim().toUpperCase();
}

function upsertOtherCharge(existing, label, amountToAdd) {
  const normalizedAmount = roundMoney(Math.max(0, amountToAdd));
  const normalizedLabel = String(label ?? "").trim();
  const current = [...(existing ?? [])];
  if (!normalizedLabel || normalizedAmount <= 0) return current;
  const index = current.findIndex((charge) => String(charge.label ?? "").trim().toUpperCase() === normalizedLabel.toUpperCase());
  if (index >= 0) {
    const previous = roundMoney(Math.max(0, current[index]?.amount ?? 0));
    current[index] = { ...current[index], label: normalizedLabel, amount: roundMoney(previous + normalizedAmount) };
    return current;
  }
  return [...current, { id: crypto.randomUUID(), label: normalizedLabel, amount: normalizedAmount }];
}

function subtractOtherCharge(existing, label, amountToSubtract) {
  const normalizedAmount = roundMoney(Math.max(0, amountToSubtract));
  const normalizedLabel = String(label ?? "").trim().toUpperCase();
  if (normalizedAmount <= 0 || !normalizedLabel) return [...(existing ?? [])];
  let remaining = normalizedAmount;
  const next = [];
  for (const charge of existing ?? []) {
    if (String(charge.label ?? "").trim().toUpperCase() !== normalizedLabel) {
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

function findLastWeeklyDueDate(client, date) {
  for (let i = 0; i <= 7; i += 1) {
    const candidate = new Date(date);
    candidate.setDate(candidate.getDate() - i);
    if (isChargeDay(client, candidate)) return candidate;
  }
  return null;
}

function applyLateFeesForClosingDate({ clients, payments, lateFeeLedger, lateFeeSettings, closingDateKey }) {
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
  const rentAppliedByClient = new Map();
  const paymentCountByClient = new Map();
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
  const newEntries = [];
  const nextClients = clients.map((client) => {
    if (
      client.archivedAt ||
      client.status === "archivado" ||
      client.status === "taller" ||
      client.status === "chapisteria" ||
      client.status === "custodia"
    ) {
      return client;
    }
    if (!selectedUnits.has(normalizeUnitId(client.unitId))) return client;

    let reason = null;
    if (client.frequency === "daily") {
      const paymentsToday = paymentCountByClient.get(client.id) ?? 0;
      if (paymentsToday === 0) reason = "DAILY_MISSED_PROOF";
    } else if (client.frequency === "weekly") {
      const dueDate = findLastWeeklyDueDate(client, closingDate);
      const appliedToRentToday = rentAppliedByClient.get(client.id) ?? 0;
      const balanceAtStartOfDay = roundMoney(client.balance + appliedToRentToday);
      if (dueDate && closingDate > dueDate && balanceAtStartOfDay > 0) {
        reason = "WEEKLY_LATE_DAY";
      }
    }

    if (!reason) return client;
    const lateFeeKey = `${client.id}|${closingDateKey}|${reason}`;
    if (existingLateFeeKeys.has(lateFeeKey)) return client;

    const entry = {
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

  return { clients: nextClients, newEntries, lateFeeClients, lateFeeTotal };
}

async function fetchAll(client, table, columns = "*", userId) {
  const out = [];
  let from = 0;
  const page = 1000;
  while (true) {
    const { data, error } = await client.from(table).select(columns).eq("user_id", userId).range(from, from + page - 1);
    if (error) throw error;
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < page) break;
    from += page;
  }
  return out;
}

function normalizeClient(raw) {
  const data = raw?.data ?? raw;
  return data;
}

function normalizePayments(rows) {
  return rows.map((row) => row.data ?? row);
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const env = loadDotEnv(path.resolve(scriptDir, "..", ".env"));
const supabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const userId = "86fb801c-6a27-4884-adfc-b0332c0c1da4";
const closingDateKey = "2026-06-03";
const closingDate = parseDateKey(closingDateKey);
if (!closingDate) throw new Error("Fecha de cierre invalida.");
const targetDate = addDays(closingDate, 1);
const targetDateKey = toDateKey(targetDate);

const [clientRows, paymentRows, lateFeeRows, chargeRunRows, cashClosingRows, cashClosingAuditRows] = await Promise.all([
  fetchAll(supabase, "clients_cloud", "id,data,user_id", userId),
  fetchAll(supabase, "payments_cloud", "id,data,user_id", userId),
  fetchAll(supabase, "late_fee_ledger_cloud", "id,data,user_id", userId),
  fetchAll(supabase, "charge_runs_cloud", "id,data,user_id", userId),
  fetchAll(supabase, "cash_closings_cloud", "id,data,user_id", userId),
  fetchAll(supabase, "cash_closing_audit_cloud", "id,data,user_id", userId)
]);

const clients = clientRows.map(normalizeClient);
const payments = normalizePayments(paymentRows);
const lateFeeLedger = lateFeeRows.map((row) => row.data ?? row);
const chargeRuns = chargeRunRows.map((row) => row.data ?? row);
const cashClosings = cashClosingRows.map((row) => row.data ?? row);

if (chargeRuns.some((run) => run.targetDate === targetDateKey)) {
  console.log(`El cobro de ${targetDateKey} ya estaba aplicado.`);
  process.exit(0);
}

const lateFeeSettingsRes = await supabase.from("late_fee_settings_cloud").select("*").eq("user_id", userId).maybeSingle();
if (lateFeeSettingsRes.error) throw lateFeeSettingsRes.error;
const lateFeeSettings = lateFeeSettingsRes.data?.data ?? {};

const lateFeeResult = applyLateFeesForClosingDate({
  clients,
  payments,
  lateFeeLedger,
  lateFeeSettings,
  closingDateKey
});

const clientsWithLateFees = lateFeeResult.clients;
const newLateFeeEntries = lateFeeResult.newEntries;

let expectedClients = 0;
let chargedClients = 0;
let anomalyClients = 0;
let chargedTotal = 0;
const rows = [];
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
    const lastAfter = alreadyChargedThruTarget ? (client.lastChargeDate ?? targetDateKey) : targetDateKey;
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
  throw new Error(`No se pudo cerrar: ${anomalyClients} cliente(s) tenian estado inconsistente para ${targetDateKey}.`);
}

let nextLateFeeLedger = lateFeeLedger;
if (newLateFeeEntries.length > 0) {
  nextLateFeeLedger = [...newLateFeeEntries, ...lateFeeLedger].slice(0, 10000);
}

const nextChargeRun = {
  id: crypto.randomUUID(),
  closingDate: closingDateKey,
  targetDate: targetDateKey,
  expectedClients,
  chargedClients,
  anomalyClients,
  chargedTotal,
  createdAt: new Date().toISOString()
};

const nextCashClosing = { date: closingDateKey, closedAt: new Date().toISOString() };
const nextCashClosingAudit = [
  {
    id: crypto.randomUUID(),
    date: closingDateKey,
    action: "close",
    actor: "Operador",
    reason: "Reaplicacion de cierre despues de restauracion de respaldo",
    createdAt: new Date().toISOString()
  },
  ...cashClosingAuditRows.map((row) => row.data ?? row)
].slice(0, 300);

await supabase.from("clients_cloud").upsert(
  nextClients.map((client) => ({ user_id: userId, id: client.id, data: client })),
  { onConflict: "user_id,id" }
);

if (nextLateFeeLedger.length !== lateFeeLedger.length) {
  await supabase.from("late_fee_ledger_cloud").upsert(
    nextLateFeeLedger.map((entry) => ({ user_id: userId, id: entry.id, data: entry })),
    { onConflict: "user_id,id" }
  );
}

await supabase.from("charge_runs_cloud").upsert(
  [{ user_id: userId, id: nextChargeRun.id, data: nextChargeRun }],
  { onConflict: "user_id,id" }
);

await supabase.from("cash_closings_cloud").upsert(
  [{ user_id: userId, id: `${nextCashClosing.date}__${nextCashClosing.closedAt}`, data: nextCashClosing }],
  { onConflict: "user_id,id" }
);

await supabase.from("cash_closing_audit_cloud").upsert(
  nextCashClosingAudit.map((event) => ({ user_id: userId, id: event.id, data: event })),
  { onConflict: "user_id,id" }
);

console.log(JSON.stringify({
  closingDate: closingDateKey,
  targetDate: targetDateKey,
  expectedClients,
  chargedClients,
  anomalyClients,
  chargedTotal,
  lateFeeClients: lateFeeResult.lateFeeClients,
  lateFeeTotal: lateFeeResult.lateFeeTotal
}, null, 2));
