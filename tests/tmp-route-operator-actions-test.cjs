const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const routePage = fs.readFileSync(path.join(root, "src/pages/RouteSearchPage.tsx"), "utf8");
const appShell = fs.readFileSync(path.join(root, "src/AppShell.tsx"), "utf8");
const cloudData = fs.readFileSync(path.join(root, "src/cloud/operationsCloudData.ts"), "utf8");
const migration = fs.readFileSync(path.join(root, "supabase/62-route-operator-actions.sql"), "utf8");

assert(routePage.includes("Pago parcial · Decisión pendiente"), "El operador debe recibir una decision pendiente por cada pago parcial.");
assert(routePage.includes('"Debe pagar más"'), "El operador debe poder marcar explicitamente que la unidad debe pagar mas.");
assert(routePage.includes("Decisión: Debe pagar más"), "La decision tomada debe quedar visible en la tarjeta.");
assert(routePage.includes("Sacar de ruta"), "La tarjeta debe permitir sacar la unidad de la ruta.");
assert(routePage.includes("route-search-remove-button--head"), "Sacar de ruta debe estar ubicado junto a la unidad y el nombre.");
assert(routePage.includes("saveCloudActiveRouteComment"), "El operador debe poder guardar comentarios desde Ruta en calle.");
assert(routePage.includes('maxLength={25}'), "El comentario debe conservar el limite de Gestion.");
assert(appShell.includes('canRemoveFromRoute={canEditRouteSearch}'), "Las acciones deben habilitarse para cualquier usuario con permiso de editar Ruta en calle.");
assert(!routePage.includes("Solo el operador"), "La interfaz no debe restringir las decisiones por rol.");
assert(cloudData.includes('"route_editor_removed"'), "El modelo debe reconocer la salida realizada por un editor de Ruta en calle.");
assert(routePage.includes('removedReason: "route_editor_removed"'), "La salida debe quedar identificada como accion de un editor de ruta.");
assert(!migration.includes("current_user_role() <> 'operador'"), "Supabase no debe restringir las acciones por rol.");
assert(migration.includes("public.can_edit_owner_screen(p_user_id, 'route_search')"), "Las acciones deben respetar el permiso de edicion de Ruta en calle.");
assert(migration.includes("keep_active_route_item_after_partial_payment"), "La decision de mantener debe persistirse en Supabase.");
assert(cloudData.includes("partialDecisionRentAmount"), "La decision debe asociarse al monto parcial vigente.");

console.log("tmp-route-operator-actions-test: ok");
