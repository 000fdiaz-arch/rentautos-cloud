const assert = require("node:assert/strict");
const fs = require("node:fs");

const page = fs.readFileSync("src/pages/RouteSearchPage.tsx", "utf8");
const card = fs.readFileSync("src/pages/RouteCollectionCard.tsx", "utf8");
const cloud = fs.readFileSync("src/cloud/operationsCloudData.ts", "utf8");

assert.match(page, /useState<PtyAssignedDelta \| null>\(signedInPtyDelta\)/, "La sesión de Delta 1 o Delta 3 debe iniciar en Mi ruta.");
assert.match(page, /signedInPtyDelta === delta \? "Mis carros"/, "Cada buscador debe reconocer claramente su lista.");
assert.doesNotMatch(page, />Todos PTY \(/, "La barra Delta no debe duplicar el filtro general de la ruta PTY.");
assert.match(page, /\["delta1", "delta2", "delta3"\]/, "Delta 2 debe estar disponible como asignación de contingencia.");
assert.match(page, /route-search-delta-toolbar[\s\S]*Filtrar por ruta y zona/, "Delta debe quedar justo encima del filtro por Ruta y Zona.");
assert.match(page, /Editar · Solo Administración/, "La interfaz debe explicar quién puede editar incluso cuando el control está bloqueado.");
assert.match(page, /Organizar carros PTY/, "Un editor debe tener un acceso central y visible para reasignar.");
assert.match(page, /Cambiar responsable de \$\{item\.unitId\}/, "El administrador debe poder cambiar cada unidad desde una lista central.");
assert.match(page, /matchesPtyAssignedDelta\(item, assignedDeltaFilter\)/, "La lista debe respetar el filtro de asignación PTY.");
assert.match(card, /Buscador asignado a \$\{item\.unitId\}/, "El editor debe tener un selector por carro.");
assert.match(card, /props\.canEditAssignedDelta \? <label/, "El selector no debe mostrarse como editable a los buscadores.");
assert.match(card, /aria-label={`Ruta de \$\{item\.unitId\}`}/, "Debe conservarse la posibilidad de cambiar cada carro de ruta.");
assert.match(cloud, /change_active_route_delta_assignment/, "La edición debe pasar por la RPC protegida.");

console.log("OK UI PTY: Delta 2 disponible, sin botón Todos PTY y edición protegida por permisos.");
