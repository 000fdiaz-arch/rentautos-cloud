import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  ARRAY_TABLE_MAP,
  SINGLETON_TABLE_MAP,
  loadDotEnv,
  nowStamp,
  parseArg,
  readJson,
  toArray,
  writeJson
} from "./migration-common.mjs";

const input = parseArg("input", "");
const userId = parseArg("user-id", "");
const output = parseArg("output", `exports/reconcile-report-${nowStamp()}.json`);

if (!input || !userId) {
  console.error("Uso: --input=exports/baseline*.json --user-id=<uuid>");
  process.exit(1);
}

const envFile = loadDotEnv(".env");
const supabaseUrl = process.env.VITE_SUPABASE_URL ?? envFile.VITE_SUPABASE_URL ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? envFile.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!supabaseUrl || !serviceRoleKey) {
  console.error("Faltan VITE_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const payload = readJson(input);
const data = payload.data ?? {};
const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

const result = {
  schemaVersion: "rentautos-reconcile-v1",
  comparedAt: new Date().toISOString(),
  input: path.resolve(input),
  userId,
  checks: [],
  pass: true
};

for (const [key, table] of Object.entries(ARRAY_TABLE_MAP)) {
  const expected = toArray(data[key]).length;
  const { count, error } = await supabase.from(table).select("*", { head: true, count: "exact" }).eq("user_id", userId);
  const actual = error ? null : (count ?? 0);
  const ok = !error && actual === expected;
  result.checks.push({ table, sourceKey: key, expected, actual, ok, error: error?.message ?? null });
  if (!ok) result.pass = false;
}

for (const [key, table] of Object.entries(SINGLETON_TABLE_MAP)) {
  const expected = data[key] == null ? 0 : 1;
  const { count, error } = await supabase.from(table).select("*", { head: true, count: "exact" }).eq("user_id", userId);
  const actual = error ? null : (count ?? 0);
  const ok = !error && actual === expected;
  result.checks.push({ table, sourceKey: key, expected, actual, ok, error: error?.message ?? null });
  if (!ok) result.pass = false;
}

writeJson(output, result);
console.log(`Reconcile: ${result.pass ? "PASS" : "FAIL"} -> ${path.resolve(output)}`);
