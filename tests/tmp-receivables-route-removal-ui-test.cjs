const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const row = fs.readFileSync(path.join(root, "src/pages/receivables/ReceivableTableRow.tsx"), "utf8");
const page = fs.readFileSync(path.join(root, "src/pages/ReceivablesPage.tsx"), "utf8");
const cloud = fs.readFileSync(path.join(root, "src/cloud/operationsCloudData.ts"), "utf8");
const card = fs.readFileSync(path.join(root, "src/pages/RouteCollectionCard.tsx"), "utf8");
const route = fs.readFileSync(path.join(root, "src/pages/RouteSearchPage.tsx"), "utf8");

assert.match(row, /Ver en ruta[\s\S]*Sacar de ruta/, "La tarjeta debe ofrecer ambas acciones en el mismo canal.");
assert.match(row, /Confirmar salida[\s\S]*Los pagos y el historial se conservarán/, "La salida debe pedir confirmación y explicar su efecto.");
const managementBranch = row.slice(
  row.indexOf('if ((workflowTab as string) === "management")'),
  row.indexOf("function renderCutCell")
);
assert.match(
  managementBranch,
  /renderRouteRemovalModal\(\)/,
  "La vista Gestión debe renderizar la confirmación de salida antes de su retorno temprano."
);
assert.match(page, /removeCloudActiveRouteItemFromReceivables/, "Cuentas por cobrar debe usar la salida atómica.");
assert.match(cloud, /remove_active_route_item_from_receivables/, "La salida debe pasar por la RPC protegida.");
assert.doesNotMatch(card, /No permitido|delta1OnlyClient/, "Administración debe poder mover cualquier carro entre Delta 1, 2 y 3.");
assert.doesNotMatch(route, /isDelta1OnlyRouteClient/, "La pantalla no debe conservar excepciones fijas en Delta 1.");

console.log("OK UI: salida confirmada en Gestión y reasignación administrativa sin clientes bloqueados.");
