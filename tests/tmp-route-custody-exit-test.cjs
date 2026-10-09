const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const routePage = fs.readFileSync(path.join(root, "src/pages/RouteSearchPage.tsx"), "utf8");
const routeCard = fs.readFileSync(path.join(root, "src/pages/RouteCollectionCard.tsx"), "utf8");
const migration = fs.readFileSync(path.join(root, "supabase/migrations/20261009000100_route_custody_exit.sql"), "utf8");
const manualMigration = fs.readFileSync(path.join(root, "supabase/104-route-custody-exit.sql"), "utf8");

assert(
  routeCard.includes('canRemove && props.hasActiveRoute && (!report || view === "partial")'),
  "Una unidad activa en custodia debe ofrecer Sacar de ruta a un editor."
);
assert(
  routePage.includes("item.inCustody && !item.removedAt"),
  "El tab de custodia no debe mostrar unidades retiradas."
);
assert(
  routePage.includes("inCustody: false, custodySince: undefined, removedAt"),
  "La actualizacion optimista debe cerrar la custodia."
);
assert(
  migration.includes("in_custody = false") && migration.includes("custody_since = null"),
  "La salida de ruta debe cerrar la custodia en la misma transaccion."
);
assert(
  migration.includes("custody_history = case") && migration.includes("'reason', 'route_removed'"),
  "La salida debe conservar evidencia en el historial de custodia."
);
assert(
  migration.includes("public.can_edit_owner_screen(p_user_id, 'route_search')"),
  "Sacar de ruta debe conservar el permiso de edicion de Ruta en calle."
);
assert.equal(manualMigration, migration, "La migracion manual y la version desplegable deben mantenerse iguales.");

console.log("tmp-route-custody-exit-test: ok");
