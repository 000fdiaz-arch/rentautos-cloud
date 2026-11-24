const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");

require.extensions[".ts"] = (module, filename) => {
  const source = fs.readFileSync(filename, "utf8").replaceAll("import.meta.env", "({})");
  module._compile(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: filename
  }).outputText, filename);
};

const rules = require("../src/pages/payments/paymentRules.ts");
const storage = require("../src/storage/operationalStorage.ts");
const { OTHER_CHARGES_WEEKDAYS } = require("../src/otherChargesRetention.ts");
const cache = new Map();
global.localStorage = { getItem: (key) => cache.get(key) ?? null, setItem: (key, value) => cache.set(key, value) };

const client = {
  id: "t22", unitId: "T22", name: "Cliente", frequency: "daily", rentAmount: 33,
  weeklyChargeDay: "monday", balance: 33, advanceBalance: 0, savings: 0,
  installmentsPaid: 4, installmentsRemaining: 942,
  otherCharges: [{ id: "deposit", label: "DEPOSITO", amount: 100, createdAt: "2026-11-14" }]
};
const settings = { t22: { amount: 25, cycle: "weekly", weeklyChargeDay: "sunday" } };
const checkpoint = {
  clientId: "t22", paymentId: "last", dateApplied: "2026-11-18", createdAt: "2026-11-19T02:49:55Z",
  retentionEvent: { mode: "manual", cycle: "daily", baseAmount: 5, cyclesElapsed: 0, calculatedAmount: 0, appliedAmount: 0 }
};

// Every supported weekday survives local caching and loading, including Sunday.
for (const day of OTHER_CHARGES_WEEKDAYS) {
  const config = { t22: { ...settings.t22, weeklyChargeDay: day } };
  storage.saveOtherChargesRetentionByClient(config);
  assert.deepEqual(storage.loadOtherChargesRetentionByClient(), config);
  const from = new Date(2026, 10, 16);
  const to = new Date(2026, 10, 23);
  assert.equal(rules.countRetentionEventsInRange(client, "weekly", from, to, day), 1);
}
storage.saveOtherChargesRetentionByClient({ t22: { ...settings.t22, weeklyChargeDay: "invalid" } });
assert.deepEqual(storage.loadOtherChargesRetentionByClient(), { t22: { amount: 25, cycle: "weekly" } });
assert.equal(rules.getConfiguredOtherChargesRetentionConfig(client, storage.loadOtherChargesRetentionByClient()).weeklyChargeDay, "monday");
cache.set("cobrapp.settings.other_charges_retention.v1", JSON.stringify({ legacy: 8 }));
assert.deepEqual(storage.loadOtherChargesRetentionByClient(), { legacy: { amount: 8, cycle: "daily" } });

assert.equal(rules.computeConfiguredRetentionForPayment(client, settings, [], "2026-11-21", checkpoint), 0);
assert.equal(rules.computeConfiguredRetentionForPayment(client, settings, [], "2026-11-22", checkpoint), 25);
assert.equal(rules.computeConfiguredRetentionForPayment(client, settings, [], "2026-11-29", checkpoint), 50);
assert.equal(rules.computeConfiguredRetentionForPayment(client, settings, [], "2026-11-14"), 0);
assert.equal(rules.computeConfiguredRetentionForPayment(client, settings, [], "2026-11-15"), 25);
const sundayCharge = { ...client, otherCharges: [{ ...client.otherCharges[0], createdAt: "2026-11-15" }] };
assert.equal(rules.computeConfiguredRetentionForPayment(sundayCharge, settings, [], "2026-11-15"), 25);
const paid = rules.computeManualPaymentAllocation(client, 58, {}, settings, [], "2026-11-22", false, undefined, checkpoint);
assert.equal(paid.totalOtherCharges, 25);
assert.equal(paid.appliedToRent, 33);
const nextCheckpoint = { ...checkpoint, dateApplied: "2026-11-22", retentionEvent: paid.otherChargesRetentionEvent };
assert.equal(rules.computeConfiguredRetentionForPayment(client, settings, [], "2026-11-23", nextCheckpoint), 0);
assert.equal(rules.computeConfiguredRetentionForPayment(client, settings, [], "2026-11-29", nextCheckpoint), 25);
const partial = rules.computeManualPaymentAllocation(client, 10, {}, settings, [], "2026-11-22", false, undefined, checkpoint);
assert.equal(rules.computeConfiguredRetentionForPayment(client, settings, [], "2026-11-23", { ...nextCheckpoint, retentionEvent: partial.otherChargesRetentionEvent }), 15);
assert.equal(rules.computeConfiguredRetentionForPayment(client, { t22: { amount: 25, cycle: "weekly" } }, [], "2026-11-22", checkpoint), 0);
assert.equal(rules.computeConfiguredRetentionForPayment(client, { t22: { amount: 25, cycle: "weekly" } }, [], "2026-11-23", checkpoint), 25);
assert.equal(client.frequency, "daily");
assert.equal(client.weeklyChargeDay, "monday");
assert.equal(rules.getRetentionCycleLabel("weekly", "sunday"), "Semanal (Domingo)");
console.log("OK: dia semanal configurable, domingos, persistencia, compatibilidad y cobros sin duplicados.");
