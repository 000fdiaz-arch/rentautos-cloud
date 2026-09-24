import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "../.tmp/lead-portal-tests/node_modules/@electric-sql/pglite/dist/index.js";

const db = new PGlite();
const owner = "11111111-1111-4111-8111-111111111111";
const migrationPath = "supabase/migrations/20260924000100_fleet_status_timeout_fast_path.sql";
const migration = readFileSync(migrationPath, "utf8");

assert.equal(migration, readFileSync("supabase/87-fleet-status-timeout-fast-path.sql", "utf8"));

await db.exec(`
  create table public.clients_cloud (
    user_id uuid not null,
    id text not null,
    data jsonb not null,
    primary key (user_id, id)
  );
  create table public.latest_payments_by_client_cloud (
    user_id uuid not null,
    client_id text not null,
    marker text,
    primary key (user_id, client_id)
  );
  create table public.latest_rebuild_calls (user_id uuid, client_id text);

  create function public.receivable_identity_unit(value text) returns text
  language sql immutable as $$ select upper(regexp_replace(coalesce(value, ''), '[^a-zA-Z0-9]', '', 'g')) $$;
  create function public.receivable_identity_cedula(value text) returns text
  language sql immutable as $$ select regexp_replace(coalesce(value, ''), '[^0-9]', '', 'g') $$;
  create function public.receivable_identity_name(value text) returns text
  language sql immutable as $$ select lower(btrim(coalesce(value, ''))) $$;
  create function public.rebuild_latest_payment_for_client(owner_id uuid, target_client_id text) returns void
  language plpgsql as $$
  begin
    insert into public.latest_rebuild_calls values (owner_id, target_client_id);
    insert into public.latest_payments_by_client_cloud values (owner_id, target_client_id, 'rebuilt')
    on conflict (user_id, client_id) do update set marker = excluded.marker;
  end;
  $$;
  create function public.refresh_latest_payment_for_client_row() returns trigger
  language plpgsql as $$ begin return new; end; $$;
  create trigger refresh_latest_payment_for_client_row
  after insert or update or delete on public.clients_cloud
  for each row execute function public.refresh_latest_payment_for_client_row();
`);

await db.exec(migration);
await db.query(
  "insert into public.clients_cloud values ($1, 'client-1', $2::jsonb)",
  [owner, JSON.stringify({ unitId: "A1", cedula: "8-100", name: "Cliente Uno", status: "activo", balance: 10 })]
);
assert.equal((await db.query("select count(*)::int as count from public.latest_rebuild_calls")).rows[0].count, 1);

await db.exec("truncate public.latest_rebuild_calls");
await db.query(
  "update public.clients_cloud set data = jsonb_set(data, '{status}', to_jsonb($2::text)) where user_id = $1 and id = 'client-1'",
  [owner, "taller"]
);
assert.equal((await db.query("select count(*)::int as count from public.latest_rebuild_calls")).rows[0].count, 0);
assert.equal((await db.query("select marker from public.latest_payments_by_client_cloud")).rows[0].marker, "rebuilt");

await db.query(
  "update public.clients_cloud set data = jsonb_set(jsonb_set(data, '{status}', to_jsonb('archivado'::text)), '{archivedAt}', to_jsonb('2026-09-24'::text)) where user_id = $1 and id = 'client-1'",
  [owner]
);
assert.equal((await db.query("select count(*)::int as count from public.latest_rebuild_calls")).rows[0].count, 0);
assert.equal((await db.query("select count(*)::int as count from public.latest_payments_by_client_cloud")).rows[0].count, 0);

await db.query(
  "update public.clients_cloud set data = jsonb_set(data - 'archivedAt', '{status}', to_jsonb('activo'::text)) where user_id = $1 and id = 'client-1'",
  [owner]
);
assert.equal((await db.query("select count(*)::int as count from public.latest_rebuild_calls")).rows[0].count, 1);

await db.exec("truncate public.latest_rebuild_calls");
await db.query(
  "update public.clients_cloud set data = jsonb_set(data, '{unitId}', to_jsonb('B2'::text)) where user_id = $1 and id = 'client-1'",
  [owner]
);
assert.equal((await db.query("select count(*)::int as count from public.latest_rebuild_calls")).rows[0].count, 1);

console.log("OK DB Autos: cambios operativos omiten historial; archivo, reactivacion e identidad conservan cache correcta.");
