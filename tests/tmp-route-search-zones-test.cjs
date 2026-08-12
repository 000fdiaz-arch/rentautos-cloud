const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const routePage = fs.readFileSync(path.join(root, "src", "pages", "RouteSearchPage.tsx"), "utf8");
const receivablesPage = fs.readFileSync(path.join(root, "src", "pages", "ReceivablesPage.tsx"), "utf8");
const cloudData = fs.readFileSync(path.join(root, "src", "cloud", "operationsCloudData.ts"), "utf8");
const migration = fs.readFileSync(path.join(root, "supabase", "57-active-route-zones.sql"), "utf8");

assert(cloudData.includes("zone?: string;"), "La zona debe formar parte del registro activo.");
assert(cloudData.includes('client.rpc("update_active_route_zone"'), "La zona debe guardarse mediante el RPC limitado.");

assert(routePage.includes('const ALL_ACTIVE_ZONE_FILTER = "__all_zones__"'), "Debe existir el filtro secundario de zona.");
assert(routePage.includes('label: "Sin zona"'), "El filtro debe incluir Sin zona.");
assert(routePage.includes("Todas ({selectedRouteItems.length})"), "Todas las zonas debe mostrar su cantidad.");
assert(routePage.includes("item.zone ?? \"\""), "La busqueda debe incluir la zona.");
assert(routePage.includes("maxLength={40}"), "La zona debe limitarse a 40 caracteres.");
assert(routePage.includes("onBlur={() => void commitZone(item)}"), "La zona debe guardarse al salir del campo.");
assert(routePage.includes('event.key !== "Enter"'), "La zona debe guardarse con Enter.");
assert(routePage.includes("group.zoneLabel ? ` · Zona ${group.zoneLabel}`"), "La imagen compartida debe identificar la zona filtrada.");

const routeClearPattern = /zone:\s*activeRouteFilterValue\(item\.routeAssignment\) === activeRouteFilterValue\([^)]+\)[\s\S]{0,100}\? item\.zone[\s\S]{0,30}: undefined/g;
assert((receivablesPage.match(routeClearPattern) ?? []).length >= 2, "Los dos editores de ruta deben limpiar la zona cuando cambia la ruta.");

assert(migration.includes("security definer"), "El guardado restringido debe funcionar para perfiles de consulta.");
assert(migration.includes("public.can_view_owner_screen(p_user_id, 'route_search')"), "Solo usuarios con acceso a Ruta en calle pueden editar zonas.");
assert(migration.includes("data - 'zone'"), "Vaciar el campo debe eliminar la zona.");
assert(migration.includes("char_length(v_zone) > 40"), "La base debe validar el limite de la zona.");
assert(migration.includes("data ->> 'routeAssignment'"), "El guardado debe rechazar una ruta que cambio mientras se editaba.");

console.log("Route search zones source checks passed.");
