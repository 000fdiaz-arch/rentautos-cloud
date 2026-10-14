const assert = require("node:assert/strict");
const fs = require("node:fs");

const page = fs.readFileSync("src/pages/RouteSearchPage.tsx", "utf8");
const card = fs.readFileSync("src/pages/RouteCollectionCard.tsx", "utf8");
const cloud = fs.readFileSync("src/cloud/operationsCloudData.ts", "utf8");
const migration = fs.readFileSync("supabase/migrations/20261014000300_route_wc_fixed_delta2.sql", "utf8");

assert.match(page, /useState<AssignedDelta \| null>\(signedInAssignedDelta\)/, "Cada sesión Delta debe iniciar en su lista.");
assert.match(page, /signedInAssignedDelta === delta \? "Mis carros"/, "Cada buscador debe reconocer claramente su lista.");
assert.doesNotMatch(page, />Todos PTY \(/, "La barra Delta no debe duplicar el filtro general de la ruta PTY.");
assert.match(page, /\["delta1", "delta2", "delta3"\]/, "Delta 2 debe estar disponible como filtro fijo de WC.");
assert.match(page, /route-search-delta-toolbar[\s\S]*Filtrar por ruta y zona/, "Delta debe quedar justo encima del filtro por Ruta y Zona.");
assert.match(page, /Editar · Solo Administración/, "La interfaz debe explicar quién puede editar incluso cuando el control está bloqueado.");
assert.match(page, /Organizar carros PTY/, "Un editor debe tener un acceso central y visible para reasignar.");
assert.match(page, /Cambiar responsable de \$\{item\.unitId\}/, "El administrador debe poder cambiar cada unidad desde una lista central.");
assert.match(page, /delta === "delta2" \? "WC" : "PTY"/, "Delta 2 debe filtrar WC y Delta 1/3 deben filtrar PTY.");
assert.match(page, /matchesAssignedDelta\(item, assignedDeltaFilter\)/, "La lista debe respetar el filtro de asignación por ruta.");
assert.match(card, /Buscador asignado a \$\{item\.unitId\}/, "El editor debe tener un selector por carro.");
assert.match(card, /props\.canEditAssignedDelta \? <label/, "El selector no debe mostrarse como editable a los buscadores.");
assert.match(page, /canEditAssignedDelta = !readOnly && signedInDelta === null/, "Una sesión Delta nunca debe editar al responsable de búsqueda.");
assert.match(migration, /current_user_role\(\)::text = 'buscador'/, "La base debe bloquear la reasignación aunque un buscador intente invocar la RPC.");
assert.match(card, /aria-label={`Ruta de \$\{item\.unitId\}`}/, "Debe conservarse la posibilidad de cambiar cada carro de ruta.");
assert.match(cloud, /change_active_route_delta_assignment/, "La edición debe pasar por la RPC protegida.");

console.log("OK UI rutas: Delta 2 filtra WC, sin botón Todos PTY y edición protegida por permisos.");
