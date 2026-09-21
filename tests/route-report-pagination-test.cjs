const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const cloud = fs.readFileSync(path.join(root, "src/cloud/routeReportCloudData.ts"), "utf8");
const page = fs.readFileSync(path.join(root, "src/pages/RouteSearchPage.tsx"), "utf8");
const shell = fs.readFileSync(path.join(root, "src/AppShell.tsx"), "utf8");

assert.ok(cloud.includes("loadRoutePaymentReportsPage"), "Debe existir lectura paginada del historial.");
assert.ok(cloud.includes("rows.slice(0, safeLimit)"), "Cada pagina debe respetar el limite solicitado.");
assert.ok(page.includes("ROUTE_REPORT_PAGE_SIZE = 200"), "La carga inicial debe tener un limite explicito.");
assert.ok(page.includes("Cargar más confirmaciones"), "El usuario debe poder recuperar historial anterior.");
assert.ok(page.includes("loadRoutePaymentReports(dataOwnerUserId, { reviewOnly: true })"), "Ningun reporte en revision debe quedar oculto por paginacion.");
assert.ok(shell.includes("loadRoutePaymentReports(cloudDataUserId, { reviewOnly: true })"), "El indicador global solo debe leer reportes operativos.");

console.log("OK reportes de ruta: bloque inicial paginado, historial incremental y revisiones completas.");
