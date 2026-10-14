const assert = require("node:assert/strict");
const fs = require("node:fs");

const source = fs.readFileSync("src/pages/RouteSearchPage.tsx", "utf8");

assert.match(
  source,
  /activeRouteFilterValue\(item\.routeAssignment\) === "PTY" && item\.assignedDelta === delta/,
  "Delta 1 y Delta 3 deben mostrar solamente sus unidades PTY asignadas."
);
assert.match(
  source,
  /setRouteFilter\(nextDelta && deltaRoute \? activeRouteFilterValue\(deltaRoute\) : ALL_ACTIVE_ROUTE_FILTER\)/,
  "El resumen de cada Delta debe limitar la lista a la ruta correspondiente."
);

console.log("OK filtro Delta: excluye WC de Delta 1 y Delta 3 y respeta la ruta del equipo.");
