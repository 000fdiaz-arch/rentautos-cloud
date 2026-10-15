import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "../.tmp/lead-portal-tests/node_modules/@electric-sql/pglite/dist/index.js";

const db = new PGlite();
const owner = "11111111-1111-4111-8111-111111111111";
const editor = "22222222-2222-4222-8222-222222222222";
const viewer = "33333333-3333-4333-8333-333333333333";

try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql as
      $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
    create function public.can_edit_owner_screen(p_owner uuid, p_screen text) returns boolean language sql as
      $$select auth.uid() = '${editor}'::uuid and p_owner = '${owner}'::uuid and p_screen = 'receivables'$$;
    create table public.street_management_items_cloud(
      user_id uuid not null,
      client_id text not null,
      data jsonb not null,
      updated_at timestamptz not null default now(),
      primary key(user_id, client_id)
    );
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
    grant select on public.street_management_items_cloud, public.active_route_items_cloud to authenticated;
  `);

  const migration = readFileSync("supabase/migrations/20261015000100_receivables_route_removal.sql", "utf8");
  assert.equal(migration, readFileSync("supabase/113-receivables-route-removal.sql", "utf8"));
  await db.exec(migration);

  const login = (id) => db.exec(`reset role; set request.jwt.claim.sub='${id}'; set role authenticated;`);
  await db.query("insert into street_management_items_cloud values($1,$2,$3)", [owner, "client-a", {
    status: "pending", isRouteTagged: true, updatedAt: "2026-10-15T13:00:00.000Z",
    managementType: "solo_cobrar", routeReleaseAmount: 100, routeAssignment: "PTY", routeUrgency: "normal"
  }]);
  await db.query("insert into active_route_items_cloud(user_id,client_id,data,in_custody,custody_since) values($1,$2,$3,true,now())", [owner, "client-a", {
    clientId: "client-a", unitId: "A01", clientName: "CLIENTE PRUEBA", publishedAt: "2026-10-15T13:00:01.000Z", routeAssignment: "PTY"
  }]);

  await login(viewer);
  await assert.rejects(
    db.query("select remove_active_route_item_from_receivables($1,$2,$3)", [owner, "client-a", "2026-10-15T13:00:00.000Z"]),
    /permiso/i
  );

  await login(editor);
  await assert.rejects(
    db.query("select remove_active_route_item_from_receivables($1,$2,$3)", [owner, "client-a", "fecha-antigua"]),
    /cambio/i
  );
  await db.query("select remove_active_route_item_from_receivables($1,$2,$3)", [owner, "client-a", "2026-10-15T13:00:00.000Z"]);

  const route = (await db.query("select data,in_custody,custody_since,custody_history from active_route_items_cloud where client_id='client-a'" )).rows[0];
  assert.ok(route.data.removedAt);
  assert.equal(route.data.removedReason, "manual_management");
  assert.equal(route.in_custody, false);
  assert.equal(route.custody_since, null);
  assert.equal(route.custody_history.length, 1);
  assert.equal(route.custody_history[0].reason, "route_removed");

  const management = (await db.query("select data from street_management_items_cloud where client_id='client-a'" )).rows[0].data;
  assert.equal(management.status, "pending");
  assert.equal(management.isRouteTagged, false);
  assert.equal(management.routeAssignment, undefined);
  assert.equal(management.routeReleaseAmount, undefined);

  await db.exec("reset role");
  await db.query("insert into street_management_items_cloud values($1,$2,$3)", [owner, "client-b", {
    status: "pending", isRouteTagged: true, updatedAt: "2026-10-15T14:00:00.000Z", routeAssignment: "PTY"
  }]);
  await login(editor);
  await db.query("select remove_active_route_item_from_receivables($1,$2,$3)", [owner, "client-b", "2026-10-15T14:00:00.000Z"]);
  const preparation = (await db.query("select data from street_management_items_cloud where client_id='client-b'" )).rows[0].data;
  assert.equal(preparation.isRouteTagged, false, "También debe cancelar una preparación aún no publicada.");

  console.log("OK salida de ruta: permiso de Cuentas por cobrar, concurrencia, custodia e historial.");
} finally {
  await db.close();
}
