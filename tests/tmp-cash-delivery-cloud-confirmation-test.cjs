const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const appShell = fs.readFileSync(path.join(root, "src", "AppShell.tsx"), "utf8");
const dailyIncome = fs.readFileSync(path.join(root, "src", "pages", "payments", "DailyIncomePanel.tsx"), "utf8");

function functionBody(source, name) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `No se encontro ${name}.`);
  const braceStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(braceStart, index + 1);
  }
  throw new Error(`No se pudo leer ${name}.`);
}

const persistPayments = functionBody(appShell, "persistPayments");
assert.match(persistPayments, /await syncCoreDeltaOrQueue\(previousClients, previousClients, previousPayments, next\);/);
assert.match(persistPayments, /catch \(error\)[\s\S]*setPayments\(previousPayments\);[\s\S]*throw error;/);

const saveDelivery = functionBody(dailyIncome, "saveDelivery");
assert.match(saveDelivery, /setIsDeliverySaving\(true\);[\s\S]*await onPaymentsChange\(nextPayments\);/);
assert.match(saveDelivery, /catch \(error\)[\s\S]*setDeliveryError\("No se pudo guardar la entrega en la nube\./);
assert.match(dailyIncome, /isDeliverySaving \? "Guardando…" : "Guardar entrega"/);

console.log("OK entrega de efectivo: espera confirmacion cloud, revierte al fallar y permite reintentar.");
