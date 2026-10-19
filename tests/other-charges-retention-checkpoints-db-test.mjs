import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "../.tmp/lead-portal-tests/node_modules/@electric-sql/pglite/dist/index.js";

const db = new PGlite();
const owner = "11111111-1111-4111-8111-111111111111";

function payment(id, clientId, dateApplied, createdAt, extra = {}) {
  return {
    id,
    clientId,
    clientUnit: clientId === "a99" ? "A99" : "A95",
    dateApplied,
    createdAt,
    amountReceived: 10,
    appliedToRent: 10,
    ...extra
  };
}

try {
  await db.exec(`
    create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key);
    insert into auth.users values ('${owner}');
    create function public.can_access_owner_data(target uuid)
    returns boolean language sql stable as $$select target = '${owner}'::uuid$$;
    create table public.payments_cloud(
      user_id uuid not null references auth.users(id) on delete cascade,
      id text not null,
      data jsonb not null,
      updated_at timestamptz not null default now(),
      primary key(user_id, id)
    );
    create publication supabase_realtime;
  `);

  const rootSql = readFileSync("supabase/113-other-charges-retention-checkpoints.sql", "utf8");
  const migrationSql = readFileSync("supabase/migrations/20261019000100_other_charges_retention_checkpoints.sql", "utf8");
  assert.equal(rootSql, migrationSql, "La migracion y su copia numerada deben permanecer identicas.");

  const a99Checkpoint = payment("a99-ret-15", "a99", "2026-10-15", "2026-10-15T12:00:00.000Z", {
    otherChargesApplied: [{ id: "debt-a99", label: "DEUDA ANTERIOR", amount: 2 }],
    otherChargesRetentionEvent: {
      mode: "automatic",
      cycle: "daily",
      baseAmount: 2,
      cyclesElapsed: 1,
      calculatedAmount: 2,
      appliedAmount: 2
    }
  });
  const a99Ordinary = payment("a99-ordinary-18", "a99", "2026-10-18", "2026-10-18T12:00:00.000Z");
  const a95Legacy = payment("a95-legacy-12", "a95", "2026-10-12", "2026-10-12T12:00:00.000Z", {
    otherChargesApplied: [{ id: "debt-a95", label: "SALDO DE COLISION", amount: 18 }]
  });
  const lateFeeOnly = payment("a95-late-fee", "a95", "2026-10-18", "2026-10-18T12:00:00.000Z", {
    otherChargesApplied: [{ id: "late-a95", label: "RECARGO POR MORA", amount: 5 }]
  });
  for (const item of [a99Checkpoint, a99Ordinary, a95Legacy, lateFeeOnly]) {
    await db.query(
      "insert into public.payments_cloud(user_id,id,data) values($1,$2,$3::jsonb)",
      [owner, item.id, JSON.stringify(item)]
    );
  }

  await db.exec(rootSql);
  const backfilled = (await db.query(`
    select client_id, payment_id, date_applied, retention_event
    from public.other_charges_retention_checkpoints_cloud
    order by client_id
  `)).rows;
  assert.equal(backfilled.length, 2);
  assert.equal(backfilled[0].payment_id, "a95-legacy-12", "Un recargo por mora no debe reemplazar el punto de control de A95.");
  assert.equal(backfilled[1].payment_id, "a99-ret-15");
  assert.equal(backfilled[1].retention_event.appliedAmount, 2);

  const a99Manual = payment("a99-manual-19", "a99", "2026-10-19", "2026-10-19T13:49:41.266Z", {
    otherChargesApplied: [{ id: "debt-a99", label: "DEUDA ANTERIOR", amount: 2 }],
    otherChargesRetentionEvent: {
      mode: "manual",
      cycle: "daily",
      baseAmount: 2,
      cyclesElapsed: 0,
      calculatedAmount: 2,
      appliedAmount: 2
    }
  });
  await db.query(
    "insert into public.payments_cloud(user_id,id,data) values($1,$2,$3::jsonb)",
    [owner, a99Manual.id, JSON.stringify(a99Manual)]
  );
  let current = (await db.query(`
    select payment_id from public.other_charges_retention_checkpoints_cloud
    where user_id=$1 and client_id='a99'
  `, [owner])).rows[0];
  assert.equal(current.payment_id, "a99-manual-19", "Un pago nuevo debe actualizar el punto de control inmediatamente.");

  await db.query("delete from public.payments_cloud where user_id=$1 and id=$2", [owner, a99Manual.id]);
  current = (await db.query(`
    select payment_id from public.other_charges_retention_checkpoints_cloud
    where user_id=$1 and client_id='a99'
  `, [owner])).rows[0];
  assert.equal(current.payment_id, "a99-ret-15", "Al borrar el ultimo pago debe recuperarse el punto anterior.");

  console.log("OK Otros cargos DB: backfill global, actualizacion y recuperacion del punto de control.");
} finally {
  await db.close();
}
