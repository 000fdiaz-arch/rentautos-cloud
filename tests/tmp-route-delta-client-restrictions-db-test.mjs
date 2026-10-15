import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "../.tmp/lead-portal-tests/node_modules/@electric-sql/pglite/dist/index.js";

const db = new PGlite();
const owner = "11111111-1111-4111-8111-111111111111";
const editor = "22222222-2222-4222-8222-222222222222";

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
    create table public.active_route_items_cloud(
      user_id uuid not null,
      client_id text not null,
      data jsonb not null,
      updated_at timestamptz not null default now(),
      primary key(user_id, client_id)
    );
    grant select on public.active_route_items_cloud to authenticated;
  `);

  const migration = readFileSync("supabase/migrations/20261015000200_route_delta_client_restrictions.sql", "utf8");
  assert.equal(migration, readFileSync("supabase/114-route-delta-client-restrictions.sql", "utf8"));
  await db.exec(migration);
  await db.exec(`create trigger active_route_assign_pty_delta before insert or update of data on public.active_route_items_cloud
    for each row execute function public.assign_active_route_pty_delta();`);

  const publishedAt = "2026-10-15T15:00:00.000Z";
  await db.query("insert into active_route_items_cloud(user_id,client_id,data) values($1,$2,$3)", [owner, "protected-a", {
    clientId: "protected-a", unitId: "X99", clientName: "  zacarias   arauz viquez ", publishedAt, routeAssignment: "PTY", assignedDelta: "delta3"
  }]);
  await db.query("insert into active_route_items_cloud(user_id,client_id,data) values($1,$2,$3)", [owner, "regular", {
    clientId: "regular", unitId: "A13", clientName: "OTRA PERSONA", publishedAt, routeAssignment: "PTY", assignedDelta: "delta3"
  }]);

  let protectedRoute = (await db.query("select data from active_route_items_cloud where client_id='protected-a'" )).rows[0].data;
  const regularRoute = (await db.query("select data from active_route_items_cloud where client_id='regular'" )).rows[0].data;
  assert.equal(protectedRoute.assignedDelta, "delta1", "La regla debe seguir el nombre aunque cambie la unidad.");
  assert.equal(protectedRoute.assignedDeltaMode, "client-fixed");
  assert.equal(regularRoute.assignedDelta, "delta3", "La unidad A13 por sí sola no debe activar la regla.");

  await db.exec(`set request.jwt.claim.sub='${editor}'; set role authenticated;`);
  await assert.rejects(
    db.query("select change_active_route_delta_assignment($1,$2,$3,$4,$5)", [owner, "protected-a", publishedAt, "delta1", "delta3"]),
    /Delta 1/i
  );
  protectedRoute = (await db.query("select data from active_route_items_cloud where client_id='protected-a'" )).rows[0].data;
  assert.equal(protectedRoute.assignedDelta, "delta1");

  console.log("OK Delta: clientes protegidos por nombre completo permanecen en Delta 1, independientemente de la unidad.");
} finally {
  await db.close();
}
