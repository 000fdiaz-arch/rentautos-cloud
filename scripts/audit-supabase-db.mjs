import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { loadDotEnv, nowStamp } from "./migration-common.mjs";

const env = { ...loadDotEnv(".env"), ...process.env };
const supabaseUrl = env.VITE_SUPABASE_URL ?? "";
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY ?? "";

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Faltan VITE_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const client = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const PAGE_SIZE = 1000;

async function loadRows(table, select = "*", orderColumns = []) {
  const rows = [];
  let from = 0;
  while (true) {
    const to = from + PAGE_SIZE - 1;
    let query = client.from(table).select(select);
    for (const column of orderColumns) {
      query = query.order(column, { ascending: true });
    }
    const { data, error } = await query.range(from, to);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}

async function countRows(table) {
  const { count, error } = await client.from(table).select("*", { count: "exact", head: true });
  if (error) return { ok: false, error: error.message, count: null };
  return { ok: true, count: count ?? 0 };
}

function normalize(value) {
  return String(value ?? "").trim().toUpperCase().replace(/\s+/g, "");
}

function parseReceiptSeq(value) {
  const match = String(value ?? "").trim().toUpperCase().match(/^REC-([0-9]+)$/);
  const seq = Number(match?.[1] ?? 0);
  return Number.isFinite(seq) ? seq : 0;
}

function extractFolio(reference) {
  const match = String(reference ?? "").match(/FOLIO\s*:\s*([^\s|]+)/i);
  return normalize(match?.[1] ?? "");
}

function duplicates(rows, keyFn) {
  const counts = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

function paymentData(row) {
  return row?.data && typeof row.data === "object" ? row.data : {};
}

const tableNames = [
  "user_profiles",
  "clients_cloud",
  "payments_cloud",
  "pending_bank_items_cloud",
  "pending_card_items_cloud",
  "bank_rules_cloud",
  "manual_assignment_audit_cloud",
  "late_fee_ledger_cloud",
  "notified_payments_cloud",
  "cash_closings_cloud",
  "cash_closing_audit_cloud",
  "charge_runs_cloud",
  "receipt_sequences_cloud",
  "late_fee_settings_cloud",
  "other_charges_retention_cloud",
  "lead_evaluations_cloud",
  "fleet_units_cloud"
];

const counts = {};
for (const table of tableNames) {
  counts[table] = await countRows(table);
}

const [clients, payments, receiptSequences, profiles, fleetUnits] = await Promise.all([
  loadRows("clients_cloud", "user_id,id,data", ["user_id", "id"]),
  loadRows("payments_cloud", "user_id,id,data", ["user_id", "id"]),
  loadRows("receipt_sequences_cloud", "user_id,seq", ["user_id"]),
  loadRows("user_profiles", "id,email,role,data_owner_user_id,permissions", ["id"]),
  loadRows("fleet_units_cloud", "user_id,unit_id", ["user_id", "unit_id"])
]);

const clientIds = new Set(clients.map((row) => `${row.user_id}:${row.id}`));
const orphanPayments = payments.filter((row) => {
  const data = paymentData(row);
  return data.clientId && !clientIds.has(`${row.user_id}:${data.clientId}`);
});

const processedPayments = payments.filter((row) => {
  const data = paymentData(row);
  return (
    ["ACH Express", "Deposito Bancario", "Transferencia Bancaria"].includes(data.paymentMethod) ||
    (data.paymentMethod === "Tarjeta" && String(data.reference ?? "").toUpperCase().includes("TARJETA-CONCILIADA"))
  );
});

const maxSeqByUser = new Map();
for (const row of payments) {
  const data = paymentData(row);
  const seq = parseReceiptSeq(data.receiptNumber);
  if (seq > (maxSeqByUser.get(row.user_id) ?? 0)) maxSeqByUser.set(row.user_id, seq);
}

const storedSeqByUser = new Map(receiptSequences.map((row) => [row.user_id, Number(row.seq ?? 0) || 0]));
const receiptSequenceAudit = [...maxSeqByUser.entries()]
  .map(([userId, maxReceiptSeq]) => ({
    user_id: userId,
    stored_seq: storedSeqByUser.get(userId) ?? 0,
    max_receipt_seq: maxReceiptSeq,
    seq_behind: (storedSeqByUser.get(userId) ?? 0) < maxReceiptSeq
  }))
  .sort((a, b) => Number(b.seq_behind) - Number(a.seq_behind) || b.max_receipt_seq - a.max_receipt_seq);

const report = {
  auditedAt: new Date().toISOString(),
  projectUrl: supabaseUrl,
  counts,
  totals: {
    clients: clients.length,
    payments: payments.length,
    profiles: profiles.length,
    fleetUnits: fleetUnits.length
  },
  duplicates: {
    clientIds: duplicates(clients, (row) => `${row.user_id}:${row.id}`),
    paymentIds: duplicates(payments, (row) => `${row.user_id}:${row.id}`),
    receiptNumbers: duplicates(payments, (row) => `${row.user_id}:${normalize(paymentData(row).receiptNumber)}`),
    processedFolios: duplicates(processedPayments, (row) => {
      const folio = extractFolio(paymentData(row).reference);
      return folio ? `${row.user_id}:${folio}` : "";
    })
  },
  orphans: {
    paymentsWithoutClient: orphanPayments.length,
    samples: orphanPayments.slice(0, 20).map((row) => {
      const data = paymentData(row);
      return {
        payment_id: row.id,
        receiptNumber: data.receiptNumber,
        clientId: data.clientId,
        clientName: data.clientName,
        clientUnit: data.clientUnit,
        amountReceived: data.amountReceived,
        createdAt: data.createdAt
      };
    })
  },
  receiptSequences: receiptSequenceAudit,
  canApplyUniqueReceiptMigration:
    duplicates(payments, (row) => `${row.user_id}:${normalize(paymentData(row).receiptNumber)}`).length === 0
};

const outDir = path.join(process.cwd(), "exports");
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, `supabase-db-audit-${nowStamp()}.json`);
fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");

console.log(JSON.stringify({
  outPath,
  totals: report.totals,
  duplicateClientIds: report.duplicates.clientIds.length,
  duplicatePaymentIds: report.duplicates.paymentIds.length,
  duplicateReceiptNumbers: report.duplicates.receiptNumbers.length,
  duplicateProcessedFolios: report.duplicates.processedFolios.length,
  paymentsWithoutClient: report.orphans.paymentsWithoutClient,
  sequenceRowsBehind: report.receiptSequences.filter((row) => row.seq_behind).length,
  canApplyUniqueReceiptMigration: report.canApplyUniqueReceiptMigration
}, null, 2));
