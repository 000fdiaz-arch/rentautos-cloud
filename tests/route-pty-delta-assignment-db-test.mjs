import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "../.tmp/lead-portal-tests/node_modules/@electric-sql/pglite/dist/index.js";

const db = new PGlite();
const owner = "11111111-1111-4111-8111-111111111111";
const editor = "22222222-2222-4222-8222-222222222222";
const seeker = "33333333-3333-4333-8333-333333333333";
const publishedAt = "2026-10-14T12:00:00.000Z";

try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key);
    insert into auth.users values ('${owner}'), ('${editor}'), ('${seeker}');
    create function auth.uid() returns uuid language sql as
      $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;

    create table public.user_profiles(id uuid primary key, owner_id uuid, can_edit_route boolean);
    insert into public.user_profiles values
      ('${owner}', '${owner}', true),
      ('${editor}', '${owner}', true),
      ('${seeker}', '${owner}', false);
    create function public.can_edit_owner_screen(o uuid, s text) returns boolean language sql security definer as
      $$select exists(select 1 from public.user_profiles where id=auth.uid() and owner_id=o and can_edit_route)$$;

    create table public.active_route_items_cloud(
      user_id uuid not null references auth.users(id),
      client_id text not null,
      data jsonb not null,
      updated_at timestamptz not null default now(),
      primary key(user_id, client_id)
    );

    insert into public.active_route_items_cloud(user_id, client_id, data) values
      ('${owner}', 't18', '{"clientId":"t18","unitId":"T18","clientName":"Uno","routeAssignment":"PTY","publishedAt":"${publishedAt}"}'),
      ('${owner}', 'e03', '{"clientId":"e03","unitId":"E03","clientName":"Dos","routeAssignment":"PTY","publishedAt":"${publishedAt}"}'),
      ('${owner}', 'other', '{"clientId":"other","unitId":"Z99","clientName":"Tres","routeAssignment":"PTY","publishedAt":"${publishedAt}"}'),
      ('${owner}', 'wc', '{"clientId":"wc","unitId":"W01","clientName":"WC","routeAssignment":"WC","publishedAt":"${publishedAt}"}');
  `);

  const migration = readFileSync("supabase/migrations/20261014000100_route_pty_delta_assignment.sql", "utf8");
  const contingencyMigration = readFileSync("supabase/migrations/20261014000200_route_pty_delta2_contingency.sql", "utf8");
  assert.equal(migration, readFileSync("supabase/112-route-pty-delta-assignment.sql", "utf8"));
  await db.exec(migration);
  await db.exec(contingencyMigration);

  const assignments = (await db.query("select client_id, data->>'assignedDelta' delta from active_route_items_cloud order by client_id")).rows;
  assert.equal(assignments.find(row => row.client_id === "t18").delta, "delta1");
  assert.equal(assignments.find(row => row.client_id === "e03").delta, "delta3");
  assert.ok(["delta1", "delta3"].includes(assignments.find(row => row.client_id === "other").delta));
  assert.equal(assignments.find(row => row.client_id === "wc").delta, null);

  await db.exec(`
    insert into public.active_route_items_cloud(user_id, client_id, data)
    values ('${owner}', 'new-1', '{"clientId":"new-1","unitId":"N01","clientName":"Nuevo","routeAssignment":"PTY","publishedAt":"${publishedAt}"}');
  `);
  let counts = (await db.query(`select data->>'assignedDelta' delta, count(*)::int total
    from active_route_items_cloud where data->>'routeAssignment'='PTY' group by 1 order by 1`)).rows;
  assert.ok(Math.abs(counts[0].total - counts[1].total) <= 1, "La asignación automática debe mantener el reparto equilibrado.");

  const login = async id => db.exec(`reset role; set request.jwt.claim.sub='${id}'; set role authenticated;`);
  await login(seeker);
  await assert.rejects(
    db.query("select change_active_route_delta_assignment($1,$2,$3,$4,$5)", [owner, "t18", publishedAt, "delta1", "delta3"]),
    /editor de Ruta/i
  );

  await login(editor);
  await db.query("select change_active_route_delta_assignment($1,$2,$3,$4,$5)", [owner, "t18", publishedAt, "delta1", "delta2"]);
  await db.exec("reset role;");
  const edited = (await db.query("select data from active_route_items_cloud where client_id='t18'")).rows[0].data;
  assert.equal(edited.assignedDelta, "delta2");
  assert.equal(edited.assignedDeltaMode, "manual");
  assert.equal(edited.assignedDeltaBy, editor);

  await db.exec(migration);
  await db.exec(contingencyMigration);
  const preserved = (await db.query("select data from active_route_items_cloud where client_id='t18'")).rows[0].data;
  assert.equal(preserved.assignedDelta, "delta2", "Reaplicar la migración no debe deshacer una edición manual posterior.");

  await db.exec(`update active_route_items_cloud
    set data=jsonb_set(data, '{routeAssignment}', '"WC"') where client_id='other'`);
  let moved = (await db.query("select data from active_route_items_cloud where client_id='other'")).rows[0].data;
  assert.equal(moved.routeAssignment, "WC");
  assert.equal(moved.assignedDelta, undefined, "Cambiar el carro a otra ruta debe quitar la asignación PTY.");

  await db.exec(`update active_route_items_cloud
    set data=jsonb_set(data, '{routeAssignment}', '"PTY"') where client_id='other'`);
  moved = (await db.query("select data from active_route_items_cloud where client_id='other'")).rows[0].data;
  assert.ok(["delta1", "delta3"].includes(moved.assignedDelta), "Al regresar a PTY debe volver a entrar al reparto automático normal.");

  console.log("OK PTY: Delta 2 manual, reparto automático 1/3 y cambio de ruta conservado.");
} finally {
  await db.close();
}
