import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "../.tmp/lead-portal-tests/node_modules/@electric-sql/pglite/dist/index.js";

const db = new PGlite();
const owner = "11111111-1111-4111-8111-111111111111";
const admin = "22222222-2222-4222-8222-222222222222";
const seeker = "33333333-3333-4333-8333-333333333333";
const publishedAt = "2026-10-11T12:00:00.000Z";

try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key);
    insert into auth.users values ('${owner}'), ('${admin}'), ('${seeker}');
    create function auth.uid() returns uuid language sql as
      $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
    grant usage on schema auth to authenticated, anon;
    grant execute on function auth.uid() to authenticated, anon;

    create table public.user_profiles(
      id uuid primary key, role text, is_active boolean, owner_id uuid,
      can_edit_payments boolean, can_view_route boolean
    );
    insert into public.user_profiles values
      ('${owner}', 'admin', true, '${owner}', true, true),
      ('${admin}', 'admin', true, '${owner}', true, true),
      ('${seeker}', 'buscador', true, '${owner}', false, true);

    create function public.can_access_owner_data(o uuid) returns boolean language sql security definer as
      $$select exists(select 1 from public.user_profiles where id = auth.uid() and is_active and owner_id = o)$$;
    create function public.can_edit_owner_screen(o uuid, s text) returns boolean language sql security definer as
      $$select exists(select 1 from public.user_profiles where id = auth.uid() and is_active and owner_id = o and s = 'payments' and can_edit_payments)$$;
    create function public.can_view_owner_screen(o uuid, s text) returns boolean language sql security definer as
      $$select exists(select 1 from public.user_profiles where id = auth.uid() and is_active and owner_id = o and s = 'route_search' and can_view_route)$$;
    create function public.can_report_route_payment(o uuid) returns boolean language sql security definer as
      $$select public.can_view_owner_screen(o, 'route_search')$$;
    create function public.is_valid_admin_route_bank_confirmation(o uuid, p jsonb) returns boolean language sql as $$select false$$;

    create table public.active_route_items_cloud(
      user_id uuid, client_id text, data jsonb,
      in_custody boolean not null default false, custody_since timestamptz,
      custody_changed_at timestamptz, custody_changed_by uuid,
      custody_history jsonb not null default '[]', updated_at timestamptz default now(),
      primary key(user_id, client_id)
    );
    create table public.payments_cloud(
      user_id uuid, id text, data jsonb not null, primary key(user_id, id)
    );
    alter table public.payments_cloud enable row level security;
    create table public.route_payment_reports(
      id uuid primary key, user_id uuid not null, client_id text not null,
      published_at text not null, snapshot jsonb not null,
      amount numeric(12,2) not null, method text not null,
      cash_amount numeric(12,2) not null default 0,
      bank_amount numeric(12,2) not null default 0,
      confirmed_cash_amount numeric(12,2) not null default 0,
      confirmed_bank_amount numeric(12,2) not null default 0,
      confirmed_bank_received_amount numeric(12,2) not null default 0,
      confirmed_bank_savings_amount numeric(12,2) not null default 0,
      status text not null default 'review', reported_by uuid not null,
      reporter_name text not null, reported_at timestamptz not null default now(),
      confirmed_payment_id text, confirmed_at timestamptz
    );
    create table public.route_report_payment_links(
      report_id uuid, user_id uuid, payment_id text, method text
    );
    grant select on public.route_payment_reports, public.active_route_items_cloud, public.payments_cloud to authenticated;
    grant insert on public.payments_cloud to authenticated;
    create policy payments_test_insert on public.payments_cloud for insert to authenticated with check (true);
    create function public.guard_payment_write_scope() returns trigger language plpgsql as $$begin return new; end$$;
    create trigger guard_payment_write_scope before insert or update on public.payments_cloud
      for each row execute function public.guard_payment_write_scope();

    insert into public.active_route_items_cloud(user_id, client_id, data) values
      ('${owner}', 'partial', '{"clientId":"partial","unitId":"P20","publishedAt":"${publishedAt}","releaseAmount":60}'),
      ('${owner}', 'full', '{"clientId":"full","unitId":"F60","publishedAt":"${publishedAt}","releaseAmount":60}');
    insert into public.route_payment_reports(id,user_id,client_id,published_at,snapshot,amount,method,bank_amount,reported_by,reporter_name) values
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','${owner}','partial','${publishedAt}','{"unitId":"P20","releaseAmount":60}',20,'bank',20,'${seeker}','Seeker'),
      ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','${owner}','full','${publishedAt}','{"unitId":"F60","releaseAmount":60}',60,'bank',60,'${seeker}','Seeker');
  `);

  const sql = readFileSync("supabase/migrations/20261011000100_visual_route_bank_confirmation.sql", "utf8");
  assert.equal(sql, readFileSync("supabase/107-visual-route-bank-confirmation.sql", "utf8"));
  await db.exec(sql);

  await db.exec(`set request.jwt.claim.sub='${admin}'; set role authenticated;`);
  const partial = (await db.query("select confirm_route_bank_report('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') as result")).rows[0].result;
  assert.equal(partial.outcome, "decision");
  assert.equal(Number(partial.confirmedAmount), 20);
  let report = (await db.query("select * from route_payment_reports where client_id='partial'")).rows[0];
  assert.equal(report.status, "confirmed");
  assert.equal(Number(report.confirmed_bank_amount), 20);
  assert.ok(report.bank_confirmed_visually_at);
  assert.equal(report.confirmed_payment_id, null);
  assert.equal((await db.query("select count(*)::int as count from payments_cloud")).rows[0].count, 0);
  assert.equal((await db.query("select data->>'removedAt' as removed from active_route_items_cloud where client_id='partial'")).rows[0].removed, null);

  const full = (await db.query("select confirm_route_bank_report('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') as result")).rows[0].result;
  assert.equal(full.outcome, "removed");
  assert.equal(Number(full.confirmedAmount), 60);
  const route = (await db.query("select data from active_route_items_cloud where client_id='full'")).rows[0].data;
  assert.ok(route.removedAt);
  assert.equal(route.removedReason, "bank_confirmed_amount_met");
  assert.equal((await db.query("select count(*)::int as count from payments_cloud")).rows[0].count, 0);

  await assert.rejects(
    db.query("insert into payments_cloud(user_id,id,data) values($1,'legacy',$2)", [owner, JSON.stringify({
      source: "route", paymentMethod: "Transferencia Bancaria", bankConfirmation: { routeReportId: "legacy" }
    })]),
    /visual y no genera recibo/
  );

  await db.exec(`reset role; set request.jwt.claim.sub='${seeker}'; set role authenticated;`);
  await assert.rejects(
    db.query("select confirm_route_bank_report('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')"),
    /Solo el administrador|ya fue confirmado/
  );
} finally {
  await db.close();
}

console.log("OK: confirmar banca en Ruta no crea pagos y decide o retira según el mínimo.");
