import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "../.tmp/lead-portal-tests/node_modules/@electric-sql/pglite/dist/index.js";

const db = new PGlite();
const owner = "11111111-1111-4111-8111-111111111111";
const migrationPath = "supabase/migrations/20260926000100_provisional_rental_fleet_integrity.sql";
const migration = readFileSync(migrationPath, "utf8");

assert.equal(migration, readFileSync("supabase/89-provisional-rental-fleet-integrity.sql", "utf8"));

await db.exec(`
  create table public.clients_cloud (
    user_id uuid not null,
    id text not null,
    data jsonb not null,
    updated_at timestamptz not null default now(),
    primary key (user_id, id)
  );
  create table public.fleet_units_cloud (
    user_id uuid not null,
    unit_id text not null,
    operational_status text,
    retired_at timestamptz,
    updated_at timestamptz not null default now(),
    primary key (user_id, unit_id)
  );
`);

await db.query(
  `insert into public.fleet_units_cloud (user_id, unit_id, operational_status) values
    ($1, 'D29', 'taller'),
    ($1, 'D52', 'provisional_rental'),
    ($1, 'D53', 'libre'),
    ($1, 'D54', 'provisional_rental')`,
  [owner]
);
await db.query(
  `insert into public.clients_cloud (user_id, id, data, updated_at) values
    ($1, 'd29', $2::jsonb, '2026-09-26T14:20:33Z'),
    ($1, 'd54', $3::jsonb, '2026-09-26T14:20:34Z')`,
  [
    owner,
    JSON.stringify({ id: "d29", unitId: "D29", name: "Cliente D29", status: "taller" }),
    JSON.stringify({ id: "d54", unitId: "D54", name: "Cliente D54", status: "taller" })
  ]
);

await db.exec(migration);

async function fleetStatus(unitId) {
  const result = await db.query(
    "select operational_status from public.fleet_units_cloud where user_id = $1 and unit_id = $2",
    [owner, unitId]
  );
  return result.rows[0]?.operational_status;
}

assert.equal(await fleetStatus("D52"), "libre", "la migracion debe liberar un provisional sin cliente");
assert.equal(await fleetStatus("D54"), "taller", "un provisional huerfano con cliente regular recupera su estado");

await db.query(
  "update public.clients_cloud set data = data || $2::jsonb where user_id = $1 and id = 'd29'",
  [owner, JSON.stringify({ activeProvisionalRental: { id: "rental-1", unitId: "D52" } })]
);
assert.equal(await fleetStatus("D52"), "provisional_rental", "asignar el alquiler debe marcar la flota");

await db.query(
  "update public.clients_cloud set data = jsonb_set(data, '{status}', to_jsonb('taller'::text)) where user_id = $1 and id = 'd29'",
  [owner]
);
const preserved = await db.query(
  "select data #>> '{activeProvisionalRental,unitId}' as unit_id from public.clients_cloud where user_id = $1 and id = 'd29'",
  [owner]
);
assert.equal(preserved.rows[0].unit_id, "D52", "cambiar D29 a Taller debe conservar el alquiler");
assert.equal(await fleetStatus("D52"), "provisional_rental");

await db.query(
  "update public.clients_cloud set data = jsonb_set(data, '{activeProvisionalRental,unitId}', to_jsonb('D53'::text)) where user_id = $1 and id = 'd29'",
  [owner]
);
assert.equal(await fleetStatus("D52"), "libre", "cambiar de provisional debe liberar la unidad anterior");
assert.equal(await fleetStatus("D53"), "provisional_rental", "cambiar de provisional debe marcar la unidad nueva");

await db.query(
  "update public.clients_cloud set data = data - 'activeProvisionalRental' where user_id = $1 and id = 'd29'",
  [owner]
);
assert.equal(await fleetStatus("D53"), "libre", "una escritura que retire el vinculo no debe dejar un estado huerfano");

await db.query(
  "update public.clients_cloud set data = data || $2::jsonb where user_id = $1 and id = 'd29'",
  [owner, JSON.stringify({ activeProvisionalRental: { id: "rental-2", unitId: "D52" } })]
);
await db.query("delete from public.clients_cloud where user_id = $1 and id = 'd29'", [owner]);
assert.equal(await fleetStatus("D52"), "libre", "eliminar el cliente debe liberar el provisional");

console.log("OK DB alquiler provisional: reparacion, asignacion, cambio de estado, traslado y liberacion sincronizados.");
