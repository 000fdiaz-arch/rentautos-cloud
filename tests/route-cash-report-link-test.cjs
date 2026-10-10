const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const shell = read("src/AppShell.tsx");
const routePage = read("src/pages/RouteSearchPage.tsx");
const migration = read("supabase/migrations/20261010000300_route_cash_report_link.sql");

assert.equal(migration, read("supabase/106-route-cash-report-link.sql"), "El script manual y la migración deben coincidir.");
assert(shell.includes("transaction.payment.routeReportId = input.reportId"), "El recibo debe guardar el identificador del reporte.");
assert(routePage.includes("reportId: savedReport.id"), "El efectivo inmediato debe enviar el identificador del reporte.");
assert(routePage.includes("reportId: paymentReport.id"), "El registro desde la cola debe enviar el identificador del reporte.");
assert(migration.includes("r.id::text = new.data->>'routeReportId'"), "Supabase debe vincular por identificador explícito.");
assert(migration.indexOf("r.id::text = new.data->>'routeReportId'") < migration.indexOf("Compatibilidad para pagos creados"), "El vínculo explícito debe preceder a la conciliación histórica.");
assert(migration.includes("p.updated_at >= v_report.reported_at"), "La reparación debe usar la hora real de llegada a Supabase.");
assert(migration.includes("interval '5 minutes'"), "La reparación debe limitar la tolerancia de reloj.");

console.log("OK efectivo de Ruta: recibo y aviso se vinculan por ID sin depender del reloj.");
