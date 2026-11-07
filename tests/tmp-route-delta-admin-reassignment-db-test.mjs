import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "../.tmp/lead-portal-tests/node_modules/@electric-sql/pglite/dist/index.js";

const db = new PGlite();
const owner = "11111111-1111-4111-8111-111111111111";

try {
  await db.exec(`
    create table public.active_route_items_cloud(
      user_id uuid not null,
      client_id text not null,
      data jsonb not null,
      updated_at timestamptz not null default now(),
      primary key(user_id, client_id)
    );
    create function public.is_route_delta_active(p_owner uuid, p_delta text)
    returns boolean language sql immutable as $$select true$$;
    insert into public.active_route_items_cloud(user_id, client_id, data) values (
      '${owner}', 'keysha',
      '{"clientId":"keysha","unitId":"B91","clientName":"KEYSHA MICHELLE PINO JORDAN","routeAssignment":"WC","assignedDelta":"delta1","assignedDeltaMode":"client-fixed","publishedAt":"2026-11-07T08:00:00Z"}'
    );
  `);

  const migration = readFileSync("supabase/migrations/20261107000600_allow_admin_delta_reassignment.sql", "utf8");
  await db.exec(migration);
  await db.exec(`create trigger active_route_assign_pty_delta before insert or update of data on public.active_route_items_cloud
    for each row execute function public.assign_active_route_pty_delta();`);

  const keysha = (await db.query("select data from active_route_items_cloud where client_id='keysha'")).rows[0].data;
  assert.equal(keysha.assignedDelta, "delta1", "La migración no debe mover automáticamente un carro existente.");
  assert.equal(keysha.assignedDeltaMode, "manual", "La asignación debe dejar de estar bloqueada por cliente.");

  await db.query("insert into active_route_items_cloud(user_id,client_id,data) values($1,$2,$3)", [owner, "pty-default", {
    clientId: "pty-default", unitId: "P01", clientName: "PTY", routeAssignment: "PTY", publishedAt: "2026-11-07T09:00:00Z"
  }]);
  await db.query("insert into active_route_items_cloud(user_id,client_id,data) values($1,$2,$3)", [owner, "wc-default", {
    clientId: "wc-default", unitId: "W01", clientName: "WC", routeAssignment: "WC", publishedAt: "2026-11-07T09:00:00Z"
  }]);
  await db.query("insert into active_route_items_cloud(user_id,client_id,data) values($1,$2,$3)", [owner, "pty-delta2", {
    clientId: "pty-delta2", unitId: "P02", clientName: "Excepción", routeAssignment: "PTY", assignedDelta: "delta2", assignedDeltaMode: "manual", publishedAt: "2026-11-07T09:00:00Z"
  }]);

  const rows = (await db.query("select client_id,data from active_route_items_cloud where client_id <> 'keysha' order by client_id")).rows;
  assert.equal(rows.find(row => row.client_id === "pty-default").data.assignedDelta, "delta1");
  assert.equal(rows.find(row => row.client_id === "wc-default").data.assignedDelta, "delta2");
  assert.equal(rows.find(row => row.client_id === "pty-delta2").data.assignedDelta, "delta2", "La excepción puntual de PTY para Delta 2 debe conservarse.");

  console.log("OK DB Delta: WC→Delta 2, PTY→Delta 1 y excepción PTY→Delta 2.");
} finally {
  await db.close();
}
