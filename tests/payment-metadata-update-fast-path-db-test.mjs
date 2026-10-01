import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "../.tmp/lead-portal-tests/node_modules/@electric-sql/pglite/dist/index.js";

const db = new PGlite();
const owner = "11111111-1111-4111-8111-111111111111";
const migration = readFileSync("supabase/migrations/20260926000200_payment_metadata_update_fast_path.sql", "utf8");

assert.equal(migration, readFileSync("supabase/90-payment-metadata-update-fast-path.sql", "utf8"));

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
  language plpgsql as $$ begin return case when tg_op = 'DELETE' then old else new end; end; $$;
  create trigger refresh_latest_payment_for_payment_row
  after insert or update or delete on public.payments_cloud
  for each row execute function public.refresh_latest_payment_for_payment_row();

  insert into public.clients_cloud(user_id,id,data) values
    ('${owner}','client-1','{"id":"client-1","unitId":"C35","name":"Marcos Carrion","cedula":"8-100-100","status":"activo"}');
`);

const payment = {
  id: "payment-1",
  clientId: "client-1",
  clientUnit: "C35",
  clientName: "Marcos Carrion",
  clientCedula: "8-100-100",
  dateApplied: "2026-09-26",
  createdAt: "2026-09-26T11:45:00.000Z",
  receiptDeliveryStatus: "pending"
};

await db.query(
  "insert into public.payments_cloud(user_id,id,data) values ($1,$2,$3::jsonb)",
  [owner, payment.id, JSON.stringify(payment)]
);
await db.query(
  `insert into public.latest_payments_by_client_cloud
    (user_id,client_id,payment_id,client_unit,date_applied,created_at_payment,data)
   values ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
  [owner, payment.clientId, payment.id, payment.clientUnit, payment.dateApplied, payment.createdAt, JSON.stringify(payment)]
);

await db.exec(migration);

await db.query(
  "update public.payments_cloud set data=jsonb_set(data,'{receiptDeliveryStatus}',to_jsonb('sent'::text)) where user_id=$1 and id=$2",
  [owner, payment.id]
);
assert.equal((await db.query("select count(*)::int as count from public.latest_rebuild_calls")).rows[0].count, 0,
  "Marcar un recibo como enviado no debe reconstruir el historial.");
assert.equal((await db.query(
  "select data->>'receiptDeliveryStatus' as status from public.latest_payments_by_client_cloud where user_id=$1 and payment_id=$2",
  [owner, payment.id]
)).rows[0].status, "sent", "El cache debe conservar la metadata actualizada.");

await db.query(
  "update public.payments_cloud set data=jsonb_set(data,'{dateApplied}',to_jsonb('2026-09-25'::text)) where user_id=$1 and id=$2",
  [owner, payment.id]
);
assert.equal((await db.query("select count(*)::int as count from public.latest_rebuild_calls")).rows[0].count, 1,
  "Cambiar la fecha si debe reconstruir el ultimo pago.");

console.log("OK DB recibos: metadata actualiza el cache sin recorrer payments_cloud.");
