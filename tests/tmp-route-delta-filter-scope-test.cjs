const assert = require("node:assert/strict");
const fs = require("node:fs");

const source = fs.readFileSync("src/pages/RouteSearchPage.tsx", "utf8");
const card = fs.readFileSync("src/pages/RouteCollectionCard.tsx", "utf8");
const migration = fs.readFileSync("supabase/migrations/20261112000200_sync_delta_with_standard_route.sql", "utf8");

assert.match(
  source,
  /function matchesAssignedDelta[\s\S]*item\.assignedDelta === delta/,
  "Cada Delta debe ver sus carros asignados sin limitarse a una sola ruta."
);
assert.match(
  source,
  /const scopedRows = activeScopeDelta \? rows\.filter\(\(item\) => matchesAssignedDelta\(item, activeScopeDelta\)\) : rows/,
  "El alcance de la sesión Delta debe aplicarse a todas las vistas."
);
assert.match(source, /workflowView !== "managed" && !isDeltaScopeLocked/, "Los filtros para cambiar de Delta deben ocultarse cuando el alcance está bloqueado.");
assert.match(source, /routeFilterOptions\.length > 0/, "Cada Delta debe poder organizar sus propios carros por ruta.");
assert.match(source, /function assignedDeltaAfterRouteChange[\s\S]*route === "WC"[\s\S]*"delta2"[\s\S]*route === "PTY"[\s\S]*"delta1"/, "Cambiar de ruta debe sincronizar WC con Delta 2 y PTY con Delta 1.");
assert.match(source, /delta1: workItems\.filter[\s\S]*delta2: workItems\.filter[\s\S]*delta3: workItems\.filter/, "Los conteos Delta deben incluir todas las rutas.");
assert.doesNotMatch(source, /if \(route !== "PTY"\) setAssignedDeltaFilter\(null\)/, "Filtrar CL, DARIEN o PENONOME no debe perder el Delta seleccionado.");
assert.match(card, /view === "work" \? \(/, "El responsable debe verse en carros de cualquier ruta.");
assert.match(card, /option value="delta2"/, "Administración debe poder asignar también Delta 2 fuera de una ruta fija.");
assert.match(migration, /v_route_changed and v_default_delta is not null/, "El servidor debe recalcular el Delta cuando cambia una ruta estándar.");
assert.match(migration, /Con la misma ruta, una asignación válida \(incluida la manual\) se conserva/, "El servidor debe conservar una reasignación manual posterior.");

console.log("OK alcance Delta: WC/PTY sincronizan el Delta y Administración conserva la reasignación manual posterior.");
