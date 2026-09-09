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
  rentAmount: 299, frequency: "biweekly", balance: 0, advanceBalance: 429, savings: 0.2,
  installmentsAgreed: 74, installmentsIssued: 12, installmentsPaid: 11, installmentsRemaining: 63,
  otherCharges: [], status: "activo", createdAt: "2026-04-29T09:40:47.468Z"
};
const payment = {
  id: "b01-rec-31334", receiptNumber: "REC-31334", clientId: client.id,
  clientName: client.name, clientUnit: "B01", dateApplied: "2026-09-08", paymentMethod: "Transferencia Bancaria",
  amountReceived: 10, appliedToRent: 0, centavosAhorro: 0, balanceBefore: 0, balanceAfter: 0,
  advanceApplied: 10, advanceBalanceAfter: 429, savingsBefore: 0.2, savingsAfter: 0.2, installmentsDeducted: 0,
  installmentsFromDebt: 0, installmentsFromAdvance: 0, installmentsPaidAfter: 11,
  installmentsRemainingAfter: 63, rentAmount: 299, frequency: "biweekly", createdAt: "2026-09-08T15:31:00.000Z"
};

assert.equal(findNextChargeDay(client, new Date("2026-09-08T12:00:00")).toISOString().slice(0, 10), "2026-09-30");
const text = renderToStaticMarkup(React.createElement(ReceiptCardContent, { payment, accountClient: client, format: "history" }))
  .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
assert.ok(text.includes("Aplicado por adelantado a la cuota del miércoles 30 de septiembre."), text);
assert.ok(text.includes("Cuota futura · Quincena 30 de septiembre Abono adelantado parcial Acumulado $130.00"), text);
assert.ok(text.includes("Restante de la cuota futura Aún no está vencida $169.00"), text);
assert.ok(text.includes("Fecha límite de esta cuota Miércoles 30 de septiembre"), text);
assert.ok(!text.includes("Quincena 15 de septiembre"), text);
assert.ok(!text.includes("Saldo pendiente $0.00"), text);
console.log("OK B01 REC-31334: aplicación, acumulado, restante y límite coinciden en la cuota del 30 de septiembre.");

// A counter mismatch must not skip unpaid days, with or without a partial advance.
const a84 = {...client,id:'a84',unitId:'A84',frequency:'daily',rentAmount:33,installmentsAgreed:913,installmentsIssued:97,installmentsPaid:95,installmentsRemaining:818,advanceBalance:3};
assert.equal(findNextChargeDay(a84,new Date('2026-09-09T12:00:00')).toISOString().slice(0,10),'2026-09-10');
const a84Payment={...payment,clientId:'a84',clientUnit:'A84',dateApplied:'2026-09-09',amountReceived:66,appliedToRent:63,balanceBefore:63,advanceApplied:3,advanceBalanceAfter:3,installmentsFromDebt:2,installmentsDeducted:2,installmentsPaidAfter:95,installmentsRemainingAfter:818,rentAmount:33,frequency:'daily'};
const a84Text=renderToStaticMarkup(React.createElement(ReceiptCardContent,{payment:a84Payment,accountClient:a84,format:'history'})).replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');
assert.ok(a84Text.includes('Jueves 10 de septiembre'),a84Text);
assert.ok(a84Text.includes('$30.00'),a84Text);
assert.ok(!a84Text.includes('Sábado 12'),a84Text);
assert.equal(findNextChargeDay({...a84,advanceBalance:36},new Date('2026-09-09T12:00:00')).toISOString().slice(0,10),'2026-09-11');
assert.equal(findNextChargeDay({...a84,advanceBalance:0,balance:63,installmentsPaid:93},new Date('2026-09-09T12:00:00')).toISOString().slice(0,10),'2026-09-10');
console.log('OK A84: actual advances determine future dates, independent of historical counters.');
