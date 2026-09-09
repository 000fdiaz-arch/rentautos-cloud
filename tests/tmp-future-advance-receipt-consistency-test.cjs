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

const { ReceiptCardContent } = loadSource("src/components/PaymentReceipt.tsx");
const { resolveFutureAdvanceReceiptState } = loadSource("src/components/paymentReceiptRules.ts");

const cases = [
  { name: "diario", frequency: "daily", expectedDate: "2026-09-10", cycle: "Jueves 10 de septiembre", single: "Jueves 10 de septiembre" },
  { name: "semanal", frequency: "weekly", weeklyChargeDay: "tuesday", expectedDate: "2026-09-22", cycle: "Martes 22 de septiembre", single: "Martes 22 de septiembre" },
  { name: "quincenal", frequency: "biweekly", expectedDate: "2026-09-30", cycle: "Quincena 30 de septiembre", single: "Miércoles 30 de septiembre" },
  { name: "mensual", frequency: "monthly", monthlyChargeDay: 15, expectedDate: "2026-10-15", cycle: "Mensualidad 15 de octubre", single: "Jueves 15 de octubre" }
];

for (const fixture of cases) {
  const client = {
    id: `client-${fixture.name}`,
    unitId: fixture.name.toUpperCase(),
    name: `CLIENTE ${fixture.name.toUpperCase()}`,
    rentAmount: 30,
    frequency: fixture.frequency,
    weeklyChargeDay: fixture.weeklyChargeDay,
    monthlyChargeDay: fixture.monthlyChargeDay,
    chargeFirstSunday: false,
    balance: 0,
    advanceBalance: 45,
    installmentsAgreed: 100,
    installmentsIssued: 11,
    installmentsPaid: 10,
    installmentsRemaining: 90,
    otherCharges: [],
    savings: 0,
    status: "activo",
    createdAt: "2026-01-01T12:00:00.000Z"
  };
  const payment = {
    id: `payment-${fixture.name}`,
    receiptNumber: `REC-${fixture.name}`,
    clientId: client.id,
    clientName: client.name,
    clientUnit: client.unitId,
    dateApplied: "2026-09-08",
    paymentMethod: "Efectivo",
    amountReceived: 15,
    appliedToRent: 0,
    centavosAhorro: 0,
    advanceApplied: 15,
    advanceBalanceAfter: 45,
    balanceBefore: 0,
    balanceAfter: 0,
    savingsBefore: 0,
    savingsAfter: 0,
    installmentsDeducted: 0,
    installmentsFromDebt: 0,
    installmentsFromAdvance: 0,
    installmentsPaidAfter: 10,
    installmentsRemainingAfter: 90,
    rentAmount: 30,
    frequency: fixture.frequency,
    weeklyChargeDay: fixture.weeklyChargeDay,
    monthlyChargeDay: fixture.monthlyChargeDay,
    chargeFirstSunday: false,
    createdAt: "2026-09-08T12:00:00.000Z"
  };

  const state = resolveFutureAdvanceReceiptState(payment, client);
  assert.equal(state.targetDate?.toISOString().slice(0, 10), fixture.expectedDate, `${fixture.name}: fecha objetivo`);
  assert.equal(state.accumulated, 15, `${fixture.name}: acumulado`);
  assert.equal(state.remaining, 15, `${fixture.name}: restante`);

  const text = renderToStaticMarkup(React.createElement(ReceiptCardContent, { payment, accountClient: client, format: "history" }))
    .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  assert.ok(text.includes(`Aplicado por adelantado a la cuota del ${fixture.single.toLowerCase()}.`), `${fixture.name}: banner\n${text}`);
  assert.ok(text.includes(`Cuota futura · ${fixture.cycle} Abono adelantado parcial Acumulado $15.00`), `${fixture.name}: aplicación\n${text}`);
  assert.ok(text.includes("Restante de la cuota futura Aún no está vencida $15.00"), `${fixture.name}: restante\n${text}`);
  assert.ok(text.includes(`Fecha límite de esta cuota ${fixture.single}`), `${fixture.name}: límite\n${text}`);
}

console.log("OK adelantos: diario, semanal, quincenal y mensual comparten cuota, acumulado, restante y fecha límite.");
