import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "../.tmp/lead-portal-tests/node_modules/@electric-sql/pglite/dist/index.js";

const page = readFileSync("src/pages/PaymentsPage.tsx", "utf8");
const hook = readFileSync("src/pages/payments/useNotifiedPayments.ts", "utf8");
const routeHook = readFileSync("src/pages/payments/useRouteReviewNotifications.ts", "utf8");
const panel = readFileSync("src/pages/payments/NotifiedPaymentsPanel.tsx", "utf8");
const routePage = readFileSync("src/pages/RouteSearchPage.tsx", "utf8");
const summary = readFileSync("src/pages/RouteTeamSummary.tsx", "utf8");
const sql = readFileSync("supabase/92-notified-route-review-sync.sql", "utf8");
const migration = readFileSync("supabase/migrations/20260926000400_notified_route_review_sync.sql", "utf8");

assert.equal(sql, migration, "the numbered SQL and migration must remain identical");
assert.match(page, /loadCloudActiveRouteItem\(dataOwnerUserId, clientId\)/, "Payments verifies that the unit is on the active route");
assert.match(page, /if \(!item \|\| item\.removedAt\) return null;/, "off-route units remain only in Payments");
assert.match(page, /reportRoutePayment\(dataOwnerUserId, item, 0, amount\)/, "a matching notified payment becomes a bank route report");
assert.match(page, /routeReportId: report\.id/, "the notification keeps its route report link");
assert.match(page, /report\.bank_amount > report\.confirmed_bank_amount/, "Payments only shows reports with a bank portion still pending");
assert.match(page, /amount: roundMoney\(report\.bank_amount - report\.confirmed_bank_amount\)/, "a mixed report shows only its outstanding bank portion");
assert.match(page, /routePaymentMethod: "bank"/, "the unified notified row is labelled as bank reconciliation");
assert.match(hook, /if \(row\.routeReportId\) await options\.cancelRouteReview\?\.\(row\.routeReportId\)/, "deleting in Payments cancels the linked route report first");
assert.match(routeHook, /route_payment_reports/, "Payments listens to the shared route review source");
assert.match(panel, /linkedReportIds\.has\(row\.routeReportId\)/, "the shared record is rendered only once");
assert.match(sql, /can_view_owner_screen\(user_id, 'payments'\)/, "Payments can read shared route reports");
assert.match(sql, /route_report_remove_linked_notice/, "closing a route report removes its linked persisted notification");
assert.match(routePage, /'review', 'Pago notificado'/, "the Route tab uses the unified visible name");
assert.match(summary, /<small>Pago notificado<\/small>/, "the Route summary uses the unified visible name");

const db = new PGlite();
const owner = "11111111-1111-4111-8111-111111111111";
const seeker = "22222222-2222-4222-8222-222222222222";
const payer = "33333333-3333-4333-8333-333333333333";
const outsider = "44444444-4444-4444-8444-444444444444";
const reportId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
try {
  await db.exec(`
    create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key);
    insert into auth.users values ('${owner}'),('${seeker}'),('${payer}'),('${outsider}');
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table public.user_profiles(
      id uuid primary key, role text, is_active boolean, owner_id uuid,
      route_view boolean, route_edit boolean, payments_view boolean, payments_edit boolean
    );
    insert into public.user_profiles values
      ('${seeker}','buscador',true,'${owner}',true,false,false,false),
      ('${payer}','operador',true,'${owner}',false,false,true,true),
      ('${outsider}','operador',true,'${outsider}',false,false,true,true);
    create function public.can_view_owner_screen(o uuid,s text) returns boolean language sql security definer as $$
      select exists(select 1 from public.user_profiles where id=auth.uid() and is_active and owner_id=o
        and ((s='route_search' and route_view) or (s='payments' and payments_view) or (s='receivables' and false)))
    $$;
    create function public.can_edit_owner_screen(o uuid,s text) returns boolean language sql security definer as $$
      select exists(select 1 from public.user_profiles where id=auth.uid() and is_active and owner_id=o
        and ((s='route_search' and route_edit) or (s='payments' and payments_edit)))
    $$;
    create table public.route_payment_reports(
      id uuid primary key, user_id uuid not null, status text not null, reported_by uuid not null,
      cancelled_by uuid, cancelled_at timestamptz
    );
    create table public.notified_payments_cloud(user_id uuid not null,id text not null,data jsonb not null,primary key(user_id,id));
    alter table public.route_payment_reports enable row level security;
    grant usage on schema public to authenticated;
    grant select on public.route_payment_reports to authenticated;
    insert into public.route_payment_reports values('${reportId}','${owner}','review','${seeker}',null,null);
    insert into public.notified_payments_cloud values('${owner}','notice-1','{"routeReportId":"${reportId}"}');
  `);
  await db.exec(sql);
  await db.exec(sql);
  const login = async (id) => db.exec(`reset role; set request.jwt.claim.sub='${id}'; set role authenticated;`);
  await login(payer);
  assert.equal((await db.query("select id from route_payment_reports")).rows.length, 1, "Payments can read the shared report");
  await db.query("select cancel_route_payment_report($1)", [reportId]);
  await db.exec("reset role");
  assert.equal((await db.query("select status from route_payment_reports where id=$1", [reportId])).rows[0].status, "cancelled");
  assert.equal((await db.query("select id from notified_payments_cloud where user_id=$1", [owner])).rows.length, 0, "cancelling Route removes the linked notice");
  await login(outsider);
  assert.equal((await db.query("select id from route_payment_reports")).rows.length, 0, "owner isolation remains enforced");
} finally {
  await db.close();
}

console.log("OK: Pago notificado and Ruta share active-route reports, dedupe the display, and delete in both directions");
