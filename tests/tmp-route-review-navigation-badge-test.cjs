const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const shell = fs.readFileSync(path.join(root, "src/AppShell.tsx"), "utf8");
const navigation = fs.readFileSync(path.join(root, "src/app/AppNavigation.tsx"), "utf8");
const routePage = fs.readFileSync(path.join(root, "src/pages/RouteSearchPage.tsx"), "utf8");
const styles = fs.readFileSync(path.join(root, "src/styles.css"), "utf8");

assert(shell.includes("getRouteMenuAlertCounts"), "AppShell debe calcular pagos y custodias aunque Ruta en calle no este abierta.");
assert(shell.includes('table: "active_route_items_cloud"'), "La notificacion debe actualizarse con cambios de la ruta.");
assert(shell.includes("routeAlertCount={routeMenuAlertCount}"), "AppShell debe entregar el contador de alertas al menu.");
assert(navigation.includes('badge: routeAlertCount'), "Ruta en calle debe mostrar una insignia de alertas en el menu.");
assert(navigation.includes("gestiones pendientes"), "La insignia debe describir el total de gestiones pendientes.");
assert(routePage.includes("getActiveRouteReviewItems(items, payments, businessDateKey, reports, routeReviewIndex)"), "La pestaña debe usar la misma selección de pendientes que el menú.");
assert(routePage.includes("'Pagos por revisar', paymentReviewItems.length"), "La revisión debe usar una sola pestaña con el conteo combinado.");
assert(routePage.includes("route-search-workflow-tab--has-items"), "Las pestañas con trabajo deben activar su alerta visual.");
assert(styles.includes("route-search-workflow-tab--work.route-search-workflow-tab--has-items"), "Trabajo debe tener un color de alerta propio.");
assert(styles.includes("route-search-workflow-tab--custody.route-search-workflow-tab--has-items"), "Custodia debe tener un color de alerta propio.");

console.log("tmp-route-review-navigation-badge-test: ok");
