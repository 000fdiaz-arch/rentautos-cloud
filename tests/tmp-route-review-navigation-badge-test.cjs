const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const shell = fs.readFileSync(path.join(root, "src/AppShell.tsx"), "utf8");
const navigation = fs.readFileSync(path.join(root, "src/app/AppNavigation.tsx"), "utf8");
const routePage = fs.readFileSync(path.join(root, "src/pages/RouteSearchPage.tsx"), "utf8");

assert(shell.includes("countActiveRouteReviewItems"), "AppShell debe calcular las revisiones aunque Ruta en calle no este abierta.");
assert(shell.includes('table: "active_route_items_cloud"'), "La notificacion debe actualizarse con cambios de la ruta.");
assert(shell.includes("routeReviewCount={routeReviewCount}"), "AppShell debe entregar el contador al menu.");
assert(navigation.includes('badge: routeReviewCount'), "Ruta en calle debe mostrar una insignia en el menu.");
assert(navigation.includes("unidades pendientes de revision"), "La insignia debe explicar la accion pendiente.");
assert(routePage.includes("getActiveRouteReviewItems(items, payments, businessDateKey, reports)"), "La pestaña debe usar la misma selección de pendientes que el menú.");
assert(routePage.includes("'Pagos parciales a revisar', partialReviewItems.length"), "La revisión debe ser una pestaña con su conteo.");

console.log("tmp-route-review-navigation-badge-test: ok");
