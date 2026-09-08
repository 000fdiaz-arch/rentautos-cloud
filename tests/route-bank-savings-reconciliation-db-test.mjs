import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "../.tmp/lead-portal-tests/node_modules/@electric-sql/pglite/dist/index.js";

const db = new PGlite();
const owner = "11111111-1111-4111-8111-111111111111";
const seeker = "22222222-2222-4222-8222-222222222222";
const publishedAt = "2026-09-07T12:00:00.000Z";

try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key);
    insert into auth.users values('${owner}'),('${seeker}');
    create function auth.uid() returns uuid language sql as
      $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated,anon;

    create table public.user_profiles(id uuid primary key,role text,is_active boolean,email text,owner_id uuid,view_route boolean,edit_route boolean);
    insert into public.user_profiles values
      ('${owner}','admin',true,'Admin','${owner}',true,true),
      ('${seeker}','buscador',true,'Buscador','${owner}',true,false);
    create function public.can_view_owner_screen(o uuid,s text) returns boolean language sql security definer as
      $$select exists(select 1 from public.user_profiles where id=auth.uid() and is_active and owner_id=o and view_route)$$;
    create function public.can_edit_owner_screen(o uuid,s text) returns boolean language sql security definer as
      $$select exists(select 1 from public.user_profiles where id=auth.uid() and is_active and owner_id=o and view_route and edit_route)$$;

    create table public.active_route_items_cloud(user_id uuid,client_id text,data jsonb,primary key(user_id,client_id));
    create table public.payments_cloud(user_id uuid,id text,data jsonb,updated_at timestamptz not null default clock_timestamp(),primary key(user_id,id));
    create table public.clients_cloud(user_id uuid,id text,data jsonb);
    alter table public.active_route_items_cloud enable row level security;
    alter table public.payments_cloud enable row level security;
    alter table public.clients_cloud enable row level security;
    grant select,insert,update,delete on public.active_route_items_cloud,public.payments_cloud,public.clients_cloud to authenticated;
  `);

  for (const [clientId, unitId] of [["c1", "T29"], ["c2", "C49"], ["c3", "D61"]]) {
    await db.query("insert into active_route_items_cloud values($1,$2,$3)", [
      owner,
      clientId,
      JSON.stringify({ clientId, unitId, publishedAt, releaseAmount: clientId === "c1" ? 66 : clientId === "c2" ? 69 : 204 })
    ]);
  }

  await db.exec(readFileSync("supabase/69-route-payment-reports.sql", "utf8"));
  await db.exec(readFileSync("supabase/70-route-mixed-payment-reports.sql", "utf8"));
  await db.exec(`set request.jwt.claim.sub='${seeker}'; set role authenticated;`);

  const report = (clientId, amount) => db.query(
    "select report_route_payment_split($1,$2,$3,0,$4)",
    [owner, clientId, publishedAt, amount]
  );
  const payment = async (id, clientId, unitId, amountReceived, centavosAhorro) => {
    await db.exec("reset role");
    const time = (await db.query("select clock_timestamp() as stamp,to_char(clock_timestamp() at time zone 'America/Panama','YYYY-MM-DD') as day")).rows[0];
    const data = {
      clientId,
      clientUnit: unitId,
      amountReceived,
      centavosAhorro,
      appliedToRent: amountReceived - centavosAhorro,
      paymentMethod: "ACH Express",
      createdAt: time.stamp,
      dateApplied: time.day,
      fundsReceivedDate: time.day
    };
    await db.query("insert into payments_cloud(user_id,id,data) values($1,$2,$3)", [owner, id, JSON.stringify(data)]);
    await db.exec(`set request.jwt.claim.sub='${seeker}'; set role authenticated;`);
  };

  await report("c1", 66);
  await payment("t29-payment", "c1", "T29", 66.29, 0.29);
  assert.equal((await db.query("select status from route_payment_reports where client_id='c1'")).rows[0].status, "review");

  const manualSql = readFileSync("supabase/78-route-bank-savings-reconciliation.sql", "utf8");
  const migrationSql = readFileSync("supabase/migrations/20260907000200_route_bank_savings_reconciliation.sql", "utf8");
  assert.equal(manualSql, migrationSql);
  await db.exec("reset role");
  await db.exec(migrationSql);
  await db.exec(migrationSql);

  let row = (await db.query("select * from route_payment_reports where client_id='c1'")).rows[0];
  assert.equal(row.status, "confirmed", "La migración reconcilia el pago bancario existente");
  assert.equal(Number(row.confirmed_bank_amount), 66);
  assert.equal(Number(row.confirmed_bank_received_amount), 66.29);
  assert.equal(Number(row.confirmed_bank_savings_amount), 0.29);

  await db.exec(`set request.jwt.claim.sub='${seeker}'; set role authenticated;`);
  await report("c2", 69);
  await payment("c49-payment", "c2", "C49", 69.49, 0.49);
  row = (await db.query("select * from route_payment_reports where client_id='c2'")).rows[0];
  assert.equal(row.status, "confirmed", "Un pago nuevo confirma por monto sin ahorro");
  assert.equal(Number(row.confirmed_bank_received_amount), 69.49);
  assert.equal(Number(row.confirmed_bank_savings_amount), 0.49);

  await report("c3", 204);
  await payment("d61-short", "c3", "D61", 203.61, 0.61);
  row = (await db.query("select * from route_payment_reports where client_id='c3'")).rows[0];
  assert.equal(row.status, "review", "Un faltante real no se acepta como diferencia de ahorro");
  assert.equal(Number(row.confirmed_bank_amount), 0);

  console.log("OK: banco confirma por monto recibido menos ahorro, reconcilia pendientes y no acepta faltantes");
} finally {
  await db.close();
}
