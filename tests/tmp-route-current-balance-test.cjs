const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const routePage = fs.readFileSync(path.join(root, "src/pages/RouteSearchPage.tsx"), "utf8");
const routeCard = fs.readFileSync(path.join(root, "src/pages/RouteCollectionCard.tsx"), "utf8");
const appShell = fs.readFileSync(path.join(root, "src/AppShell.tsx"), "utf8");

assert(routePage.includes("clients: Client[]"), "Ruta en calle debe recibir los clientes actualizados.");
assert(routePage.includes("currentBalanceByClient.get(item.clientId) ?? item.overdueBalance"), "Debe usar el saldo actual y conservar el saldo publicado solo como respaldo.");
assert.equal((routePage.match(/<small>Saldo vencido<\/small>/g) ?? []).length + (routeCard.match(/<dt>Saldo vencido<\/dt>/g) ?? []).length, 2, "La tarjeta y la imagen compartida deben identificar el saldo vencido.");
assert(appShell.includes("clients={clients}"), "AppShell debe entregar los clientes actuales a Ruta en calle.");
assert(routeCard.includes("<dt>En ruta</dt><dd>{when(item.publishedAt)}</dd>"), "La fecha de inicio debe mostrarse con una etiqueta breve y clara.");
assert(!routeCard.includes("En calle"), "No debe conservar la etiqueta anterior En calle.");

console.log("tmp-route-current-balance-test: ok");
