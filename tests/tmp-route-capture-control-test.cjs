const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const migration = read("supabase/migrations/20261013000100_route_capture_control.sql");
const scope = read("src/routeOperatorScope.ts");
const page = read("src/pages/RouteSearchPage.tsx");
const summary = read("src/pages/RouteCaptureSummary.tsx");
const cloud = read("src/cloud/routeCaptureCloudData.ts");

assert.match(scope, /delta3@auth\.rentautos\.local["']:\s*["']PTY/,
  "Delta 3 debe quedar asignado a PTY.");
assert.match(migration, /create table if not exists public\.route_capture_events/,
  "Debe existir un historial durable de captaciones.");
assert.match(migration, /create table if not exists public\.route_runs/,
  "Cada salida debe tener un inicio, cierre y confirmación propios.");
assert.match(migration, /'captureEventId', v_capture_id/,
  "El historial de custodia debe enlazar la captación creada.");
assert.match(migration, /auth\.uid\(\)/,
  "La identidad del Delta debe provenir de la sesión autenticada.");
assert.match(migration, /public\.is_admin\(\)/,
  "La confirmación debe estar restringida al administrador.");
assert.match(migration, /create or replace function public\.start_route_run[\s\S]*create or replace function public\.submit_route_run[\s\S]*create or replace function public\.confirm_route_run/,
  "La ruta debe poder iniciarse, cerrarse y confirmarse.");
assert.match(migration, /route_assignment/,
  "La captación debe conservar una copia de la ruta reportada.");
assert.match(page, /canConfirmCaptures/,
  "Ruta en calle debe distinguir quién puede confirmar captaciones.");
assert.match(page, /Registrar captación/,
  "La acción de custodia debe presentarse como registro de captación.");
assert.match(summary, /Delta 1[\s\S]*Delta 2[\s\S]*Delta 3/,
  "El resumen debe separar los tres Delta.");
for (const action of ["Iniciar ruta", "Cerrar y enviar", "Confirmar ruta"]) {
  assert.ok(summary.includes(action), `La pantalla debe mostrar la acción ${action}.`);
}
assert.match(cloud, /rpc\("confirm_route_capture"/,
  "El frontend debe confirmar mediante la función protegida.");

console.log("OK captaciones: Delta 3 en PTY, atribución por sesión y confirmación administrativa.");
