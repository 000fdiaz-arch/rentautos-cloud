import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "../.tmp/lead-portal-tests/node_modules/@electric-sql/pglite/dist/index.js";

const sql = readFileSync("supabase/108-route-visual-bank-payment-settlement.sql", "utf8");
assert.equal(
  sql,
  readFileSync("supabase/migrations/20261012000100_route_visual_bank_payment_settlement.sql", "utf8"),
  "the numbered SQL and migration must remain identical"
);
const fastPathSql = readFileSync("supabase/110-route-bank-confirmation-timeout-fast-path.sql", "utf8");
assert.equal(
  fastPathSql,
  readFileSync("supabase/migrations/20261013000200_route_bank_confirmation_timeout_fast_path.sql", "utf8"),
  "the timeout fast-path SQL and migration must remain identical"
);
assert.match(
  fastPathSql,
  /p\.data->>'clientId' = v_report\.client_id[\s\S]*visual_route_bank_report_matches_payment/,
  "settlement must narrow payments by client before applying the complete matcher"
);
assert.match(
  fastPathSql,
  /payments_cloud_route_bank_settlement_candidates_idx/,
  "settlement candidates need a dedicated partial index"
);
assert.match(
  fastPathSql,
  /notified_payments_cloud_route_report_idx/,
  "closing a report needs a fast path for its linked notice"
);

const noticeSql = readFileSync("supabase/98-notified-payment-atomic-consumption.sql", "utf8");
const db = new PGlite();
const owner = "11111111-1111-4111-8111-111111111111";

const report = (id, clientId, amount, reportedAt, visuallyConfirmed = true) => ({
  id,
  user_id: owner,
  client_id: clientId,
  snapshot: { unitId: clientId.toUpperCase() },
  bank_amount: amount,
  status: visuallyConfirmed ? "confirmed" : "review",
  reported_at: reportedAt,
  bank_confirmed_visually_at: visuallyConfirmed ? reportedAt : null,
  confirmed_payment_id: null
});

const payment = (id, clientId, amount, createdAt, fundsReceivedDate) => ({
  id,
  clientId,
  clientUnit: clientId.toUpperCase(),
  amountReceived: amount,
  paymentMethod: "ACH Express",
  paymentContext: "regular",
  dateApplied: fundsReceivedDate,
  fundsReceivedDate,
  createdAt
});

async function insertReport(value) {
  await db.query(
    `insert into route_payment_reports(
      id,user_id,client_id,snapshot,bank_amount,status,reported_at,
      bank_confirmed_visually_at,confirmed_payment_id
    ) values($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      value.id,
      value.user_id,
      value.client_id,
      value.snapshot,
      value.bank_amount,
      value.status,
      value.reported_at,
      value.bank_confirmed_visually_at,
      value.confirmed_payment_id
    ]
  );
}

async function insertPayment(id, data) {
  await db.query(
    "insert into payments_cloud(user_id,id,data) values($1,$2,$3)",
    [owner, id, data]
  );
}

async function settlement(reportId) {
  return (await db.query(
    "select bank_settled_payment_id,bank_settled_at from route_payment_reports where id=$1",
    [reportId]
  )).rows[0];
}

try {
  await db.exec(`
    create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key);
    insert into auth.users values ('11111111-1111-4111-8111-111111111111');

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
    create table public.route_payment_reports(
      id uuid primary key, user_id uuid not null, client_id text not null,
      snapshot jsonb not null, bank_amount numeric(12,2) not null,
      status text not null, reported_at timestamptz not null,
      bank_confirmed_visually_at timestamptz, confirmed_payment_id text
    );
    create table public.route_report_payment_links(
      report_id uuid not null, user_id uuid not null, payment_id text not null, method text not null,
      primary key(report_id,method), unique(user_id,payment_id)
    );
  `);
  await db.exec(noticeSql);

  const a27Report = report(
    "f275fc6a-05e1-4c65-a5e7-6736e8f2324b",
    "a27",
    25.27,
    "2026-10-12T02:52:42.175Z"
  );
  await insertReport(a27Report);
  await insertPayment(
    "585c83f0-9487-41bd-9e6e-355546c1024d",
    payment(
      "585c83f0-9487-41bd-9e6e-355546c1024d",
      "a27",
      25.27,
      "2026-10-12T13:24:21.993Z",
      "2026-10-12"
    )
  );

  const linkedReport = report(
    "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    "d18",
    37.18,
    "2026-10-12T19:10:38.661Z"
  );
  await insertReport(linkedReport);
  await insertPayment(
    "linked-bank-payment",
    payment("linked-bank-payment", "d18", 37.18, "2026-10-12T19:31:08.774Z", "2026-10-12")
  );
  await db.query(
    "insert into route_report_payment_links(report_id,user_id,payment_id,method) values($1,$2,$3,'bank')",
    [linkedReport.id, owner, "linked-bank-payment"]
  );

  await db.exec(sql);
  await db.exec(sql);
  await db.exec(fastPathSql);
  await db.exec(fastPathSql);

  assert.equal(
    (await settlement(a27Report.id)).bank_settled_payment_id,
    "585c83f0-9487-41bd-9e6e-355546c1024d",
    "the A27 sequence is backfilled even when the invoice is generated the next Panama day"
  );
  assert.equal(
    (await settlement(linkedReport.id)).bank_settled_payment_id,
    "linked-bank-payment",
    "an existing bank receipt link also settles a visual confirmation"
  );

  const laterReport = report(
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "b14",
    40.19,
    "2026-10-12T15:00:00.000Z"
  );
  await insertReport(laterReport);
  assert.equal((await settlement(laterReport.id)).bank_settled_payment_id, null);

  await insertPayment(
    "wrong-amount",
    payment("wrong-amount", "b14", 41.19, "2026-10-12T16:00:00.000Z", "2026-10-12")
  );
  assert.equal(
    (await settlement(laterReport.id)).bank_settled_payment_id,
    null,
    "a different invoice does not remove the notice"
  );

  await insertPayment(
    "matching-payment",
    payment("matching-payment", "b14", 40.19, "2026-10-12T16:05:00.000Z", "2026-10-12")
  );
  assert.equal(
    (await settlement(laterReport.id)).bank_settled_payment_id,
    "matching-payment",
    "a matching invoiced payment settles the visual confirmation"
  );

  await db.query("delete from payments_cloud where user_id=$1 and id=$2", [owner, "matching-payment"]);
  assert.equal(
    (await settlement(laterReport.id)).bank_settled_payment_id,
    null,
    "deleting the invoice makes the confirmed notice visible again"
  );

  const paymentFirstReport = report(
    "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    "c15",
    32.11,
    "2026-10-12T17:00:00.000Z",
    false
  );
  await insertReport(paymentFirstReport);
  await insertPayment(
    "payment-before-confirmation",
    payment("payment-before-confirmation", "c15", 32.11, "2026-10-12T17:10:00.000Z", "2026-10-12")
  );
  assert.equal((await settlement(paymentFirstReport.id)).bank_settled_payment_id, null);
  await db.query(
    `update route_payment_reports
     set status='confirmed',bank_confirmed_visually_at='2026-10-12T17:15:00.000Z'
     where id=$1`,
    [paymentFirstReport.id]
  );
  assert.equal(
    (await settlement(paymentFirstReport.id)).bank_settled_payment_id,
    "payment-before-confirmation",
    "confirming after the invoice also settles the notice"
  );

  console.log("OK: visual bank confirmations remain notified only until a matching invoiced payment exists");
} finally {
  await db.close();
}

