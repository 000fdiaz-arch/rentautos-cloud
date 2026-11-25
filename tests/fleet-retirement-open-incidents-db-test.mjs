import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "../.tmp/lead-portal-tests/node_modules/@electric-sql/pglite/dist/index.js";

const db = new PGlite();
const owner = "11111111-1111-4111-8111-111111111111";
const outsider = "22222222-2222-4222-8222-222222222222";
const fleetId = "33333333-3333-4333-8333-333333333333";
const migration = readFileSync("supabase/migrations/20261124000100_allow_fleet_retirement_with_open_incidents.sql", "utf8");
assert.equal(migration, readFileSync("supabase/132-allow-fleet-retirement-with-open-incidents.sql", "utf8"));
const lifecycle = readFileSync("supabase/migrations/20260831000100_fleet_unit_lifecycle.sql", "utf8");
function lifecycleFunction(name) {
  const start = lifecycle.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0);
  return lifecycle.slice(start, lifecycle.indexOf("\n$$;", start) + 4);
}

try {
  await db.exec(`
    create role authenticated; create role anon; create schema auth;
    create function auth.uid() returns uuid language sql as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function public.can_edit_owner_screen(o uuid, s text) returns boolean language sql as $$
      select auth.uid() = o and s = 'control_units' and current_setting('test.can_edit', true) = 'true' $$;
    create function public.can_view_owner_screen(o uuid, s text) returns boolean language sql as $$
      select auth.uid() = o and s = 'control_units' $$;
    create table public.fleet_units_cloud (
      fleet_id uuid primary key, user_id uuid, unit_id text, plate text, chassis_serial text,
      operational_status text, updated_at timestamptz default now(), retired_at timestamptz,
      retired_reason text, retired_note text, retired_by uuid, retired_by_email text,
      retired_client_id text, retired_client_name text
    );
    create unique index fleet_active_unit on public.fleet_units_cloud(user_id, unit_id) where retired_at is null;
    create table public.clients_cloud (user_id uuid, id text, data jsonb, updated_at timestamptz default now());
    create table public.active_route_items_cloud (user_id uuid, id text, data jsonb);
    create table public.payment_promises_cloud (user_id uuid, id text, data jsonb);
    create table public.insurance_claims_cloud (user_id uuid, id text, data jsonb, updated_at timestamptz default now());
    create table public.collision_cases_cloud (user_id uuid, id text, data jsonb, updated_at timestamptz default now());
    create table public.bank_rules_cloud (user_id uuid, data jsonb, updated_at timestamptz);
    create table public.user_profiles (id uuid, email text);
    create table public.fleet_unit_events_cloud (
      user_id uuid, fleet_id uuid, event_type text, previous_unit_id text, reason text,
      note text, vehicle_snapshot jsonb, performed_by uuid, performed_by_email text
    );
    grant usage on schema public, auth to authenticated, anon;
    insert into public.user_profiles values ('${owner}', 'admin@example.test');
    insert into public.fleet_units_cloud(fleet_id,user_id,unit_id,plate,chassis_serial,operational_status)
      values ('${fleetId}','${owner}','D94','D94-OLD','CHASSIS-OLD','taller');
    insert into public.clients_cloud(user_id,id,data) values
      ('${owner}','archived','{"unitId":"D94","status":"archivado","name":"Cliente histórico","balance":120.5}');
    insert into public.insurance_claims_cloud(user_id,id,data) values
      ('${owner}','open-claim','{"unit":"D94","status":"activo","claimNumber":"R-94","photos":["claim.jpg"],"payments":[{"amount":125}],"notes":"Pendiente"}'),
      ('${owner}','closed-claim','{"unit":"D94","status":"finalizado","claimNumber":"R-93"}');
    insert into public.collision_cases_cloud(user_id,id,data) values
      ('${owner}','open-collision','{"unit":"D94","status":"PENDIENTE","ticketStub":"T-94","photos":["collision.jpg"],"timeline":[{"note":"Audiencia pendiente"}]}'),
      ('${owner}','closed-collision','{"unit":"D94","status":"CIERRE ADMINISTRATIVO","ticketStub":"T-93"}');
    set request.jwt.claim.sub = '${owner}'; set test.can_edit = 'true';
  `);
  await db.exec(lifecycleFunction("preview_fleet_unit_lifecycle"));
  await db.exec(lifecycleFunction("preserve_retired_fleet_unit"));
  await db.exec(`create trigger fleet_units_preserve_retired before update on public.fleet_units_cloud
    for each row execute function public.preserve_retired_fleet_unit();`);
  const retire = (reason = "Retirado", targetOwner = owner) => db.query(
    "select public.retire_fleet_unit($1,$2,$3,$4) as result", [targetOwner, fleetId, reason, "  Baja con expediente en seguimiento  "]
  );
  const impact = async () => (await db.query(
    "select public.preview_fleet_unit_lifecycle($1,$2,null) as impact", [owner, fleetId]
  )).rows[0].impact;
  const snapshot = async () => {
    const result = {};
    for (const table of ["insurance_claims_cloud", "collision_cases_cloud", "clients_cloud", "active_route_items_cloud", "payment_promises_cloud"]) {
      result[table] = (await db.query(`select * from public.${table} order by id`)).rows;
    }
    return result;
  };
  const assertStillActive = async () => {
    assert.equal((await db.query("select retired_at from public.fleet_units_cloud where fleet_id=$1", [fleetId])).rows[0].retired_at, null);
    assert.equal((await db.query("select count(*)::int as count from public.fleet_unit_events_cloud")).rows[0].count, 0);
  };

  // Reproduce the existing D94 blocker before applying the fix.
  await db.exec(readFileSync("supabase/migrations/20261103000100_allow_fleet_retirement_with_open_claims.sql", "utf8"));
  assert.equal((await impact()).openInsuranceClaims, 1);
  assert.equal((await impact()).openCollisionCases, 1);
  await assert.rejects(retire(), /expedientes de colision abiertos/);
  await assertStillActive();

  await db.exec(migration);
  await assert.rejects(retire("  "), /motivo de baja es obligatorio/);
  await assert.rejects(retire("Retirado", outsider), /No autorizado/);
  await db.exec("set test.can_edit = 'false'");
  await assert.rejects(retire(), /No autorizado/);
  await db.exec("set test.can_edit = 'true'; set role anon");
  await assert.rejects(retire(), /permission denied/);
  await db.exec("reset role; set role authenticated");
  await assert.rejects(retire("Retirado", outsider), /No autorizado/);
  await db.exec("reset role");

  // Keep all operational blockers, including both provisional rental references.
  for (const data of [
    { unitId: " d94 ", status: "activo" },
    { unitId: "A01", status: "activo", activeProvisionalRental: { unitId: "D94" } },
    { unitId: "A01", status: "activo", activeProvisionalRental: { regularUnitId: "D94", unitId: "B01" } }
  ]) {
    await db.query("insert into public.clients_cloud(user_id,id,data) values ($1,'active',$2)", [owner, data]);
    await assert.rejects(retire(), /cliente o alquiler provisional activo/);
    await assertStillActive();
    await db.exec("delete from public.clients_cloud where id='active'");
  }
  await db.query("insert into public.active_route_items_cloud values ($1,'route',$2)", [owner, { unitId: "D94" }]);
  await assert.rejects(retire(), /ruta activa/);
  await assertStillActive();
  await db.exec(`update public.active_route_items_cloud set data = data || '{"removedAt":"2026-11-24"}'::jsonb`);
  for (const status of ["pending", "incomplete", "overdue", "rescheduled"]) {
    await db.query("insert into public.payment_promises_cloud values ($1,'promise',$2)", [owner, { clientUnit: "D94", status }]);
    await assert.rejects(retire(), /promesas de pago pendientes/);
    await assertStillActive();
    await db.exec("delete from public.payment_promises_cloud");
  }
  await db.query("insert into public.payment_promises_cloud values ($1,'settled',$2)", [owner, { clientUnit: "D94", status: "completed" }]);
  const before = await snapshot();
  const originalVehicle = (await db.query("select to_jsonb(f) as vehicle from public.fleet_units_cloud f where fleet_id=$1", [fleetId])).rows[0].vehicle;

  await db.exec("set role authenticated");
  assert.deepEqual((await retire()).rows[0].result, { fleetId, unitId: "D94", retired: true });
  await db.exec("reset role");
  assert.deepEqual(await snapshot(), before, "La baja no cambia estados, documentos, pagos ni datos de los expedientes o clientes.");
  const retired = (await db.query("select * from public.fleet_units_cloud where fleet_id=$1", [fleetId])).rows[0];
  assert.ok(retired.retired_at);
  assert.equal(retired.operational_status, "archivado");
  assert.equal(retired.retired_by, owner);
  assert.equal(retired.retired_by_email, "admin@example.test");
  assert.equal(retired.retired_reason, "Retirado");
  assert.equal(retired.retired_note, "Baja con expediente en seguimiento");
  assert.equal(retired.retired_client_id, "archived");
  const events = (await db.query("select * from public.fleet_unit_events_cloud")).rows;
  assert.equal(events.length, 1);
  assert.equal(events[0].event_type, "retired");
  assert.equal(events[0].fleet_id, fleetId);
  assert.deepEqual(events[0].vehicle_snapshot, originalVehicle);
  await assert.rejects(retire(), /ya fue dado de baja/);
  assert.equal((await db.query("select count(*)::int as count from public.fleet_unit_events_cloud")).rows[0].count, 1);

  // Reusing D94 must retain the archived vehicle and all existing incident data.
  await db.query(`insert into public.fleet_units_cloud(fleet_id,user_id,unit_id,plate,chassis_serial,operational_status)
    values (gen_random_uuid(),$1,'D94','NEW-PLATE','NEW-CHASSIS','libre')`, [owner]);
  await db.exec("update public.fleet_units_cloud set operational_status='taller' where unit_id='D94'");
  assert.deepEqual((await db.query("select * from public.fleet_units_cloud where fleet_id=$1", [fleetId])).rows[0], retired);
  assert.deepEqual(await snapshot(), before);
  console.log("OK DB: D94 admite baja con siniestros abiertos, conserva íntegros expedientes e historial y mantiene permisos y bloqueos operativos.");
} finally {
  await db.close();
}
