import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { PGlite } from "../.tmp/lead-portal-tests/node_modules/@electric-sql/pglite/dist/index.js";

const db = new PGlite();
await db.exec(`
  create role anon;
  create role authenticated;
  create role service_role;
  create schema auth;
  create schema storage;
  create schema extensions;
  create or replace function extensions.gen_salt(p_kind text, p_rounds integer) returns text language sql immutable as
    $$ select 'test-salt'::text $$;
  create or replace function extensions.crypt(p_value text, p_salt text) returns text language sql immutable as
    $$ select p_value $$;
  create or replace function extensions.digest(p_value text, p_kind text) returns bytea language sql immutable as
    $$ select convert_to(p_value, 'UTF8') $$;
  create or replace function extensions.gen_random_bytes(p_length integer) returns bytea language sql volatile as
    $$ select decode(repeat('ab', p_length), 'hex') $$;
  create table auth.users(id uuid primary key);
  create or replace function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
  create table public.clients_cloud(user_id uuid not null, id text not null, data jsonb not null, created_at timestamptz default now(), updated_at timestamptz default now(), primary key(user_id,id));
  create table public.payments_cloud(user_id uuid not null, id text not null, data jsonb not null, created_at timestamptz default now(), updated_at timestamptz default now(), primary key(user_id,id));
  create table public.notified_payments_cloud(user_id uuid not null, id text not null, data jsonb not null, created_at timestamptz default now(), updated_at timestamptz default now(), primary key(user_id,id));
  create table public.notified_payment_tombstones(user_id uuid not null, notice_id text not null, consumed_by_payment_id text, reason text not null, consumed_at timestamptz not null default now(), primary key(user_id,notice_id));
  create table public.fleet_units_cloud(user_id uuid not null, unit_id text not null, brand_model text, plate text, year integer, color text, operational_status text, primary key(user_id,unit_id));
  create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects(id uuid default gen_random_uuid() primary key, bucket_id text, name text, metadata jsonb);
  create or replace function public.can_view_owner_screen(p_owner uuid, p_screen text) returns boolean language sql stable as $$ select auth.uid() = p_owner $$;
  create or replace function public.can_edit_owner_screen(p_owner uuid, p_screen text) returns boolean language sql stable as $$ select auth.uid() = p_owner $$;
`);

const migration = (await fs.readFile(new URL("../supabase/117-client-portal.sql", import.meta.url), "utf8"))
  .replace("create extension if not exists pgcrypto with schema extensions;", "-- pgcrypto is stubbed above for PGlite");
await db.exec(migration);

const owner = "11111111-1111-4111-8111-111111111111";
await db.query("insert into auth.users(id) values($1)", [owner]);
await db.query("select set_config('app.uid',$1,false)", [owner]);
await db.query(`insert into public.clients_cloud(user_id,id,data) values($1,'client-1',$2)`, [owner, JSON.stringify({
  id: "client-1", name: "Carlos Mendoza", cedula: "8-921-1234", unitId: "042", status: "activo",
  rentAmount: 85, frequency: "weekly", weeklyChargeDay: "saturday", installmentsAgreed: 100,
  installmentsIssued: 10, installmentsRemaining: 90, installmentsPaid: 10, balance: 85,
  advanceBalance: 0, otherCharges: [], fines: [], tickets: []
})]);
await db.query(`insert into public.clients_cloud(user_id,id,data) values($1,'client-2',$2)`, [owner, JSON.stringify({
  id: "client-2", name: "Carlos Mendoza", cedula: "8-921-1234", unitId: "043", status: "activo",
  rentAmount: 95, frequency: "weekly", weeklyChargeDay: "friday", installmentsAgreed: 80,
  installmentsIssued: 8, installmentsRemaining: 72, installmentsPaid: 8, balance: 190,
  advanceBalance: 0, otherCharges: [], fines: [], tickets: []
})]);
await db.query(`insert into public.fleet_units_cloud(user_id,unit_id,brand_model,plate,year,operational_status) values($1,'042','Toyota Yaris','CM 4821',2022,'activo')`, [owner]);
await db.query(`insert into public.fleet_units_cloud(user_id,unit_id,brand_model,plate,year,operational_status) values($1,'043','Kia Soluto','CM 9901',2023,'activo')`, [owner]);

