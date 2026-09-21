const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const ledger = fs.readFileSync(path.join(root, "src/pages/receivables/ReceivablesLedgerTable.tsx"), "utf8");
const page = fs.readFileSync(path.join(root, "src/pages/ReceivablesPage.tsx"), "utf8");

assert.ok(ledger.includes("function useStableEvent"), "La tabla debe entregar callbacks estables a cada fila.");
assert.ok(ledger.includes("handlerRef.current = handler"), "El callback estable debe invocar siempre la logica mas reciente.");
assert.ok(ledger.includes("collectionCutItemsByClient = useMemo"), "Los objetos de cortes no deben recrearse por fila en cada render.");
assert.ok(!ledger.includes("collectionCutItems={getCutItemsForClient"), "La fila no debe recibir un objeto nuevo en cada render.");
assert.ok(
  page.includes("return whatsAppGroupRowsByClient.get(row.id);") && page.includes("return statementGroupRowsByClient.get(row.id);"),
  "Los grupos unitarios no deben crear arreglos nuevos en cada render."
);

console.log("OK render: filas conservan callbacks y propiedades estables sin capturar estado obsoleto.");
