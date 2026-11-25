import fs from "node:fs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import vm from "node:vm";
import ts from "typescript";
import { createClient } from "@supabase/supabase-js";
const env = {};
for (const file of [".env", ".env.local"]) {
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, options);
const operator = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, options);
const { data: profiles, error } = await admin.from("user_profiles").select("*").eq("role", "operador").eq("is_active", true);
if (error) throw error;
const template = profiles.find(p => p.permissions?.receivables?.edit && p.permissions?.receivables?.view);
assert.ok(template);
const email = "verification-" + randomUUID() + "@auth.rentautos.local";
const password = randomUUID() + "aA9!";
const id = "__verification_rls_" + randomUUID();
let userId;
const ledger = fs.readFileSync("src/pages/receivables/ReceivablesLedgerTable.tsx", "utf8");
const pendingExpression = ledger.match(/const pendingIds = ([\s\S]*?);/)[1];
const followupExports = {};
vm.runInNewContext(ts.transpile(fs.readFileSync("src/pages/receivables/promiseFollowup.ts", "utf8"), {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020
}), { exports: followupExports });
try {
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  userId = created.data.user.id;
  const profile = await admin.from("user_profiles").upsert({
    id: userId, email, role: "operador", is_active: true,
    data_owner_user_id: template.data_owner_user_id, permissions: template.permissions
  });
  if (profile.error) throw profile.error;
  const signed = await operator.auth.signInWithPassword({ email, password });
  if (signed.error) throw signed.error;
  for (const collector of ["collector-1", "collector-2"]) {
    const at = new Date().toISOString();
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Panama", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const attempts = [{ date, at, collector, result: "no_answer" }];
    const value = { status: "pending", updatedAt: at, contactOutcomes: attempts };
    const write = await operator.from("street_management_items_cloud").upsert({
      user_id: template.data_owner_user_id, client_id: id, data: value
    });
    if (write.error) throw write.error;
    const read = await operator.from("street_management_items_cloud").select("data").eq("user_id", template.data_owner_user_id).eq("client_id", id).single();
    if (read.error) throw read.error;
    assert.deepEqual(read.data.data.contactOutcomes, attempts);
    const pendingIds = Array.from(vm.runInNewContext(pendingExpression, {
      rows: [{ id }], collectionStatusByClient: { [id]: read.data.data }, todayDateKey: date, collectorKey: collector
    }));
    assert.deepEqual(pendingIds, [id]);
    const transition = ledger.match(/onClick=\{\(\) => \{\s*(onPersistPendingChanges\(\);[\s\S]*?)\}\}/)[1];
    let nextRound;
    vm.runInNewContext(transition, {
      retryIds: null, pendingIds, currentRowIndex: 0, roundRows: [{ id }],
      onPersistPendingChanges() {}, setRetryIds(ids) { nextRound = ids; },
      setSelectedRowIndex(index) { assert.equal(index, 0); },
      changeSelectedRow() { assert.fail("Unexpected navigation"); },
      setRoundFinished() { assert.fail("Should start second round"); }
    });
    assert.deepEqual(nextRound, [id]);
    console.log("PASS authenticated operator:", collector, "write/read and automatic second round.");
    const promise = { date, at: date + "T17:00:00.000Z", collector, result: "promise",
      promiseDate: date, promiseTime: "14:00", promiseAmount: 100 };
    const promised = { status: "pending", updatedAt: new Date().toISOString(),
      paymentPromiseDate: date, paymentPromiseTime: "14:00", paymentPromiseAmount: 100,
      contactOutcomes: [...attempts, promise] };
    const promiseWrite = await operator.from("street_management_items_cloud")
      .update({ data: promised }).eq("user_id", template.data_owner_user_id).eq("client_id", id);
    if (promiseWrite.error) throw promiseWrite.error;
    const promiseRead = await operator.from("street_management_items_cloud").select("data")
      .eq("user_id", template.data_owner_user_id).eq("client_id", id).single();
    if (promiseRead.error) throw promiseRead.error;
    const saved = promiseRead.data.data;
    assert.deepEqual(saved, promised, "All promise fields must survive the database round trip");
    const check = (payments, time) => followupExports.promiseFollowup(saved, collector, payments, new Date(date + time));
    assert.equal(check([], "T18:59:59.999Z").overdue, false);
    assert.equal(check([], "T19:00:00.000Z").overdue, true);
    const payment = { id: "simulated-payment", createdAt: date + "T18:00:00.000Z", amountReceived: 40 };
    assert.equal(check([payment], "T19:00:00.000Z").remaining, 60);
    assert.equal(check([payment], "T19:00:00.000Z").overdue, true);
    assert.equal(check([{ ...payment, amountReceived: 100 }], "T19:00:00.000Z").overdue, false);
    assert.equal(check([{ ...payment, amountReceived: 99.99 }], "T19:00:00.000Z").overdue, true);
    assert.equal(check([{ ...payment, amountReceived: 150 }], "T19:00:00.000Z").overdue, false);
    assert.equal(check([{ ...payment, createdAt: date + "T16:59:00.000Z" }], "T19:00:00.000Z").remaining, 100);
    assert.equal(check([{ ...payment, createdAt: date + "T20:00:00.000Z" }], "T19:00:00.000Z").remaining, 100);
    assert.equal(followupExports.promiseFollowup(saved, collector === "collector-1" ? "collector-2" : "collector-1", [], new Date(date + "T19:00:00Z")), null);
    console.log("PASS", collector, "live promise snapshot; before/exact deadline; partial/full/excess payments; one-cent remainder; past/future payment exclusion; collector isolation. Payments simulated, promise read from live DB.");
  }
  const denied = await operator.from("street_management_items_cloud").insert({
    user_id: randomUUID(), client_id: id, data: {}
  });
  assert.ok(denied.error, "Cross-owner write must fail");
  console.log("PASS cross-owner write denied:", denied.error.code);
} finally {
  const removed = await admin.from("street_management_items_cloud").delete().eq("user_id", template.data_owner_user_id).eq("client_id", id);
  if (removed.error) throw removed.error;
  if (userId) {
    const profile = await admin.from("user_profiles").delete().eq("id", userId);
    if (profile.error) throw profile.error;
    const deleted = await admin.auth.admin.deleteUser(userId);
    if (deleted.error) throw deleted.error;
  }
  console.log("Cleanup completed: temporary operator and verification record removed.");
}
