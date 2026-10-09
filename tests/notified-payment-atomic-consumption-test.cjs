const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");

const sql = readFileSync("supabase/98-notified-payment-atomic-consumption.sql", "utf8");
const migration = readFileSync("supabase/migrations/20261001000100_notified_payment_atomic_consumption.sql", "utf8");
const hook = readFileSync("src/pages/payments/useNotifiedPayments.ts", "utf8");
const page = readFileSync("src/pages/PaymentsPage.tsx", "utf8");
const mirror = readFileSync("src/cloudMirror.ts", "utf8");
const cloud = readFileSync("src/cloud/operationsCloudData.ts", "utf8");

assert.equal(sql, migration, "the numbered SQL and migration must remain identical");
assert.match(sql, /notified_payment_tombstones/, "consumed notices have durable tombstones");
assert.match(sql, /after insert on public\.payments_cloud/, "payment insertion consumes the notice in the database transaction");
assert.match(sql, /before insert or update on public\.notified_payments_cloud/, "stale upserts are blocked");
assert.match(sql, /notified_payment_matches_bank_payment/, "server matching is shared by payment-first and notice-first flows");
assert.match(sql, /abs\(v_payment_date - v_notice_date\) <= 7/, "server date matching mirrors the client window");
assert.match(sql, /<= 0\.02/, "server amount matching mirrors the client tolerance");
assert.match(hook, /table: "notified_payments_cloud"/, "Payments listens for notified-payment changes");
assert.match(hook, /eventType === "DELETE"/, "remote deletes immediately leave the visible list");
assert.match(hook, /loadCloudNotifiedPayments\(ownerUserId\)/, "Payments replaces stale local notices with the authoritative cloud list");
assert.match(hook, /writeLocalStorageFromCloud\(NOTIFIED_PAYMENTS_KEY/, "the authoritative list also repairs the local browser cache without writing it back");
assert.match(hook, /status === "SUBSCRIBED"/, "Payments refreshes after its realtime connection is established again");
assert.match(hook, /window\.addEventListener\("focus", reloadWhenVisible\)/, "returning to the browser refreshes missed notice deletions");
assert.match(hook, /window\.addEventListener\("online", reloadWhenVisible\)/, "restoring the network refreshes missed notice deletions");
assert.match(hook, /document\.addEventListener\("visibilitychange", reloadWhenVisible\)/, "returning to the Payments tab refreshes missed notice deletions");
assert.match(hook, /deleteCloudNotice\?\.\(row\.id\)/, "manual deletion uses the explicit cloud row delete");
assert.match(page, /dataOwnerUserId,\s*\n\s*createRouteReview/, "the notified hook receives the shared owner id");
assert.match(page, /deleteCloudNotice: deleteNotifiedPaymentFromCloud/, "Payments wires the explicit cloud delete");
assert.match(cloud, /export async function deleteCloudNotifiedPayment/, "the cloud layer deletes one notice by id");
assert.match(cloud, /export async function loadCloudNotifiedPayments/, "the cloud layer loads the complete current notice list");
assert.match(mirror, /key !== "cobrapp\.module2\.notified\.v1"/, "the stale full-array mirror cannot infer notified-payment deletes");

console.log("OK: atomic notified-payment consumption and realtime UI synchronization are wired");
