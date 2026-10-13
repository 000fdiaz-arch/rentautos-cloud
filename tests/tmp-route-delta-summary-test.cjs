const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const page = read("src/pages/RouteSearchPage.tsx");
const summary = read("src/pages/RouteTeamSummary.tsx");
const card = read("src/pages/RouteCollectionCard.tsx");
const managed = read("src/pages/RouteManagedList.tsx");
const tracking = read("src/routeDeltaTracking.ts");
const styles = read("src/styles.css");

for (const delta of ["delta1", "delta2", "delta3"]) {
  assert.ok(tracking.includes(`key: "${delta}"`), `Falta ${delta} en el resumen.`);
}
for (const column of ["Recibidas", "Cobrado", "Custodia", "Ausente"]) {
  assert.ok(summary.includes(`>${column}<`), `Falta la columna ${column}.`);
}
assert.doesNotMatch(summary, /Confirmación|Confirmados/, "El nuevo resumen no debe incluir confirmación.");
assert.match(page, /route-search-route-totals/, "Deben mostrarse los conteos superiores por ruta.");
assert.match(page, /toggleRouteFilter/, "Los conteos de ruta deben filtrar la pantalla.");
assert.match(page, /current === delta \? null : delta/, "El segundo toque del Delta debe volver a todos los datos.");
assert.match(page, /'managed', 'Gestionados hoy'/, "Debe existir la vista de carros gestionados hoy.");
assert.match(page, /RouteManagedList actions=\{visibleManagedActions\}/, "La vista gestionada debe usar el formato listado.");
assert.match(card, /Declarar carro en custodia/, "La acción debe usar el texto aprobado.");
assert.match(page, /'custody', 'En custodia'/, "La pestaña debe llamarse En custodia.");
assert.doesNotMatch(page, /route-time-alert-summary/, "El panel de próxima atención y urgente debe eliminarse.");
assert.match(tracking, /report\.reported_by/, "Los cobros deben atribuirse al usuario que los reportó.");
assert.match(tracking, /capture\.reported_by/, "La custodia debe atribuirse al usuario que la declaró.");
assert.match(tracking, /item\.routeInactiveBy/, "Las ausencias deben atribuirse al usuario que las marcó.");
assert.match(tracking, /const byCar = new Map<string, RouteManagedAction>/, "El resumen debe consolidar los movimientos por carro.");
assert.match(tracking, /current\.cashAmount \+= action\.cashAmount/, "Los abonos sucesivos del carro deben acumularse sin duplicarlo.");
assert.match(summary, /Carros únicos gestionados hoy por Delta/, "El resumen debe aclarar que cuenta carros únicos.");
assert.match(managed, /route-managed-payment/, "El listado debe separar efectivo y transferencia.");
assert.match(styles, /@media \(max-width: 600px\)[\s\S]*route-managed-row/, "El listado debe adaptarse a celulares.");
assert.match(styles, /@media \(min-width: 601px\) and \(max-width: 900px\)/, "El listado debe adaptarse a tablets.");

console.log("OK Ruta en calle: resumen Delta, filtros coordinados, listas responsivas y custodia aprobada.");
