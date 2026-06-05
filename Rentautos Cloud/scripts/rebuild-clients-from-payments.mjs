import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

function parseArg(name, fallback = "") {
  const prefix = `--${name}=`;
  const arg = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : fallback;
}

function hasFlag(name) {
  return process.argv.slice(2).includes(`--${name}`);
}

function loadDotEnv(filePath) {
  const out = {};
  try {
    const raw = readFileSync(filePath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx <= 0) continue;
      out[trimmed.slice(0, idx)] = trimmed.slice(idx + 1);
    }
  } catch {
    // Best effort only.
  }
  return out;
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateKey(value) {
  if (!value || typeof value !== "string") return null;
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

function getAdjustedMonthlyChargeDate(year, monthIndex, monthlyChargeDay) {
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  const day = Math.min(Math.max(1, Math.floor(monthlyChargeDay || 1)), lastDay);
  const adjusted = new Date(year, monthIndex, day);
  if (adjusted.getDay() === 0) adjusted.setDate(adjusted.getDate() + 1);
  return adjusted;
}

function hasFirstSundayAlreadyCounted(client) {
  return !!client.firstSundayChargedAt || (Number(client.installmentsPaid) || 0) > 7;
}

function isChargeDay(client, date) {
  const weekDay = date.getDay();
  if (client.frequency === "daily") {
    if (weekDay >= 1 && weekDay <= 6) return true;
    if (weekDay === 0) return !!client.chargeFirstSunday && !hasFirstSundayAlreadyCounted(client);
    return false;
  }

  if (client.frequency === "weekly") {
    const dayMap = {
      monday: 1,
      tuesday: 2,
      wednesday: 3,
      thursday: 4,
      friday: 5,
      saturday: 6
    };
    return weekDay === (dayMap[client.weeklyChargeDay || "monday"] ?? 1);
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

  const adjusted = getAdjustedMonthlyChargeDate(date.getFullYear(), date.getMonth(), client.monthlyChargeDay ?? 1);
  return adjusted.getDate() === date.getDate();
}

function latestPaymentForClient(payments) {
  return [...payments].sort((a, b) => {
    const aDate = parseDateKey(a.dateApplied)?.getTime() ?? Number.NEGATIVE_INFINITY;
    const bDate = parseDateKey(b.dateApplied)?.getTime() ?? Number.NEGATIVE_INFINITY;
    if (aDate !== bDate) return bDate - aDate;
    const aCreated = Date.parse(a.createdAt ?? "");
    const bCreated = Date.parse(b.createdAt ?? "");
    if (Number.isFinite(aCreated) || Number.isFinite(bCreated)) {
      return (Number.isFinite(bCreated) ? bCreated : Number.NEGATIVE_INFINITY) - (Number.isFinite(aCreated) ? aCreated : Number.NEGATIVE_INFINITY);
    }
    return String(b.receiptNumber ?? "").localeCompare(String(a.receiptNumber ?? ""));
  })[0] ?? null;
}

function mergeBaseClient(client, payment) {
  if (!payment) {
    return {
      ...client,
      balance: roundMoney(client.balance ?? 0),
      advanceBalance: roundMoney(client.advanceBalance ?? 0),
      savings: roundMoney(client.savings ?? 0),
      installmentsPaid: Math.max(0, Number(client.installmentsPaid) || 0),
      installmentsRemaining: Math.max(0, Number(client.installmentsRemaining) || 0),
      rentAmount: roundMoney(Math.max(0, Number(client.rentAmount) || 0)),
      lastChargeDate: client.lastChargeDate ?? null,
      firstSundayChargedAt: client.firstSundayChargedAt ?? undefined,
      otherCharges: Array.isArray(client.otherCharges) ? client.otherCharges : []
    };
  }

  const balance = Number.isFinite(payment.balanceAfter) ? roundMoney(payment.balanceAfter) : roundMoney(client.balance ?? 0);
  const savings = Number.isFinite(payment.savingsAfter) ? roundMoney(payment.savingsAfter) : roundMoney(client.savings ?? 0);
  const advanceBalance = Number.isFinite(payment.advanceBalanceAfter) ? roundMoney(payment.advanceBalanceAfter) : roundMoney(client.advanceBalance ?? 0);
  const installmentsPaid = Number.isFinite(payment.installmentsPaidAfter)
    ? Math.max(0, Math.floor(payment.installmentsPaidAfter))
    : Math.max(0, Number(client.installmentsPaid) || 0);
  const installmentsRemaining = Number.isFinite(payment.installmentsRemainingAfter)
    ? Math.max(0, Math.floor(payment.installmentsRemainingAfter))
    : Math.max(0, Number(client.installmentsRemaining) || 0);

  return {
    ...client,
    balance,
    advanceBalance,
    savings,
    installmentsPaid,
    installmentsRemaining,
    rentAmount: roundMoney(Math.max(0, Number(payment.rentAmount ?? client.rentAmount) || 0)),
    frequency: payment.frequency ?? client.frequency,
    weeklyChargeDay: payment.weeklyChargeDay ?? client.weeklyChargeDay,
    monthlyChargeDay: payment.monthlyChargeDay ?? client.monthlyChargeDay,
    chargeFirstSunday: payment.chargeFirstSunday ?? client.chargeFirstSunday,
    firstSundayChargedAt: payment.firstSundayChargedAt ?? client.firstSundayChargedAt,
    lastChargeDate: payment.dateApplied ?? client.lastChargeDate ?? null,
    otherCharges: Array.isArray(payment.otherChargesDueAfter) ? payment.otherChargesDueAfter : (Array.isArray(client.otherCharges) ? client.otherCharges : [])
  };
}

function advanceToToday(baseClient, asOfDate) {
  const today = startOfDay(asOfDate);
  const todayKey = toDateKey(today);

  if (
    baseClient.archivedAt ||
    baseClient.status === "archivado" ||
    baseClient.status === "taller" ||
    baseClient.status === "chapisteria" ||
    baseClient.status === "custodia"
  ) {
    return { client: { ...baseClient, lastChargeDate: baseClient.lastChargeDate ?? todayKey }, chargedDays: 0, chargedAmount: 0 };
  }

  const firstChargeDate = baseClient.firstChargeDate ? parseDateKey(baseClient.firstChargeDate) : null;
  if (firstChargeDate && firstChargeDate > today) {
    const targetLastCharge = toDateKey(addDays(firstChargeDate, -1));
    return {
      client: { ...baseClient, lastChargeDate: baseClient.lastChargeDate === targetLastCharge ? baseClient.lastChargeDate : targetLastCharge },
      chargedDays: 0,
      chargedAmount: 0
    };
  }

  let lastChargeDate = baseClient.lastChargeDate ? parseDateKey(baseClient.lastChargeDate) : null;
  if (lastChargeDate === null) {
    const createdAt = new Date(baseClient.createdAt);
    lastChargeDate = Number.isNaN(createdAt.getTime()) ? today : startOfDay(createdAt);
    if (lastChargeDate > today) lastChargeDate = today;
  }

  if (lastChargeDate >= today) {
    const lastKnown = toDateKey(lastChargeDate);
    return {
      client: baseClient.lastChargeDate === lastKnown ? baseClient : { ...baseClient, lastChargeDate: lastKnown },
      chargedDays: 0,
      chargedAmount: 0
    };
  }

  let chargedDays = 0;
  let chargedAmount = 0;
  let firstSundayChargedAt = baseClient.firstSundayChargedAt;
  let current = { ...baseClient };
  const rentAmount = roundMoney(Math.max(0, Number(current.rentAmount) || 0));
  let advanceBalance = roundMoney(Math.max(0, Number(current.advanceBalance) || 0));
  let balance = roundMoney(Math.max(0, Number(current.balance) || 0));
  let installmentsPaid = Math.max(0, Number(current.installmentsPaid) || 0);
  let installmentsRemaining = Math.max(0, Number(current.installmentsRemaining) || 0);

  for (let cursor = addDays(lastChargeDate, 1); cursor <= today; cursor = addDays(cursor, 1)) {
    if (!isChargeDay(current, cursor)) continue;
    chargedDays += 1;
    const consumedAdvance = roundMoney(Math.min(advanceBalance, rentAmount));
    const uncoveredRent = roundMoney(Math.max(0, rentAmount - consumedAdvance));
    advanceBalance = roundMoney(Math.max(0, advanceBalance - consumedAdvance));
    balance = roundMoney(balance + uncoveredRent);
    installmentsPaid += 1;
    installmentsRemaining = Math.max(0, installmentsRemaining - 1);
    chargedAmount = roundMoney(chargedAmount + uncoveredRent);
    if (current.frequency === "daily" && cursor.getDay() === 0 && !!current.chargeFirstSunday && !firstSundayChargedAt) {
      firstSundayChargedAt = toDateKey(cursor);
    }
  }

  current = {
    ...current,
    balance,
    advanceBalance,
    installmentsPaid,
    installmentsRemaining,
    firstSundayChargedAt,
    lastChargeDate: todayKey
  };

  return { client: current, chargedDays, chargedAmount };
}

async function fetchAll(supabase, table, userId) {
  const { data, error } = await supabase.from(table).select("id,data,user_id").eq("user_id", userId);
  if (error) throw error;
  return data ?? [];
}

async function main() {
  const asOf = parseArg("as-of", toDateKey(new Date()));
  const userId = parseArg("user-id", "86fb801c-6a27-4884-adfc-b0332c0c1da4");
  const apply = hasFlag("apply");
  const output = parseArg("output", `RESPALDOS/rebuild-report-${asOf}.json`);

  const envFile = loadDotEnv(".env");
  const supabaseUrl = process.env.VITE_SUPABASE_URL ?? envFile.VITE_SUPABASE_URL ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? envFile.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Faltan VITE_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const [{ data: clientRows }, { data: paymentRows }] = await Promise.all([
    supabase.from("clients_cloud").select("id,data,user_id").eq("user_id", userId),
    supabase.from("payments_cloud").select("id,data,user_id").eq("user_id", userId)
  ]);

  const clients = (clientRows ?? []).map((row) => row.data).filter(Boolean);
  const payments = (paymentRows ?? []).map((row) => row.data).filter(Boolean);
  const paymentBuckets = new Map();
  for (const payment of payments) {
    const bucket = paymentBuckets.get(payment.clientId) ?? [];
    bucket.push(payment);
    paymentBuckets.set(payment.clientId, bucket);
  }

  const report = {
    schemaVersion: "rentautos-rebuild-from-payments-v1",
    createdAt: new Date().toISOString(),
    asOf,
    userId,
    clients: clients.length,
    payments: payments.length,
    matchedPayments: 0,
    updatedClients: 0,
    skippedArchived: 0,
    totalBalanceDelta: 0,
    totalInstallmentsDelta: 0,
    samples: []
  };

  const nextClients = [];
  for (const client of clients) {
    const clientPayments = paymentBuckets.get(client.id) ?? [];
    const latestPayment = latestPaymentForClient(clientPayments);
    if (latestPayment) report.matchedPayments += 1;

    const baseClient = mergeBaseClient(client, latestPayment);
    const { client: rebuilt, chargedDays, chargedAmount } = advanceToToday(baseClient, parseDateKey(asOf) ?? new Date());

    const balanceDelta = roundMoney((rebuilt.balance ?? 0) - (client.balance ?? 0));
    const installmentsDelta = Math.max(0, (rebuilt.installmentsPaid ?? 0) - (client.installmentsPaid ?? 0));

    if (
      rebuilt.balance !== client.balance ||
      rebuilt.installmentsPaid !== client.installmentsPaid ||
      rebuilt.installmentsRemaining !== client.installmentsRemaining ||
      rebuilt.lastChargeDate !== client.lastChargeDate ||
      rebuilt.advanceBalance !== client.advanceBalance ||
      rebuilt.savings !== client.savings ||
      rebuilt.firstSundayChargedAt !== client.firstSundayChargedAt ||
      rebuilt.frequency !== client.frequency ||
      rebuilt.rentAmount !== client.rentAmount
    ) {
      report.updatedClients += 1;
      report.totalBalanceDelta = roundMoney(report.totalBalanceDelta + balanceDelta);
      report.totalInstallmentsDelta += installmentsDelta;
      if (report.samples.length < 12) {
        report.samples.push({
          unitId: client.unitId,
          name: client.name,
          from: {
            balance: client.balance,
            installmentsPaid: client.installmentsPaid,
            installmentsRemaining: client.installmentsRemaining,
            lastChargeDate: client.lastChargeDate
          },
          to: {
            balance: rebuilt.balance,
            installmentsPaid: rebuilt.installmentsPaid,
            installmentsRemaining: rebuilt.installmentsRemaining,
            lastChargeDate: rebuilt.lastChargeDate
          },
          latestPaymentDate: latestPayment?.dateApplied ?? null,
          chargedDays,
          chargedAmount
        });
      }
    }

    if (client.archivedAt || client.status === "archivado" || client.status === "taller" || client.status === "chapisteria" || client.status === "custodia") {
      report.skippedArchived += 1;
    }

    nextClients.push(rebuilt);
  }

  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify(report, null, 2), "utf8");

  if (!apply) {
    console.log(`Dry run completado. Reporte: ${path.resolve(output)}`);
    console.log(JSON.stringify({
      clients: report.clients,
      payments: report.payments,
      matchedPayments: report.matchedPayments,
      updatedClients: report.updatedClients
    }, null, 2));
    return;
  }

  await supabase.from("clients_cloud").upsert(
    nextClients.map((client) => ({ user_id: userId, id: client.id, data: client })),
    { onConflict: "user_id,id" }
  );

  console.log(`Reconstruccion aplicada. Reporte: ${path.resolve(output)}`);
  console.log(JSON.stringify({
    clients: report.clients,
    payments: report.payments,
    matchedPayments: report.matchedPayments,
    updatedClients: report.updatedClients,
    totalBalanceDelta: report.totalBalanceDelta,
    totalInstallmentsDelta: report.totalInstallmentsDelta
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
