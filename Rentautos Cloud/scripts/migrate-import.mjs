import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  ARRAY_TABLE_MAP,
  SINGLETON_TABLE_MAP,
  LS_KEYS,
  loadDotEnv,
  nowStamp,
  parseArg,
  readJson,
  summarizeValue,
  toArray,
  toObject,
  writeJson
} from "./migration-common.mjs";

function makeRowId(key, rec, idx) {
  if (typeof rec?.id === "string" && rec.id.trim()) return rec.id.trim();
  if (key === "cobrapp.module2.cash_closings.v1") {
    return `${rec?.date ?? "na"}__${rec?.closedAt ?? idx}`;
  }
  if (key === "cobrapp.module2.notified.v1") {
    return `${rec?.clientId ?? "na"}__${rec?.createdAt ?? idx}__${idx}`;
  }
  return `row-${idx + 1}`;
}

function chunkIds(ids, size = 150) {
  const chunks = [];
  for (let i = 0; i < ids.length; i += size) {
    chunks.push(ids.slice(i, i + size));
  }
  return chunks;
}

const mode = parseArg("mode", "dry-run");
const input = parseArg("input", "");
const userId = parseArg("user-id", "");
const output = parseArg("output", `exports/migrate-${mode}-report-${nowStamp()}.json`);

if (!input) {
  console.error("Falta --input=exports/baseline-*.json");
  process.exit(1);
}
if (!userId) {
  console.error("Falta --user-id=<uuid-del-auth-user>");
  process.exit(1);
}

const payload = readJson(input);
const data = payload.data ?? {};

const report = {
  schemaVersion: "rentautos-migrate-report-v1",
  mode,
  input: path.resolve(input),
  userId,
  startedAt: new Date().toISOString(),
  tables: {},
  totals: { rows: 0, errors: 0 }
};

for (const key of LS_KEYS) {
  if (ARRAY_TABLE_MAP[key]) {
    const rows = toArray(data[key]);
    report.tables[ARRAY_TABLE_MAP[key]] = {
      sourceKey: key,
      expectedRows: rows.length,
      validRows: rows.length,
      invalidRows: 0,
      sampleSummary: summarizeValue(data[key])
    };
    report.totals.rows += rows.length;
  } else if (SINGLETON_TABLE_MAP[key]) {
    report.tables[SINGLETON_TABLE_MAP[key]] = {
      sourceKey: key,
      expectedRows: data[key] == null ? 0 : 1,
      validRows: data[key] == null ? 0 : 1,
      invalidRows: 0,
      sampleSummary: summarizeValue(data[key])
    };
    report.totals.rows += data[key] == null ? 0 : 1;
  }
}

if (mode !== "apply") {
  report.finishedAt = new Date().toISOString();
  writeJson(output, report);
  console.log(`OK dry-run: ${path.resolve(output)}`);
  process.exit(0);
}

const envFile = loadDotEnv(".env");
const supabaseUrl = process.env.VITE_SUPABASE_URL ?? envFile.VITE_SUPABASE_URL ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? envFile.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!supabaseUrl || !serviceRoleKey) {
  console.error("Para --mode=apply necesitas VITE_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

for (const [key, table] of Object.entries(ARRAY_TABLE_MAP)) {
  const rows = toArray(data[key]).map((rec, idx) => ({
    user_id: userId,
    id: makeRowId(key, rec, idx),
    data: rec
  }));

  if (rows.length > 0) {
    const { error } = await supabase.from(table).upsert(rows, { onConflict: "user_id,id" });
    if (error) {
      report.tables[table].error = error.message;
      report.totals.errors += 1;
      continue;
    }
  }

  const nextIds = new Set(rows.map((row) => row.id));
  const { data: existingRows, error: selectError } = await supabase
    .from(table)
    .select("id")
    .eq("user_id", userId);

  if (selectError) {
    report.tables[table].error = selectError.message;
    report.totals.errors += 1;
    continue;
  }

  const staleIds = (existingRows ?? [])
    .map((row) => String(row.id ?? ""))
    .filter((id) => id.length > 0 && !nextIds.has(id));

  for (const idsChunk of chunkIds(staleIds)) {
    const { error: deleteError } = await supabase
      .from(table)
      .delete()
      .eq("user_id", userId)
      .in("id", idsChunk);
    if (deleteError) {
      report.tables[table].error = deleteError.message;
      report.totals.errors += 1;
      break;
    }
  }
}

for (const [key, table] of Object.entries(SINGLETON_TABLE_MAP)) {
  const value = data[key];
  if (value == null) continue;
  let row = {};
  if (table === "receipt_sequences_cloud") {
    row = { user_id: userId, seq: Number(value) || 0 };
  } else if (table === "client_ui_prefs_cloud") {
    const statusFilter = typeof value === "string" ? value : null;
    row = { user_id: userId, status_filter: statusFilter, data: { status_filter: statusFilter } };
  } else {
    row = { user_id: userId, data: toObject(value) };
  }
  const { error } = await supabase.from(table).upsert(row, { onConflict: "user_id" });
  if (error) {
    report.tables[table].error = error.message;
    report.totals.errors += 1;
  }
}

report.finishedAt = new Date().toISOString();
writeJson(output, report);
console.log(`OK apply: ${path.resolve(output)} | errors=${report.totals.errors}`);
