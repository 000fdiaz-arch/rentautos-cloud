import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "../.tmp/lead-portal-tests/node_modules/@electric-sql/pglite/dist/index.js";

const db = new PGlite();
const owner = "11111111-1111-4111-8111-111111111111";
const editor = "22222222-2222-4222-8222-222222222222";
const delta = "33333333-3333-4333-8333-333333333333";
const viewer = "44444444-4444-4444-8444-444444444444";

try {
  await db.exec(`
    create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key);
    insert into auth.users values ('${owner}'), ('${editor}'), ('${delta}'), ('${viewer}');
    create function auth.uid() returns uuid language sql as
      $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;

    create table public.user_profiles(
      id uuid primary key,
      owner_id uuid not null,
      role text not null,
      can_edit_route boolean not null
    );
    insert into public.user_profiles values
      ('${owner}', '${owner}', 'admin', true),
      ('${editor}', '${owner}', 'operador', true),
      ('${delta}', '${owner}', 'buscador', true),
      ('${viewer}', '${owner}', 'lectura', false);

    create function public.current_user_role() returns text language sql stable security definer as
      $$select role from public.user_profiles where id=auth.uid() limit 1$$;
    create function public.can_edit_owner_screen(target_owner uuid, screen_name text) returns boolean language sql stable security definer as
      $$select exists(
        select 1 from public.user_profiles
        where id=auth.uid() and owner_id=target_owner and can_edit_route and screen_name='route_search'
      )$$;

    create table public.active_route_items_cloud(
      user_id uuid not null,
      client_id text not null,
      data jsonb not null,
      in_custody boolean not null default false,
      custody_since timestamptz,
      custody_changed_at timestamptz,
      custody_changed_by uuid,
      custody_history jsonb not null default '[]'::jsonb,
      updated_at timestamptz not null default now(),
      primary key(user_id, client_id)
    );

    insert into public.active_route_items_cloud(user_id, client_id, data, in_custody, custody_since)
    values ('${owner}', 'client-1', '{"clientId":"client-1","unitId":"C03","publishedAt":"2026-11-12T14:04:00Z"}', true, now());
    grant select on public.active_route_items_cloud to authenticated;
  `);

  const migration = readFileSync("supabase/migrations/20261112000100_route_delta_removal_guard.sql", "utf8");
  assert.equal(migration, readFileSync("supabase/127-route-delta-removal-guard.sql", "utf8"));
  await db.exec(migration);

  const login = async (id) => db.exec(`reset role; set request.jwt.claim.sub='${id}'; set role authenticated;`);

  await login(delta);
  await assert.rejects(
    db.query("select remove_active_route_item_from_search($1,$2)", [owner, "client-1"]),
    /cuentas Delta no pueden sacar autos/i
  );
  let row = (await db.query("select data from active_route_items_cloud where client_id='client-1'")).rows[0];
  assert.equal(row.data.removedAt, undefined, "El intento del Delta no debe modificar la unidad.");

  await login(viewer);
  await assert.rejects(
    db.query("select remove_active_route_item_from_search($1,$2)", [owner, "client-1"]),
    /no tienes permiso/i
  );

  await login(editor);
  await db.query("select remove_active_route_item_from_search($1,$2)", [owner, "client-1"]);
  await db.exec("reset role;");
  row = (await db.query("select data, in_custody, custody_history from active_route_items_cloud where client_id='client-1'")).rows[0];
  assert.equal(row.data.removedReason, "route_editor_removed");
  assert.equal(row.data.removedBy, editor, "El retiro debe guardar al usuario responsable.");
  assert.equal(row.in_custody, false, "Retirar de Ruta también debe cerrar la custodia.");
  assert.equal(row.custody_history[0].by, editor, "El cierre de custodia debe conservar el mismo autor.");

  console.log("OK Ruta: Delta bloqueado, editor autorizado y retiro auditado.");
} finally {
  await db.close();
}
