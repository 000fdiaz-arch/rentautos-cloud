import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "../.tmp/lead-portal-tests/node_modules/@electric-sql/pglite/dist/index.js";

const db = new PGlite();
const owner = "11111111-1111-4111-8111-111111111111";
const migrationPath = "supabase/migrations/20260924000200_payment_insert_latest_fast_path.sql";
const migration = readFileSync(migrationPath, "utf8");

assert.equal(migration, readFileSync("supabase/88-payment-insert-latest-fast-path.sql", "utf8"));

await db.exec(`
  create role authenticated;
  create table public.clients_cloud (
    user_id uuid not null,
    id text not null,
    data jsonb not null,
    primary key (user_id, id)
  );
  create table public.payments_cloud (
    user_id uuid not null,
    id text not null,
    data jsonb not null,
    updated_at timestamptz not null default now(),
    primary key (user_id, id)
  );
  create table public.latest_payments_by_client_cloud (
    user_id uuid not null,
    client_id text not null,
    payment_id text not null,
    client_unit text,
    date_applied text,
    created_at_payment text,
    data jsonb not null,
    updated_at timestamptz not null default now(),
    primary key (user_id, client_id)
  );
  create table public.latest_rebuild_calls (user_id uuid, client_id text);

  create function public.receivable_identity_unit(value text) returns text
  language sql immutable as $$ select upper(regexp_replace(coalesce(value, ''), '[^a-zA-Z0-9]', '', 'g')) $$;
  create function public.rebuild_latest_payment_for_client(owner_id uuid, target_client_id text) returns void
  language plpgsql as $$
  begin
    insert into public.latest_rebuild_calls values (owner_id, target_client_id);
  end;
  $$;
  create function public.refresh_latest_payment_for_payment_row() returns trigger
  language plpgsql as $$ begin return new; end; $$;
  create trigger refresh_latest_payment_for_payment_row
  after insert or update or delete on public.payments_cloud
  for each row execute function public.refresh_latest_payment_for_payment_row();

  insert into public.clients_cloud(user_id,id,data) values
    ('${owner}','client-1','{"id":"client-1","unitId":"E02","status":"activo"}'),
    ('${owner}','client-archived','{"id":"client-archived","unitId":"Z99","status":"archivado","archivedAt":"2026-09-01"}');
`);

await db.exec(migration);

const payment = (id, dateApplied, createdAt, extra = {}) => ({
  id,
  clientId: "client-1",
  clientUnit: "E02",
  dateApplied,
  createdAt,
  paymentMethod: "ACH Express",
  ...extra
});

await db.query(
  "insert into public.payments_cloud(user_id,id,data) values ($1,$2,$3::jsonb)",
  [owner, "payment-new", JSON.stringify(payment("payment-new", "2026-09-24", "2026-09-24T15:51:00.000Z"))]
);
assert.equal((await db.query("select count(*)::int as count from public.latest_rebuild_calls")).rows[0].count, 0,
  "Un pago bancario nuevo no debe reconstruir el historial.");
assert.equal((await db.query("select payment_id from public.latest_payments_by_client_cloud where client_id='client-1'")).rows[0].payment_id, "payment-new");

await db.query(
  "insert into public.payments_cloud(user_id,id,data) values ($1,$2,$3::jsonb)",
  [owner, "payment-old", JSON.stringify(payment("payment-old", "2026-09-23", "2026-09-23T10:00:00.000Z"))]
);
assert.equal((await db.query("select payment_id from public.latest_payments_by_client_cloud where client_id='client-1'")).rows[0].payment_id, "payment-new",
  "Un pago historico insertado despues no debe reemplazar el pago mas reciente.");
assert.equal((await db.query("select count(*)::int as count from public.latest_rebuild_calls")).rows[0].count, 0);

await db.query(
  "update public.payments_cloud set data = jsonb_set(data, '{clientName}', to_jsonb('Cliente Uno'::text)) where user_id=$1 and id='payment-old'",
  [owner]
);
assert.equal((await db.query("select count(*)::int as count from public.latest_rebuild_calls")).rows[0].count, 1,
  "UPDATE conserva la reconstruccion segura del historial.");

await db.query(
  "insert into public.payments_cloud(user_id,id,data) values ($1,$2,$3::jsonb)",
  [owner, "payment-archived", JSON.stringify({
    ...payment("payment-archived", "2026-09-24", "2026-09-24T16:00:00.000Z"),
    clientId: "client-archived",
    clientUnit: "Z99"
  })]
);
assert.equal((await db.query("select count(*)::int as count from public.latest_payments_by_client_cloud where client_id='client-archived'")).rows[0].count, 0,
  "Un cliente archivado no debe aparecer en el cache de cobros activos.");

console.log("OK DB pagos: INSERT bancario actualiza latest directamente sin recorrer payments_cloud.");
