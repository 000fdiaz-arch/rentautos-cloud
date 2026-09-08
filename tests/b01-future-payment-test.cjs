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
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, esModuleInterop: true }
  }).outputText;
  const localRequire = (specifier) => {
    if (!specifier.startsWith(".")) return require(specifier);
    const base = path.resolve(path.dirname(resolved), specifier);
    for (const suffix of [".ts", ".tsx"]) if (fs.existsSync(base + suffix)) return loadSource(base + suffix);
    return loadSource(base);
  };
  new Function("require", "module", "exports", output)(localRequire, mod, mod.exports);
  return mod.exports;
}

const { findNextChargeDay } = loadSource("src/billing.ts");
const { ReceiptCardContent } = loadSource("src/components/PaymentReceipt.tsx");
const client = {
  id: "739bf7e3-5dbb-4425-9d89-0a596b8b0d63", unitId: "B01", name: "JEREMY JAMYR OSORIO ARCIA",
  rentAmount: 299, frequency: "biweekly", balance: 0, advanceBalance: 419, savings: 0.2,
  installmentsAgreed: 74, installmentsIssued: 12, installmentsPaid: 11, installmentsRemaining: 63,
  otherCharges: [], status: "activo", createdAt: "2026-04-29T09:40:47.468Z"
};
const payment = {
  id: "f9847611-16aa-4c64-b931-006192ccccdb", receiptNumber: "REC-31128", clientId: client.id,
  clientName: client.name, clientUnit: "B01", dateApplied: "2026-09-07", paymentMethod: "Transferencia Bancaria",
  amountReceived: 162, appliedToRent: 0, centavosAhorro: 0, balanceBefore: 0, balanceAfter: 0,
  advanceBalanceAfter: 419, savingsBefore: 0.2, savingsAfter: 0.2, installmentsDeducted: 0,
  installmentsFromDebt: 0, installmentsFromAdvance: 0, installmentsPaidAfter: 11,
  installmentsRemainingAfter: 63, rentAmount: 299, frequency: "biweekly", createdAt: "2026-09-07T21:25:03.931Z",
  otherChargesApplied: [{ id: "parts", label: "PIEZAS", amount: 162, createdAt: "2026-09-07" }]
};

assert.equal(findNextChargeDay(client, new Date("2026-09-07T12:00:00")).toISOString().slice(0, 10), "2026-10-15");
const text = renderToStaticMarkup(React.createElement(ReceiptCardContent, { payment, accountClient: client, format: "history" }))
  .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
assert.ok(text.includes("Restante de la cuota futura Aún no está vencida $179.00"), text);
assert.ok(text.includes("Fecha límite de esta cuota Jueves 15 de octubre"), text);
assert.ok(!text.includes("Saldo pendiente $0.00"), text);
console.log("OK B01: $419 cubre la cuota emitida y una cuota completa; quedan $179 para el 15 de octubre.");
