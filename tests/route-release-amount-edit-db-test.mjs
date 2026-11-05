import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "../.tmp/lead-portal-tests/node_modules/@electric-sql/pglite/dist/index.js";

const numberedSql = readFileSync("supabase/124-route-release-amount-after-confirmed-payment.sql", "utf8");
const migrationSql = readFileSync("supabase/migrations/20261105000100_route_release_amount_after_confirmed_payment.sql", "utf8");
assert.equal(numberedSql, migrationSql, "the numbered SQL and migration must remain identical");

const db = new PGlite();
const owner = "11111111-1111-4111-8111-111111111111";
const admin = "22222222-2222-4222-8222-222222222222";
const delta = "33333333-3333-4333-8333-333333333333";
const clientId = "d62-client";
const publishedAt = "2026-11-03T10:11:59.109323+00:00";

try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key);
    insert into auth.users values ('${owner}'), ('${admin}'), ('${delta}');
    create function auth.uid() returns uuid language sql as
      $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;

    create table public.user_profiles(id uuid primary key, email text not null, owner_id uuid not null, can_edit boolean not null);
    insert into public.user_profiles values
      ('${admin}', 'admin@example.com', '${owner}', true),
      ('${delta}', 'delta1@example.com', '${owner}', true);

    create function public.can_edit_owner_screen(o uuid, s text) returns boolean
    language sql security definer as $$
      select exists(
        select 1 from public.user_profiles
        where id = auth.uid() and owner_id = o and can_edit
      )
    $$;

    create table public.active_route_items_cloud(
      user_id uuid not null,
      client_id text not null,
      data jsonb not null,
      updated_at timestamptz not null default clock_timestamp(),
      primary key(user_id, client_id)
    );
    create table public.route_payment_reports(
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null,
      client_id text not null,
      published_at text not null,
      status text not null
    );
    insert into public.active_route_items_cloud(user_id, client_id, data) values(
      '${owner}', '${clientId}',
      '{"clientId":"${clientId}","unitId":"D62","publishedAt":"${publishedAt}","releaseAmount":200}'
    );
  `);

  await db.exec(numberedSql);
  await db.exec(numberedSql);

  const login = (id) => db.exec(`
    reset role;
    set request.jwt.claim.sub = '${id}';
    set role authenticated;
  `);
  const updateAmount = (amount) => db.query(
    "select update_active_route_release_amount($1,$2,$3,$4)",
    [owner, clientId, publishedAt, amount]
  );
  const routeData = async () => {
    await db.exec("reset role");
    return (
      await db.query("select data from active_route_items_cloud where user_id=$1 and client_id=$2", [owner, clientId])
    ).rows[0].data;
  };

  await db.query(
    "insert into route_payment_reports(user_id,client_id,published_at,status) values($1,$2,$3,'confirmed')",
    [owner, clientId, publishedAt]
  );
  await login(admin);
  await updateAmount(100);

  let data = await routeData();
  assert.equal(Number(data.releaseAmount), 100, "a confirmed payment must not block a balance correction");
  assert.equal(data.releaseAmountEdits.length, 1);
  assert.equal(Number(data.releaseAmountEdits[0].previousAmount), 200);
  assert.equal(Number(data.releaseAmountEdits[0].amount), 100);
  assert.equal(data.releaseAmountEdits[0].by, admin);

  await db.exec("reset role");
  await db.query(
    "insert into route_payment_reports(user_id,client_id,published_at,status) values($1,$2,$3,'review')",
    [owner, clientId, publishedAt]
  );
  await login(admin);
  await assert.rejects(updateAmount(80), /pago pendiente de revision/);
  data = await routeData();
  assert.equal(Number(data.releaseAmount), 100, "a pending report must keep the previous amount unchanged");
  assert.equal(data.releaseAmountEdits.length, 1);

  await db.exec("reset role; update route_payment_reports set status='cancelled' where status='review';");
  await login(admin);
  await updateAmount(80);
  assert.equal(Number((await routeData()).releaseAmount), 80, "cancelled reports must not block corrections");

  await login(delta);
  await assert.rejects(updateAmount(70), /perfiles de buscador/);
} finally {
  await db.close();
}

console.log("OK: confirmed and cancelled reports allow amount corrections; review reports and Delta profiles remain blocked");
