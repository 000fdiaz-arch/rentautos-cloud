import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "../.tmp/lead-portal-tests/node_modules/@electric-sql/pglite/dist/index.js";

const sql = readFileSync("supabase/98-notified-payment-atomic-consumption.sql", "utf8");
assert.equal(
  sql,
  readFileSync("supabase/migrations/20261001000100_notified_payment_atomic_consumption.sql", "utf8"),
  "the numbered SQL and migration must remain identical"
);

const db = new PGlite();
const owner = "11111111-1111-4111-8111-111111111111";

const notice = (id, createdAt, amount = 29.13, extra = {}) => ({
  id,
  clientId: "d13-client",
  amount,
  createdAt,
  paymentMethod: "bank",
  ...extra
});

const payment = (id, createdAt, amount = 29.13) => ({
  id,
  clientId: "d13-client",
  clientUnit: "D13",
  amountReceived: amount,
  paymentMethod: "Transferencia Bancaria",
  paymentContext: "regular",
  dateApplied: "2026-10-01",
  fundsReceivedDate: "2026-10-01",
  createdAt
});

try {
  await db.exec(`
    create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key);
    insert into auth.users values ('${owner}');
    create table public.notified_payments_cloud(
      user_id uuid not null references auth.users(id), id text not null, data jsonb not null,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
      primary key(user_id,id)
    );
    create table public.payments_cloud(
      user_id uuid not null references auth.users(id), id text not null, data jsonb not null,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
      primary key(user_id,id)
    );
  `);
  await db.exec(sql);
  await db.exec(sql);

  await db.query(
    "insert into notified_payments_cloud(user_id,id,data) values($1,$2,$3)",
    [owner, "notice-1", notice("notice-1", "2026-10-01T03:29:45.893Z")]
  );
  await db.query(
    "insert into payments_cloud(user_id,id,data) values($1,$2,$3)",
    [owner, "payment-1", payment("payment-1", "2026-10-01T13:33:42.700Z")]
  );
  assert.equal(
    (await db.query("select count(*)::int as count from notified_payments_cloud")).rows[0].count,
    0,
    "an applied bank payment consumes one matching notice"
  );
  assert.deepEqual(
    (await db.query("select notice_id,consumed_by_payment_id,reason from notified_payment_tombstones")).rows,
    [{ notice_id: "notice-1", consumed_by_payment_id: "payment-1", reason: "bank_payment_applied" }]
  );

  await db.query(
    "insert into notified_payments_cloud(user_id,id,data) values($1,$2,$3) on conflict(user_id,id) do update set data=excluded.data",
    [owner, "notice-1", notice("notice-1", "2026-10-01T03:29:45.893Z")]
  );
  assert.equal(
    (await db.query("select count(*)::int as count from notified_payments_cloud where id='notice-1'")).rows[0].count,
    0,
    "a stale session cannot restore a consumed notice"
  );

  await db.query(
    "insert into notified_payments_cloud(user_id,id,data) values($1,$2,$3)",
    [owner, "notice-2", notice("notice-2", "2026-10-01T03:35:00.000Z")]
  );
  assert.equal(
    (await db.query("select count(*)::int as count from notified_payments_cloud where id='notice-2'")).rows[0].count,
    1,
    "one payment cannot consume two matching notices"
  );
  await db.query(
    "insert into payments_cloud(user_id,id,data) values($1,$2,$3)",
    [owner, "payment-2", payment("payment-2", "2026-10-01T13:40:00.000Z")]
  );
  assert.equal(
    (await db.query("select count(*)::int as count from notified_payments_cloud where id='notice-2'")).rows[0].count,
    0,
    "a second payment consumes the second notice independently"
  );

  await db.query(
    "insert into payments_cloud(user_id,id,data) values($1,$2,$3)",
    [owner, "payment-3", payment("payment-3", "2026-10-01T14:00:00.000Z", 31.13)]
  );
  await db.query(
    "insert into notified_payments_cloud(user_id,id,data) values($1,$2,$3)",
    [owner, "late-notice", notice("late-notice", "2026-10-01T04:00:00.000Z", 31.13)]
  );
  assert.equal(
    (await db.query("select count(*)::int as count from notified_payments_cloud where id='late-notice'")).rows[0].count,
    0,
    "a delayed cloud write is rejected when its payment was already applied"
  );

  await db.query(
    "insert into notified_payments_cloud(user_id,id,data) values($1,$2,$3)",
    [owner, "future-notice", notice("future-notice", "2026-10-01T15:00:00.000Z", 31.13)]
  );
  assert.equal(
    (await db.query("select count(*)::int as count from notified_payments_cloud where id='future-notice'")).rows[0].count,
    1,
    "an older payment does not suppress a genuinely new notice"
  );

  await db.exec("delete from notified_payments_cloud where id='future-notice'");
  await db.query(
    "insert into notified_payments_cloud(user_id,id,data) values($1,$2,$3)",
    [owner, "future-notice", notice("future-notice", "2026-10-01T15:00:00.000Z", 31.13)]
  );
  assert.equal(
    (await db.query("select count(*)::int as count from notified_payments_cloud where id='future-notice'")).rows[0].count,
    0,
    "manual deletions are also durable across stale sessions"
  );

  console.log("OK: Pago notificado is consumed atomically, one-to-one, and cannot be resurrected by stale sessions");
} finally {
  await db.close();
}
