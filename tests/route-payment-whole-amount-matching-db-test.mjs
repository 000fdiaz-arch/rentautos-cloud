import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "../.tmp/lead-portal-tests/node_modules/@electric-sql/pglite/dist/index.js";

const db = new PGlite();
const owner = "11111111-1111-4111-8111-111111111111";
const seeker = "22222222-2222-4222-8222-222222222222";
const publishedAt = "2026-09-28T12:00:00.000Z";

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

  for (const [clientId, unitId] of [["d47", "D47"], ["c90", "C90"], ["c91", "C91"]]) {
    await db.query("insert into active_route_items_cloud values($1,$2,$3)", [
      owner,
      clientId,
      JSON.stringify({ clientId, unitId, publishedAt, releaseAmount: 300 })
    ]);
  }

  await db.exec(readFileSync("supabase/69-route-payment-reports.sql", "utf8"));
  await db.exec(readFileSync("supabase/70-route-mixed-payment-reports.sql", "utf8"));
  await db.exec(readFileSync("supabase/78-route-bank-savings-reconciliation.sql", "utf8"));
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
      appliedToRent: Math.trunc(amountReceived),
      paymentMethod: "ACH Express",
      createdAt: time.stamp,
      dateApplied: time.day,
      fundsReceivedDate: time.day
    };
    await db.query("insert into payments_cloud(user_id,id,data) values($1,$2,$3)", [owner, id, JSON.stringify(data)]);
    await db.exec(`set request.jwt.claim.sub='${seeker}'; set role authenticated;`);
  };

  await report("d47", 50.47);
  await payment("d47-payment", "d47", "D47", 50.47, 0.47);
  await report("c90", 204.90);
  await payment("c90-payment", "c90", "C90", 204.90, 0.90);
  await report("c91", 51);
  await payment("c91-payment", "c91", "C91", 50.99, 0.99);

  let rows = (await db.query("select client_id,status from route_payment_reports order by client_id")).rows;
  assert.deepEqual(rows.map((row) => [row.client_id, row.status]), [
    ["c90", "review"],
    ["c91", "review"],
    ["d47", "review"]
  ], "La regla anterior no concilia los montos brutos con centavos");

  const manualSql = readFileSync("supabase/96-route-payment-whole-amount-matching.sql", "utf8");
  const migrationSql = readFileSync("supabase/migrations/20260928000200_route_payment_whole_amount_matching.sql", "utf8");
  assert.equal(manualSql, migrationSql);
  const matcherSql = migrationSql.slice(0, migrationSql.indexOf("-- Reprocesa"));
  assert.match(matcherSql, /trunc\(\(p->>'amountReceived'\)::numeric\)=trunc\(r\.bank_amount\)/);
  assert.doesNotMatch(matcherSql, /appliedToRent|centavosAhorro/);

  await db.exec("reset role");
  await db.exec(migrationSql);
  await db.exec(migrationSql);

  rows = (await db.query(`
    select client_id,status,confirmed_bank_amount,confirmed_bank_received_amount,confirmed_bank_savings_amount
    from route_payment_reports order by client_id
  `)).rows;
  assert.equal(rows[0].client_id, "c90");
  assert.equal(rows[0].status, "confirmed", "C90 concilia 204.90 contra 204.90 por su parte entera");
  assert.equal(Number(rows[0].confirmed_bank_received_amount), 204.90);
  assert.equal(Number(rows[0].confirmed_bank_savings_amount), 0.90);
  assert.equal(rows[1].client_id, "c91");
  assert.equal(rows[1].status, "review", "Una diferencia en dolares completos continua pendiente");
  assert.equal(rows[2].client_id, "d47");
  assert.equal(rows[2].status, "confirmed", "D47 concilia 50.47 contra 50.47 por su parte entera");
  assert.equal(Number(rows[2].confirmed_bank_received_amount), 50.47);
  assert.equal(Number(rows[2].confirmed_bank_savings_amount), 0.47);

  console.log("OK: Ruta concilia contra amountReceived omitiendo centavos y conserva el detalle del recibo");
} finally {
  await db.close();
}