const configured = await db.query(`select public.configure_client_portal_access($1,'client-1','258036') as value`, [owner]);
assert.equal(configured.rows[0].value.configured, true);
const sharedAccess = await db.query(`select public.client_portal_access_status($1,'client-2') as value`, [owner]);
assert.equal(sharedAccess.rows[0].value.active, true);

const rejectedLogin = await db.query(`select public.client_portal_login('8-921-1234','111111') as value`);
assert.equal(rejectedLogin.rows[0].value.error, "PORTAL_INVALID_CREDENTIALS");
const failedAttempt = await db.query(`select failed_attempts from public.client_portal_accounts where client_id='client-1'`);
assert.equal(failedAttempt.rows[0].failed_attempts, 1);

const login = await db.query(`select public.client_portal_login('8-921-1234','258036') as value`);
const token = login.rows[0].value.token;
assert.equal(typeof token, "string");
assert.equal(token.length, 64);

const snapshot = await db.query(`select public.client_portal_snapshot($1) as value`, [token]);
assert.equal(snapshot.rows[0].value.client.name, "Carlos Mendoza");
assert.equal(snapshot.rows[0].value.client.unitId, "042");
assert.equal(snapshot.rows[0].value.vehicle.plate, "CM 4821");
assert.deepEqual(snapshot.rows[0].value.units.map((unit) => unit.client.unitId), ["042", "043"]);

const sha = "a".repeat(64);
const prepared = await db.query(`select public.prepare_client_payment_notice($1,'client-2',85,'pago.png','image/png',100,$2) as value`, [token, sha]);
const noticeId = prepared.rows[0].value.noticeId;
const path = prepared.rows[0].value.path;
await db.query(`insert into storage.objects(bucket_id,name,metadata) values('client-payment-evidence',$1,'{"size":100}')`, [path]);
await db.query(`select public.finalize_client_payment_notice($1,'client-2',$2,85,'pago.png',$3,'image/png',100,$4,'ach_xpress')`, [token, noticeId, path, sha]);

const notified = await db.query(`select data from public.notified_payments_cloud where id=$1`, [noticeId]);
assert.equal(notified.rows[0].data.source, "client-portal");
assert.equal(notified.rows[0].data.amount, 85);
assert.equal(notified.rows[0].data.clientId, "client-2");
assert.equal(notified.rows[0].data.portalPaymentChannel, "ach_xpress");
const snapshotWithNotice = await db.query(`select public.client_portal_snapshot($1) as value`, [token]);
assert.equal(snapshotWithNotice.rows[0].value.notices[0].paymentChannel, "ach_xpress");

await db.query(`insert into public.notified_payment_tombstones(user_id,notice_id,consumed_by_payment_id,reason) values($1,$2,'payment-1','bank_payment_applied')`, [owner, noticeId]);
const confirmed = await db.query(`select status,payment_id from public.client_payment_notices where id=$1`, [noticeId]);
assert.deepEqual(confirmed.rows[0], { status: "confirmed", payment_id: "payment-1" });

const rejectedSha = "b".repeat(64);
const rejectedPreparation = await db.query(`select public.prepare_client_payment_notice($1,'client-1',42,'otro.png','image/png',101,$2) as value`, [token, rejectedSha]);
const rejectedNoticeId = rejectedPreparation.rows[0].value.noticeId;
const rejectedPath = rejectedPreparation.rows[0].value.path;
await db.query(`insert into storage.objects(bucket_id,name,metadata) values('client-payment-evidence',$1,'{"size":101}')`, [rejectedPath]);
await db.query(`select public.finalize_client_payment_notice($1,'client-1',$2,42,'otro.png',$3,'image/png',101,$4,'regular_transfer')`, [token, rejectedNoticeId, rejectedPath, rejectedSha]);
await db.query(`delete from public.notified_payments_cloud where id=$1`, [rejectedNoticeId]);
const rejected = await db.query(`select status,rejection_reason from public.client_payment_notices where id=$1`, [rejectedNoticeId]);
assert.equal(rejected.rows[0].status, "rejected");
assert.match(rejected.rows[0].rejection_reason, /descartado/i);
const retryAfterRejection = await db.query(`select public.prepare_client_payment_notice($1,'client-1',42,'otro.png','image/png',101,$2) as value`, [token, rejectedSha]);
assert.equal(typeof retryAfterRejection.rows[0].value.noticeId, "string");

await db.close();
console.log("OK client portal: cedula + one PIN, multiple units, isolated balances, classified evidence notice, rejection and payment confirmation sync.");
