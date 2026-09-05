const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

// Compile in memory: no app session, database or generated files are needed.
const cache = new Map();
function loadSource(file) {
  const resolved = path.resolve(__dirname, "..", file);
  if (cache.has(resolved)) return cache.get(resolved).exports;
  const mod = { exports: {} };
  cache.set(resolved, mod);
  const output = ts.transpileModule(fs.readFileSync(resolved, "utf8"), {
    fileName: resolved,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.React,
      esModuleInterop: true
    }
  }).outputText;
  const localRequire = (specifier) => {
    if (!specifier.startsWith(".")) return require(specifier);
    const base = path.resolve(path.dirname(resolved), specifier);
    return loadSource(fs.existsSync(`${base}.ts`) ? `${base}.ts` : `${base}.tsx`);
  };
  new Function("require", "module", "exports", output)(localRequire, mod, mod.exports);
  return mod.exports;
}

const rules = loadSource("src/components/paymentReceiptRules.ts");
const payment = Object.freeze({
  id: "receipt-paid-sunday-test",
  receiptNumber: "REC-29640",
  clientId: "receipt-test-client",
  clientName: "CLIENTE DE PRUEBA",
  clientUnit: "B80",
  dateApplied: "2026-09-01",
  createdAt: "2026-09-02T03:27:44.048Z",
  paymentMethod: "Efectivo",
  frequency: "daily",
  rentAmount: 32,
  amountReceived: 50,
  appliedToRent: 50,
  centavosAhorro: 0,
  balanceBefore: 106,
  balanceAfter: 56,
  savingsBefore: 4,
  savingsAfter: 4,
  advanceBalanceAfter: 0,
  installmentsDeducted: 2,
  installmentsFromDebt: 2,
  installmentsFromAdvance: 0,
  installmentsTotalInPayment: 2,
  installmentsPaidAfter: 8,
  installmentsRemainingAfter: 965,
  chargeFirstSunday: true,
  firstSundayChargedAt: "2026-08-30",
  otherChargesDueAfter: [{ id: "other-test", label: "REPORTES", amount: 20 }]
});
const before = JSON.stringify(payment);
const sunday = new Date("2026-08-30T12:00:00");
for (const paid of [8, 38]) {
  for (const marker of [undefined, "2026-08-30"]) {
    assert.equal(rules.isDebtChargeDayForReceipt({ ...payment, installmentsPaidAfter: paid, firstSundayChargedAt: marker }, sunday), false);
  }
}
// Preserve genuine first-Sunday coverage and the existing seven-installment boundary.
for (const paid of [0, 1, 7]) {
  const early = { ...payment, installmentsPaidAfter: paid };
  assert.equal(rules.isDebtChargeDayForReceipt(early, sunday), true);
  assert.equal(rules.isDebtChargeDayForReceipt(early, new Date("2026-08-23T12:00:00")), false);
  assert.equal(rules.isDebtChargeDayForReceipt({ ...early, firstSundayChargedAt: undefined }, sunday), true);
}
assert.deepEqual(rules.buildCoveredPaymentRows(payment), [
  { dateLabel: "Viernes 28 de agosto", status: "complete" },
  { dateLabel: "Sábado 29 de agosto", status: "complete" },
  { dateLabel: "Lunes 31 de agosto", status: "partial", amount: 8 }
]);
assert.deepEqual(rules.buildRentPaymentBreakdownRows(payment), [
  { label: "Viernes 28 de agosto", amount: 10 },
  { label: "Sábado 29 de agosto", amount: 32 },
  { label: "Lunes 31 de agosto", amount: 8 }
]);
assert.equal(rules.buildRentPaymentBreakdownRows(payment).reduce((sum, row) => sum + row.amount, 0), 50);
assert.equal(rules.findDebtStartDateForReceipt(payment, new Date("2026-09-01T12:00:00")).getDate(), 31);
// Weekly schedules must not inherit the daily Sunday lock.
assert.equal(rules.isDebtChargeDayForReceipt({ ...payment, frequency: "weekly", weeklyChargeDay: "saturday" }, new Date("2026-08-29T12:00:00")), true);

const { ReceiptCardContent } = loadSource("src/components/PaymentReceipt.tsx");
for (const format of ["history", "standard"]) {
  const markup = renderToStaticMarkup(React.createElement(ReceiptCardContent, { payment, format }));
  assert.ok(!markup.includes("Domingo 30 de agosto"));
  assert.ok(markup.includes("$56.00"), "The stored rent balance must remain unchanged in both receipt formats.");
  if (format === "history") {
    for (const label of ["Viernes 28 de agosto", "Sábado 29 de agosto", "Lunes 31 de agosto", "$50.00", "$20.00"]) {
      assert.ok(markup.includes(label), `Missing receipt content: ${label}`);
    }
  }
}
assert.equal(JSON.stringify(payment), before, "Receipt rendering must not mutate payment data.");
console.log("OK B80 receipt: excludes paid Sunday; preserves $50 payment, $56 rent balance and $20 other charges.");
