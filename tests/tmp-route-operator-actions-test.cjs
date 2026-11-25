const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const routePage = fs.readFileSync(path.join(root, "src/pages/RouteSearchPage.tsx"), "utf8");
const routeCard = fs.readFileSync(path.join(root, "src/pages/RouteCollectionCard.tsx"), "utf8");
const appShell = fs.readFileSync(path.join(root, "src/AppShell.tsx"), "utf8");
const app = fs.readFileSync(path.join(root, "src/App.tsx"), "utf8");
const permissions = fs.readFileSync(path.join(root, "src/auth/permissions.ts"), "utf8");
const cloudData = fs.readFileSync(path.join(root, "src/cloud/operationsCloudData.ts"), "utf8");
const migration = fs.readFileSync(path.join(root, "supabase/62-route-operator-actions.sql"), "utf8");
const removalGuard = fs.readFileSync(path.join(root, "supabase/migrations/20261112000100_route_delta_removal_guard.sql"), "utf8");

assert(routeCard.includes("Decisión pendiente"), "El operador debe recibir una decision pendiente por cada pago parcial.");
assert(routeCard.includes('>Debe pagar más</button>'), "El operador debe poder marcar explicitamente que la unidad debe pagar mas.");
assert(routeCard.includes("Decisión: Debe pagar más"), "La decision tomada debe quedar visible en la tarjeta.");
assert(routeCard.includes("Sacar de ruta"), "La tarjeta debe permitir sacar la unidad de la ruta.");
assert(routeCard.includes("route-collection-remove"), "Sacar de ruta debe estar disponible en la tarjeta de la unidad.");
assert(routePage.includes("saveCloudActiveRouteComment"), "El operador debe poder guardar comentarios desde Ruta en calle.");
assert(routeCard.includes('maxLength={25}'), "El comentario debe conservar el limite de Gestion.");
assert(appShell.includes('canRemoveFromRoute={canRemoveRouteItems}'), "La salida de Ruta debe usar un permiso separado de la edición general.");
assert(app.includes('canRemoveActiveRouteItem(authProfile.role, authProfile.permissions)'), "La interfaz debe calcular el retiro usando también el rol efectivo.");
assert.match(permissions, /canRemoveActiveRouteItem[\s\S]*role !== "buscador"/, "Los buscadores no deben recibir permiso para sacar autos.");
assert(!routePage.includes("Solo el operador"), "La interfaz no debe restringir las decisiones por rol.");
assert(cloudData.includes('"route_editor_removed"'), "El modelo debe reconocer la salida realizada por un editor de Ruta en calle.");
assert(cloudData.includes("removedBy?: string"), "El modelo debe conservar el autor del retiro.");
assert(routePage.includes('removedReason: "route_editor_removed"'), "La salida debe quedar identificada como accion de un editor de ruta.");
assert(!migration.includes("current_user_role() <> 'operador'"), "Supabase no debe restringir las acciones por rol.");
assert(migration.includes("public.can_edit_owner_screen(p_user_id, 'route_search')"), "Las acciones deben respetar el permiso de edicion de Ruta en calle.");
assert.match(removalGuard, /current_user_role\(\)::text = 'buscador'/, "Supabase debe bloquear el retiro aunque un Delta tenga edición general.");
assert.match(removalGuard, /'\{removedBy\}'[\s\S]*to_jsonb\(auth\.uid\(\)\)/, "Supabase debe auditar quién retiró la unidad.");
assert(migration.includes("keep_active_route_item_after_partial_payment"), "La decision de mantener debe persistirse en Supabase.");
assert(cloudData.includes("partialDecisionRentAmount"), "La decision debe asociarse al monto parcial vigente.");

console.log("tmp-route-operator-actions-test: ok");
