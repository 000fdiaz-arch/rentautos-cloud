import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "../.tmp/lead-portal-tests/node_modules/@electric-sql/pglite/dist/index.js";

const db = new PGlite();
const owner = "11111111-1111-4111-8111-111111111111";
const admin = "22222222-2222-4222-8222-222222222222";
const delta3 = "33333333-3333-4333-8333-333333333333";
const delta2 = "44444444-4444-4444-8444-444444444444";
const publishedAt = "2026-10-13T12:00:00.000Z";
const wcPublishedAt = "2026-10-13T12:30:00.000Z";

try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key);
    insert into auth.users values ('${owner}'), ('${admin}'), ('${delta3}'), ('${delta2}');
    create function auth.uid() returns uuid language sql as
      $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
    grant usage on schema auth to authenticated, anon;

    create table public.user_profiles(id uuid primary key, email text, role text, owner_id uuid, view_route boolean, edit_route boolean);
    insert into public.user_profiles values
      ('${owner}', 'owner@rentautos.local', 'admin', '${owner}', true, true),
      ('${admin}', 'admin@rentautos.local', 'admin', '${owner}', true, true),
      ('${delta3}', 'delta3@auth.rentautos.local', 'buscador', '${owner}', true, false),
      ('${delta2}', 'delta2@auth.rentautos.local', 'buscador', '${owner}', true, false);

    create function public.can_view_owner_screen(o uuid, s text) returns boolean language sql security definer as
      $$select exists(select 1 from public.user_profiles where id=auth.uid() and owner_id=o and view_route)$$;
    create function public.can_edit_owner_screen(o uuid, s text) returns boolean language sql security definer as
      $$select exists(select 1 from public.user_profiles where id=auth.uid() and owner_id=o and edit_route)$$;
    create function public.can_report_route_payment(o uuid) returns boolean language sql security definer as
      $$select exists(select 1 from public.user_profiles where id=auth.uid() and owner_id=o and view_route and role in ('buscador','admin'))$$;
    create function public.is_admin() returns boolean language sql as
      $$select exists(select 1 from public.user_profiles where id=auth.uid() and role='admin')$$;

    create table public.active_route_items_cloud(
      user_id uuid not null references auth.users(id), client_id text not null, data jsonb not null,
      in_custody boolean not null default false, custody_since timestamptz, custody_changed_at timestamptz,
      custody_changed_by uuid, custody_history jsonb not null default '[]', updated_at timestamptz default now(),
      primary key(user_id, client_id)
    );
    insert into public.active_route_items_cloud(user_id, client_id, data) values
      ('${owner}', 'c1', '{"unitId":"A33","clientName":"Jean","publishedAt":"${publishedAt}","routeAssignment":"PTY"}'),
      ('${owner}', 'c2', '{"unitId":"D74","clientName":"Wendy","publishedAt":"${wcPublishedAt}","routeAssignment":"WC"}');
  `);

  const sql = readFileSync("supabase/migrations/20261013000100_route_capture_control.sql", "utf8");
  assert.equal(sql, readFileSync("supabase/109-route-capture-control.sql", "utf8"));
  await db.exec(sql);
  const autoStartSql = readFileSync("supabase/migrations/20261013000300_route_capture_auto_start.sql", "utf8");
  assert.equal(autoStartSql, readFileSync("supabase/111-route-capture-auto-start.sql", "utf8"));
  await db.exec(autoStartSql);

  const login = async (id) => db.exec(`reset role; set request.jwt.claim.sub='${id}'; set role authenticated;`);
  await login(delta3);
  await assert.rejects(db.query("select start_route_run($1,$2)", [owner, "WC"]), /asignada.*PTY/i);
  await db.query("select set_active_route_custody($1,$2,$3,$4,$5)", [owner, "c1", publishedAt, true, false]);

  let capture = (await db.query("select * from route_capture_events")).rows[0];
  let run = (await db.query("select * from route_runs")).rows[0];
  await assert.rejects(db.query("select start_route_run($1,$2)", [owner, "PTY"]), /ruta en curso/i);
  assert.equal(capture.reporter_name, "delta3@auth.rentautos.local");
  assert.equal(capture.route_assignment, "PTY");
  assert.equal(capture.route_run_id, run.id);
  assert.equal(capture.status, "pending");
  await assert.rejects(db.query("select confirm_route_capture($1)", [capture.id]), /administrador/i);

  await db.query("select submit_route_run($1)", [run.id]);
  run = (await db.query("select * from route_runs")).rows[0];
  assert.equal(run.status, "pending");

  await login(admin);
  await assert.rejects(db.query("select confirm_route_run($1)", [run.id]), /Confirma primero/i);
  await db.query("select confirm_route_capture($1)", [capture.id]);
  await db.query("select confirm_route_run($1)", [run.id]);
  capture = (await db.query("select * from route_capture_events")).rows[0];
  run = (await db.query("select * from route_runs")).rows[0];
  assert.equal(capture.status, "confirmed");
  assert.equal(capture.confirmed_by, admin);
  assert.equal(run.status, "confirmed");
  assert.equal(run.confirmed_by, admin);

  await login(delta2);
  await db.query("select set_active_route_custody($1,$2,$3,$4,$5)", [owner, "c2", wcPublishedAt, true, false]);
  const delta2Run = (await db.query("select * from route_runs where operator_id=$1", [delta2])).rows[0];
  const delta2Capture = (await db.query("select * from route_capture_events where reported_by=$1", [delta2])).rows[0];
  assert.equal(delta2Run.route_assignment, "WC");
  assert.equal(delta2Run.status, "in_progress");
  assert.equal(delta2Capture.reporter_name, "delta2@auth.rentautos.local");
  assert.equal(delta2Capture.route_run_id, delta2Run.id);

  console.log("OK DB captaciones: Delta 2 inicia WC automáticamente; Delta 3 PTY conserva cierre y confirmación.");
} finally {
  await db.close();
}
