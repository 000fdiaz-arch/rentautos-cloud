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
assert.match(page, /removeCloudActiveRouteItemFromReceivables/, "Cuentas por cobrar debe usar la salida atómica.");
assert.match(cloud, /remove_active_route_item_from_receivables/, "La salida debe pasar por la RPC protegida.");
assert.match(card, /delta1OnlyClient[\s\S]*Delta 3[\s\S]*No permitido/, "La tarjeta de Ruta debe bloquear Delta 3 para clientes protegidos.");
assert.match(route, /delta === "delta3" && isDelta1OnlyRouteClient/, "La pantalla debe rechazar también el cambio programático a Delta 3.");

console.log("OK UI: salida confirmada en Gestión y restricción visible de Delta 3.");
