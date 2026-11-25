import fs from "node:fs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
const env = {};
for (const file of [".env", ".env.local"]) {
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}
const db = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: owners, error: ownerError } = await db.from("street_management_items_cloud").select("user_id").limit(1);
if (ownerError) throw ownerError;
assert.ok(owners?.length);
const owner = owners[0].user_id;
const id = "__verification_contact_" + randomUUID();
const at = new Date().toISOString();
const attempts = [{ date: "2026-11-16", at, collector: "collector-1", result: "no_answer" }];
try {
  let response = await db.from("street_management_items_cloud").insert({
    user_id: owner, client_id: id, data: { status: "pending", updatedAt: at, contactOutcomes: attempts }
  });
  if (response.error) throw response.error;
  response = await db.from("street_management_items_cloud").select("data").eq("user_id", owner).eq("client_id", id).single();
  if (response.error) throw response.error;
  assert.deepEqual(response.data.data.contactOutcomes, attempts);
  attempts.push({ ...attempts[0], at: new Date().toISOString(), result: "promise" });
  response = await db.from("street_management_items_cloud").update({ data: { status: "pending", updatedAt: attempts[1].at, contactOutcomes: attempts } }).eq("user_id", owner).eq("client_id", id);
  if (response.error) throw response.error;
  response = await db.from("street_management_items_cloud").select("data").eq("user_id", owner).eq("client_id", id).single();
  if (response.error) throw response.error;
  assert.deepEqual(response.data.data.contactOutcomes, attempts);
  console.log("PASS live Supabase: no-answer write/read and second-attempt promise write/read.");
} finally {
  const { error } = await db.from("street_management_items_cloud").delete().eq("user_id", owner).eq("client_id", id);
  if (error) throw error;
  const check = await db.from("street_management_items_cloud").select("client_id").eq("user_id", owner).eq("client_id", id);
  if (check.error) throw check.error;
  assert.equal(check.data.length, 0);
  console.log("PASS cleanup: temporary verification record removed.");
}
