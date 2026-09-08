const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

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

const { ReceiptCardContent } = loadSource("src/components/PaymentReceipt.tsx");
const { buildCoveredPaymentRows } = loadSource("src/components/paymentReceiptRules.ts");
const payment = {
  id: "b82-corrected-payment",
  createdBy: "nathalyv@auth.rentautos.local",
  receiptNumber: "REC-B82-TEST",
  clientId: "b82-client",
  clientName: "CLIENTE B82",
  clientUnit: "B82",
  dateApplied: "2026-09-07",
  paymentMethod: "ACH Express",
  amountReceived: 210.82,
  appliedToRent: 40,
  centavosAhorro: 0.82,
  advanceApplied: 170,
  advanceBalanceAfter: 170,
  balanceBefore: 40,
  balanceAfter: 0,
  savingsBefore: 13.12,
  savingsAfter: 13.94,
  installmentsDeducted: 1,
  installmentsFromDebt: 1,
  installmentsFromAdvance: 0,
  installmentsTotalInPayment: 1,
  installmentsPaidAfter: 51,
  installmentsRemainingAfter: 152,
  rentAmount: 210,
  frequency: "weekly",
  weeklyChargeDay: "tuesday",
  chargeFirstSunday: false,
  createdAt: "2026-09-07T20:08:45.809Z"
};

assert.deepEqual(buildCoveredPaymentRows(payment), [
  { dateLabel: "Martes 01 de septiembre", status: "complete" },
  { dateLabel: "Martes 08 de septiembre", status: "partial", amount: 170 }
]);

const text = renderToStaticMarkup(React.createElement(ReceiptCardContent, { payment, format: "history" }))
  .replace(/<[^>]+>/g, " ")
  .replace(/\s+/g, " ")
  .trim();

for (const expected of [
  "Martes 01 de septiembre",
  "$40.00",
  "Cuota futura · Martes 08 de septiembre",
  "Abono adelantado parcial",
  "$170.00",
  "Restante de la cuota futura Aún no está vencida $40.00",
  "Fecha límite de esta cuota Martes 08 de septiembre",
  "Realizado por nathalyv"
]) {
  assert.ok(text.includes(expected), `Falta texto obligatorio: ${expected}\n${text}`);
}
assert.ok(!text.includes("Saldo pendiente"), `El faltante futuro no debe figurar como deuda.\n${text}`);
assert.equal((text.match(/Martes 08 de septiembre/gi) ?? []).length, 3, "La fecha futura debe aparecer solo en banner, aplicación y fecha límite.");

console.log("OK B82: $40 cancela deuda, $170 queda adelantado y el faltante futuro de $40 no figura como deuda.");

const c94Payment = {
  ...payment,
  id: "c94-advance-overflow",
  receiptNumber: "REC-C94-TEST",
  clientId: "c94-client",
  clientUnit: "C94",
  amountReceived: 205,
  appliedToRent: 0,
  centavosAhorro: 0,
  advanceApplied: 205,
  advanceBalanceAfter: 205,
  balanceBefore: 0,
  balanceAfter: 0,
  savingsBefore: 0.94,
  savingsAfter: 0.94,
  installmentsDeducted: 0,
  installmentsFromDebt: 0,
  installmentsFromAdvance: 1,
  installmentsTotalInPayment: 1,
  installmentsPaidAfter: 2,
  installmentsRemainingAfter: 179,
  rentAmount: 204
};

assert.deepEqual(buildCoveredPaymentRows(c94Payment), [
  { dateLabel: "Martes 08 de septiembre", status: "complete" },
  { dateLabel: "Martes 15 de septiembre", status: "partial", amount: 1 }
]);

const c94Text = renderToStaticMarkup(React.createElement(ReceiptCardContent, { payment: c94Payment, format: "history" }))
  .replace(/<[^>]+>/g, " ")
  .replace(/\s+/g, " ")
  .trim();

for (const expected of [
  "Cuota futura · Martes 08 de septiembre Pagada por adelantado $204.00",
  "Cuota futura · Martes 15 de septiembre Abono adelantado parcial Acumulado $1.00",
  "Restante de la cuota futura Aún no está vencida $203.00",
  "Fecha límite de esta cuota Martes 15 de septiembre"
]) {
  assert.ok(c94Text.includes(expected), `C94: falta texto obligatorio: ${expected}\n${c94Text}`);
}
assert.ok(!c94Text.includes("Acumulado $204.00"), `C94 no debe presentar $204 como segundo abono.\n${c94Text}`);

console.log("OK C94: $205 cubre $204 del martes 8 y adelanta exactamente $1 para el martes 15.");
