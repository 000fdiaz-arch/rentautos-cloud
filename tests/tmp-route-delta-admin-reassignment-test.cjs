const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const migration = fs.readFileSync(path.join(root, "supabase/migrations/20261107000600_allow_admin_delta_reassignment.sql"), "utf8");
const card = fs.readFileSync(path.join(root, "src/pages/RouteCollectionCard.tsx"), "utf8");
const page = fs.readFileSync(path.join(root, "src/pages/RouteSearchPage.tsx"), "utf8");

assert.match(migration, /is_delta1_only_route_client_name[\s\S]*select false/, "Supabase debe retirar la excepción fija en Delta 1.");
assert.match(migration, /assignedDeltaMode'[\s\S]*client-fixed/, "La migración debe retirar la marca fija existente sin mover carros automáticamente.");
assert.match(migration, /when v_route = 'WC' then 'delta2'[\s\S]*when v_route = 'PTY' then 'delta1'/, "WC debe iniciar en Delta 2 y PTY en Delta 1.");
assert.match(migration, /v_current = 'delta2'[\s\S]*return new/, "Una excepción manual de Delta 2 sobre PTY debe conservarse.");
for (const delta of ["delta1", "delta2", "delta3"]) {
  assert.match(card, new RegExp(`<option value="${delta}">Delta ${delta.slice(-1)}</option>`), `La tarjeta debe permitir ${delta}.`);
  assert.match(page, new RegExp(`<option value="${delta}">Delta ${delta.slice(-1)}</option>`), `El organizador debe permitir ${delta}.`);
}
assert.doesNotMatch(card, /No permitido/, "La tarjeta no debe mostrar opciones bloqueadas por cliente.");
assert.doesNotMatch(page, /debe permanecer asignado a Delta 1/, "La pantalla no debe rechazar la reasignación administrativa.");

console.log("OK Delta: WC inicia en Delta 2, PTY en Delta 1 y Administración puede crear excepciones por carro.");
