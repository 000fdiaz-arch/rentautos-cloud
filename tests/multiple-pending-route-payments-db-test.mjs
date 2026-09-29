import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "../.tmp/lead-portal-tests/node_modules/@electric-sql/pglite/dist/index.js";

const sql = readFileSync("supabase/97-multiple-pending-route-payments.sql", "utf8");
const migration = readFileSync("supabase/migrations/20260929000100_multiple_pending_route_payments.sql", "utf8");
assert.equal(sql, migration, "the numbered SQL and migration must remain identical");

const db = new PGlite();
const owner = "11111111-1111-4111-8111-111111111111";
const reporter = "22222222-2222-4222-8222-222222222222";
const outsider = "33333333-3333-4333-8333-333333333333";
const publishedAt = "2026-09-29T14:00:00Z";

try {
  await db.exec(`
    create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key);
    insert into auth.users values ('${owner}'),('${reporter}'),('${outsider}');
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table public.user_profiles(id uuid primary key,email text,owner_id uuid,is_active boolean);
    insert into public.user_profiles values
      ('${reporter}','pty@test.local','${owner}',true),
      ('${outsider}','outside@test.local','${outsider}',true);
    create function public.can_report_route_payment(o uuid) returns boolean language sql security definer as $$
      select exists(select 1 from public.user_profiles where id=auth.uid() and owner_id=o and is_active)
    $$;
    create table public.active_route_items_cloud(user_id uuid,client_id text,data jsonb,primary key(user_id,client_id));
    insert into public.active_route_items_cloud values(
      '${owner}','c20-client',
      '{"clientId":"c20-client","unitId":"C20","clientName":"Cliente C20","routeAssignment":"PTY","publishedAt":"${publishedAt}"}'
    );
    create table public.route_payment_reports(
      id uuid primary key default gen_random_uuid(), user_id uuid not null, client_id text not null,
      published_at text not null, snapshot jsonb not null, amount numeric(12,2) not null,
      method text not null, cash_amount numeric(12,2) not null default 0, bank_amount numeric(12,2) not null default 0,
      confirmed_cash_amount numeric(12,2) not null default 0, confirmed_bank_amount numeric(12,2) not null default 0,
      status text not null default 'review', reported_by uuid not null, reporter_name text not null,
      reported_at timestamptz not null default clock_timestamp()
    );
    create unique index route_report_active_unique
      on public.route_payment_reports(user_id,client_id,published_at) where status <> 'cancelled';
  `);

  await db.exec(sql);
  await db.exec(sql);
  const login = async (id) => db.exec(`reset role; set request.jwt.claim.sub='${id}'; set role authenticated;`);
  const report = (amount) => db.query(
    "select report_route_payment_split($1,$2,$3,0,$4)",
    [owner, "c20-client", publishedAt, amount]
  );

  await login(reporter);
  await report(20.20);
  await report(12);
  await db.exec("reset role");
  const rows = (await db.query("select amount,bank_amount,status from route_payment_reports order by reported_at,id")).rows;
  assert.equal(rows.length, 2, "C20 keeps both pending transactions");
  assert.deepEqual(rows.map((row) => Number(row.bank_amount)).sort((a, b) => a - b), [12, 20.2]);
  assert.ok(rows.every((row) => row.status === "review"));

  await login(outsider);
  await assert.rejects(report(5), /permiso/);
  await db.exec("reset role");
  assert.equal((await db.query("select count(*)::int as count from route_payment_reports")).rows[0].count, 2);
} finally {
  await db.close();
}

console.log("OK: C20 can keep separate pending bank payments of 20.20 and 12 after confirmation");
