import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "../.tmp/lead-portal-tests/node_modules/@electric-sql/pglite/dist/index.js";

const sql = readFileSync("supabase/93-notified-route-review-backfill.sql", "utf8");
assert.equal(sql, readFileSync("supabase/migrations/20260926000500_notified_route_review_backfill.sql", "utf8"));

const db = new PGlite();
const owner = "11111111-1111-4111-8111-111111111111";
const payer = "22222222-2222-4222-8222-222222222222";

try {
  await db.exec(`
    create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key);
    insert into auth.users values ('${owner}'),('${payer}');
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table public.user_profiles(id uuid primary key,email text,role text,is_active boolean,owner_id uuid,payments_edit boolean);
    insert into public.user_profiles values
      ('${owner}','owner@test.local','admin',true,'${owner}',true),
      ('${payer}','payer@test.local','operador',true,'${owner}',true);
    create function public.can_edit_owner_screen(o uuid,s text) returns boolean language sql security definer as $$
      select exists(select 1 from public.user_profiles where id=auth.uid() and is_active and owner_id=o and payments_edit and s='payments')
    $$;
    create table public.active_route_items_cloud(user_id uuid,client_id text,data jsonb,primary key(user_id,client_id));
    create table public.notified_payments_cloud(
      user_id uuid,id text,data jsonb not null,created_at timestamptz default now(),updated_at timestamptz default now(),primary key(user_id,id)
    );
    create table public.route_payment_reports(
      id uuid primary key default gen_random_uuid(), user_id uuid not null, client_id text not null,
      published_at text not null, snapshot jsonb not null, amount numeric(12,2) not null,
      method text not null, cash_amount numeric(12,2) not null default 0, bank_amount numeric(12,2) not null default 0,
      confirmed_cash_amount numeric(12,2) not null default 0, confirmed_bank_amount numeric(12,2) not null default 0,
      status text not null default 'review', reported_by uuid not null, reporter_name text not null,
      reported_at timestamptz not null default clock_timestamp(), confirmed_payment_id text, confirmed_at timestamptz,
      cancelled_by uuid, cancelled_at timestamptz
    );
    insert into active_route_items_cloud values
      ('${owner}','a91-client','{"clientId":"a91-client","unitId":"A91","routeAssignment":"WC","publishedAt":"2026-09-26T11:52:37Z","releaseAmount":40}');
    insert into notified_payments_cloud(user_id,id,data) values
      ('${owner}','a91-notice','{"clientId":"a91-client","amount":39.91,"createdAt":"2026-09-26T18:53:22Z"}'),
      ('${owner}','off-route','{"clientId":"b00-client","amount":25,"createdAt":"2026-09-26T19:00:00Z"}');
  `);

  await db.exec(sql);
  await db.exec(sql);

  let a91Notice = (await db.query("select data from notified_payments_cloud where id='a91-notice'")).rows[0].data;
  assert.ok(a91Notice.routeReportId, "the existing A91 notice is linked during backfill");
  assert.equal(a91Notice.routeAssignment, "WC");
  let a91Report = (await db.query("select * from route_payment_reports where client_id='a91-client'")).rows[0];
  assert.equal(a91Report.status, "review");
  assert.equal(a91Report.method, "bank");
  assert.equal(Number(a91Report.bank_amount), 39.91);
  assert.equal((await db.query("select data->>'routeReportId' as id from notified_payments_cloud where id='off-route'")).rows[0].id, null);

  await db.exec("delete from notified_payments_cloud where id='a91-notice'");
  a91Report = (await db.query("select * from route_payment_reports where client_id='a91-client'")).rows[0];
  assert.equal(a91Report.status, "cancelled", "deleting the notice cancels the Route report");

  await db.exec(`insert into active_route_items_cloud values
    ('${owner}','b00-client','{"clientId":"b00-client","unitId":"B00","routeAssignment":"PTY","publishedAt":"2026-09-26T20:00:00Z","releaseAmount":25}')`);
  assert.ok((await db.query("select data->>'routeReportId' as id from notified_payments_cloud where id='off-route'")).rows[0].id, "an old notice links when its unit later enters Route");

  await db.exec(`insert into active_route_items_cloud values
    ('${owner}','c00-client','{"clientId":"c00-client","unitId":"C00","routeAssignment":"PTY","publishedAt":"2026-09-26T20:05:00Z","releaseAmount":30}')`);
  await db.exec(`insert into notified_payments_cloud(user_id,id,data) values
    ('${owner}','new-notice','{"clientId":"c00-client","amount":30,"createdAt":"2026-09-26T20:06:00Z"}')`);
  assert.ok((await db.query("select data->>'routeReportId' as id from notified_payments_cloud where id='new-notice'")).rows[0].id, "a new notice links immediately when the unit is already in Route");

  console.log("OK: existing, future-route, and new notices reconcile with active Route; off-route notices stay isolated; delete cancels both sides");
} finally {
  await db.close();
}
