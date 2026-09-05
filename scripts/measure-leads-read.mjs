// Read-only measurement. Prints timings/counts, never documents or identifiers.
import { createClient } from "@supabase/supabase-js";
import { loadDotEnv } from "./migration-common.mjs";

const env = loadDotEnv(process.argv[2] || ".env");
if (!env.VITE_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing database configuration");
const client = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});
console.log(JSON.stringify({ databaseHost: new URL(env.VITE_SUPABASE_URL).hostname, readOnly: true }));
const { data: owners, error } = await client.from("lead_evaluations_cloud").select("user_id").limit(1);
if (error) throw new Error(error.code);
const owner = owners?.[0]?.user_id;
if (!owner) { console.log("No Leads in this environment"); process.exit(0); }
async function measure(name, query) {
  const start = performance.now();
  const { data, count, error } = await query;
  console.log(JSON.stringify({ name, ms: Math.round(performance.now() - start), rows: data?.length, count,
    responseBytes: data ? Buffer.byteLength(JSON.stringify(data)) : undefined, error: error?.code ?? null }));
}
await measure("lead-count", client.from("lead_evaluations_cloud").select("id", { count: "exact", head: true }).eq("user_id", owner));
const oldSelect = ["id", ...["cedula", "birthDate", "age", "attachmentName", "noCases", "hasGpsTamperingReport", "hasLegalCases", "hasViolenceReports", "hasDuiReports", "hasPiracyReports", "collisionReports", "pendingDailyReports", "decision", "extraDeposit", "blockers", "extraDepositReasons", "sellerRequestId", "createdAt", "updatedAt"].map(key => `data->${key}`)].join(",");
await measure("previous-first-batch", client.from("lead_evaluations_cloud").select(oldSelect).eq("user_id", owner).order("id").limit(1000));
await measure("physical-summary-first-page", client.from("lead_evaluations_cloud").select("id,summary,updated_at").eq("user_id", owner).order("updated_at", { ascending: false }).order("id", { ascending: false }).limit(21));
await measure("seller-list-without-documents", client.from("seller_lead_requests").select("id,status,cedula,birth_date,attachment_name,updated_at").eq("user_id", owner).order("updated_at", { ascending: false }).order("id", { ascending: false }).limit(21));
