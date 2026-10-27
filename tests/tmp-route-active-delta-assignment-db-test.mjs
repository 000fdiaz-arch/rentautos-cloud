import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "../.tmp/lead-portal-tests/node_modules/@electric-sql/pglite/dist/index.js";

const db = new PGlite();
const owner = "11111111-1111-4111-8111-111111111111";
const editor = "22222222-2222-4222-8222-222222222222";
const delta1 = "33333333-3333-4333-8333-333333333333";
const delta2 = "44444444-4444-4444-8444-444444444444";
const delta3 = "55555555-5555-4555-8555-555555555555";

try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql as
      $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
    create function public.current_user_role() returns text language sql as $$select 'admin'::text$$;
    create function public.can_edit_owner_screen(p_owner uuid, p_screen text) returns boolean language sql as
      $$select auth.uid() = '${editor}'::uuid and p_owner = '${owner}'::uuid and p_screen = 'route_search'$$;
    create table public.user_profiles(
      id uuid primary key,
      email text not null,
      is_active boolean not null default true,
      data_owner_user_id uuid
    );
    create table public.active_route_items_cloud(
      user_id uuid not null,
      client_id text not null,
      data jsonb not null,
      updated_at timestamptz not null default now(),
      primary key(user_id, client_id)
    );
    grant select on public.active_route_items_cloud to authenticated;
    insert into public.user_profiles(id,email,is_active,data_owner_user_id) values
      ('${delta1}', 'delta1@auth.rentautos.local', true, '${owner}'),
      ('${delta2}', 'delta2@auth.rentautos.local', true, '${owner}'),
      ('${delta3}', 'delta3@auth.rentautos.local', false, '${owner}');
  `);

  const restrictionMigration = readFileSync("supabase/migrations/20261015000200_route_delta_client_restrictions.sql", "utf8");
  await db.exec(restrictionMigration);
  await db.exec(`create trigger active_route_assign_pty_delta before insert or update of data on public.active_route_items_cloud
    for each row execute function public.assign_active_route_pty_delta();`);

  const migration = readFileSync("supabase/migrations/20261026000100_active_route_delta_availability.sql", "utf8");
  assert.equal(migration, readFileSync("supabase/119-active-route-delta-availability.sql", "utf8"));
  await db.exec(migration);

  const publishedAt = "2026-10-26T15:00:00.000Z";
  await db.query("insert into active_route_items_cloud(user_id,client_id,data) values($1,$2,$3)", [owner, "inactive-target", {
    clientId: "inactive-target", unitId: "A01", clientName: "CLIENTE REGULAR", publishedAt, routeAssignment: "PTY", assignedDelta: "delta3"
  }]);
  let route = (await db.query("select data from active_route_items_cloud where client_id='inactive-target'" )).rows[0].data;
  assert.equal(route.assignedDelta, "delta1", "Un Delta inactivo no debe conservar ni recibir la asignación.");
  assert.equal(route.assignedDeltaMode, "automatic");

  await db.query("update user_profiles set is_active=true where id=$1", [delta3]);
  await db.query("insert into active_route_items_cloud(user_id,client_id,data) values($1,$2,$3)", [owner, "active-target", {
    clientId: "active-target", unitId: "A02", clientName: "OTRO CLIENTE", publishedAt, routeAssignment: "PTY", assignedDelta: "delta3"
  }]);
  route = (await db.query("select data from active_route_items_cloud where client_id='active-target'" )).rows[0].data;
  assert.equal(route.assignedDelta, "delta3", "Un Delta activo sí puede conservar una asignación válida.");

  await db.query("update user_profiles set is_active=false where id=$1", [delta3]);
  route = (await db.query("select data from active_route_items_cloud where client_id='active-target'" )).rows[0].data;
  assert.equal(route.assignedDelta, "delta1", "Al desactivar un Delta, sus carros activos deben reasignarse.");
  assert.equal(route.assignedDeltaMode, "automatic");

  await db.exec(`set request.jwt.claim.sub='${editor}'; set role authenticated;`);
  await assert.rejects(
    db.query("select change_active_route_delta_assignment($1,$2,$3,$4,$5)", [owner, "active-target", publishedAt, "delta1", "delta3"]),
    /Delta 3.*inactivo/i
  );
  await db.exec("reset role");

  await db.query("update user_profiles set is_active=false where id=$1", [delta1]);
  await db.query("insert into active_route_items_cloud(user_id,client_id,data) values($1,$2,$3)", [owner, "no-target", {
    clientId: "no-target", unitId: "A03", clientName: "SIN BUSCADOR", publishedAt, routeAssignment: "PTY"
  }]);
  route = (await db.query("select data from active_route_items_cloud where client_id='no-target'" )).rows[0].data;
  assert.equal(route.assignedDelta, undefined, "Sin buscadores activos, el carro debe quedar sin asignar.");

  console.log("OK Delta activo: reparto, asignación manual y desactivación respetan is_active.");
} finally {
  await db.close();
}
