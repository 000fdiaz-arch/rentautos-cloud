const assert = require("node:assert/strict");
const fs = require("node:fs");

const source = fs.readFileSync("src/pages/RouteSearchPage.tsx", "utf8");

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

console.log("OK alcance Delta: sesión, ruta y carros asignados quedan fijos; Administración conserva filtros.");
