const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "src/pages/ReceivablesPage.tsx"), "utf8");

assert.match(source, /VITE_PERF_LOGS === "1"/, "Las mediciones deben ser optativas.");
for (const label of [
  "incident actions load",
  "street management load",
  "active route load",
  "fleet units load",
  "collection closures load",
  "latest payments load",
  "ledger calculation",
  "priority calculation"
]) {
  assert.ok(source.includes(`\"${label}\"`), `Falta medir: ${label}`);
}

console.log("OK observabilidad: cargas y calculo de cuentas por cobrar quedan medidos de forma optativa.");
