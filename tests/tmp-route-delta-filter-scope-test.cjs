const assert = require("node:assert/strict");
const fs = require("node:fs");

const source = fs.readFileSync("src/pages/RouteSearchPage.tsx", "utf8");
const card = fs.readFileSync("src/pages/RouteCollectionCard.tsx", "utf8");
const migration = fs.readFileSync("supabase/migrations/20261107000400_preserve_route_delta_across_routes.sql", "utf8");

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
assert.match(source, /assignedDelta: row\.assignedDelta \?\? \(route === "WC" \? "delta2" : undefined\)/, "Cambiar de ruta debe conservar el Delta ya asignado.");
assert.match(source, /delta1: workItems\.filter[\s\S]*delta2: workItems\.filter[\s\S]*delta3: workItems\.filter/, "Los conteos Delta deben incluir todas las rutas.");
assert.doesNotMatch(source, /if \(route !== "PTY"\) setAssignedDeltaFilter\(null\)/, "Filtrar CL, DARIEN o PENONOME no debe perder el Delta seleccionado.");
assert.match(card, /view === "work" \? \(/, "El responsable debe verse en carros de cualquier ruta.");
assert.match(card, /option value="delta2"/, "Administración debe poder asignar también Delta 2 fuera de una ruta fija.");
assert.match(migration, /Una asignación vigente sobrevive a cualquier cambio de ruta/, "El servidor debe preservar asignaciones al mover carros entre rutas.");
for (const unit of ["B91", "T06", "B12", "A46"]) assert.ok(migration.includes(`'${unit}'`), `Falta restaurar ${unit} a Delta 1.`);

console.log("OK alcance Delta: sesión, ruta y carros asignados quedan fijos; Administración conserva filtros.");
