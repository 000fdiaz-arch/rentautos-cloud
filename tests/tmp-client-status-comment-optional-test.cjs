const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const pageSource = fs.readFileSync(path.join(root, "src/pages/ClientsPage.tsx"), "utf8");
const dialogsSource = fs.readFileSync(path.join(root, "src/pages/clients/ClientsDialogs.tsx"), "utf8");

const selectionStart = pageSource.indexOf("function handleStatusSelection");
const selectionEnd = pageSource.indexOf("function handleCreateClientFromUnit", selectionStart);
const selectionSource = pageSource.slice(selectionStart, selectionEnd);

assert(selectionStart >= 0 && selectionEnd > selectionStart, "Debe existir el flujo de cambio de estado del cliente.");
assert.match(
  selectionSource,
  /applyClientStatusThroughFleet\(client, nextStatus, ""\)/,
  "Todos los estados deben guardarse directamente sin exigir comentario."
);
assert.doesNotMatch(pageSource, /requiresComment|statusDialog|StatusChangeDialog/);
assert.doesNotMatch(dialogsSource, /StatusChangeDialog|indica el motivo/);

console.log("OK clientes: cambio de estado directo sin comentario obligatorio.");
