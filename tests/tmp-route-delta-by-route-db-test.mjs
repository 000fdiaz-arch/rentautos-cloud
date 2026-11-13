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
    insert into public.active_route_items_cloud(user_id, client_id, data) values
      ('${owner}', 'automatic-wc', '{"clientId":"automatic-wc","routeAssignment":"WC","assignedDelta":"delta1","assignedDeltaMode":"automatic"}'),
      ('${owner}', 'manual-wc', '{"clientId":"manual-wc","routeAssignment":"WC","assignedDelta":"delta1","assignedDeltaMode":"manual"}'),
      ('${owner}', 'route-change', '{"clientId":"route-change","routeAssignment":"PTY","assignedDelta":"delta1","assignedDeltaMode":"route-default"}'),
      ('${owner}', 'manual-route-change', '{"clientId":"manual-route-change","routeAssignment":"PTY","assignedDelta":"delta3","assignedDeltaMode":"manual"}');
  `);

  const migration = readFileSync("supabase/migrations/20261112000200_sync_delta_with_standard_route.sql", "utf8");
  await db.exec(migration);
  await db.exec(`create trigger active_route_assign_pty_delta before insert or update of data on public.active_route_items_cloud
    for each row execute function public.assign_active_route_pty_delta();`);

  let rows = (await db.query("select client_id, data from active_route_items_cloud order by client_id")).rows;
  assert.equal(rows.find(row => row.client_id === "automatic-wc").data.assignedDelta, "delta2", "El backfill debe corregir las asignaciones automáticas existentes.");
  assert.equal(rows.find(row => row.client_id === "manual-wc").data.assignedDelta, "delta1", "El backfill no debe borrar una excepción manual existente.");

  await db.exec(`
    update public.active_route_items_cloud
    set data = jsonb_set(data, '{routeAssignment}', '"WC"'::jsonb, true)
    where client_id in ('route-change', 'manual-route-change');
  `);
  rows = (await db.query("select client_id, data from active_route_items_cloud order by client_id")).rows;
  assert.equal(rows.find(row => row.client_id === "route-change").data.assignedDelta, "delta2", "PTY→WC debe pasar el carro a Delta 2.");
  assert.equal(rows.find(row => row.client_id === "manual-route-change").data.assignedDelta, "delta2", "Un cambio de ruta más reciente debe aplicar el Delta de la ruta.");

  await db.exec(`
    update public.active_route_items_cloud
    set data = jsonb_set(jsonb_set(data, '{assignedDelta}', '"delta1"'::jsonb, true), '{assignedDeltaMode}', '"manual"'::jsonb, true)
    where client_id = 'route-change';
    update public.active_route_items_cloud
    set data = jsonb_set(data, '{comment}', '"seguimiento"'::jsonb, true)
    where client_id = 'route-change';
  `);
  const manual = (await db.query("select data from active_route_items_cloud where client_id='route-change'")).rows[0].data;
  assert.equal(manual.assignedDelta, "delta1", "La reasignación manual posterior debe conservarse mientras no cambie la ruta.");
  assert.equal(manual.assignedDeltaMode, "manual");

  await db.exec(`update public.active_route_items_cloud
    set data = jsonb_set(data, '{routeAssignment}', '"PTY"'::jsonb, true)
    where client_id = 'route-change';`);
  const pty = (await db.query("select data from active_route_items_cloud where client_id='route-change'")).rows[0].data;
  assert.equal(pty.assignedDelta, "delta1", "WC→PTY debe pasar el carro a Delta 1.");
  assert.equal(pty.assignedDeltaMode, "route-default");

  console.log("OK DB Delta por ruta: PTY→Delta 1, WC→Delta 2 y la edición manual posterior se conserva.");
} finally {
  await db.close();
}
