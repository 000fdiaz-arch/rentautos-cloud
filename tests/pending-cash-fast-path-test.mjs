import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "../.tmp/lead-portal-tests/node_modules/@electric-sql/pglite/dist/index.js";

const db = new PGlite();
const owner = "11111111-1111-4111-8111-111111111111";
const routeUser = "22222222-2222-4222-8222-222222222222";
const outsider = "33333333-3333-4333-8333-333333333333";

try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key);
    insert into auth.users values ('${owner}'), ('${routeUser}'), ('${outsider}');
    create function auth.uid() returns uuid language sql as
      $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
    grant usage on schema auth to authenticated, anon;

    create table public.user_profiles(id uuid primary key, owner_id uuid, active boolean);
    insert into public.user_profiles values
      ('${owner}', '${owner}', true),
      ('${routeUser}', '${owner}', true),
      ('${outsider}', '${outsider}', true);
    create function public.can_view_owner_screen(target uuid, screen text)
    returns boolean language sql security definer as
      $$select exists(
        select 1 from public.user_profiles
        where id = auth.uid() and active and owner_id = target
          and screen in ('payments', 'receivables', 'route_search')
      )$$;

    create table public.payments_cloud(
      user_id uuid not null,
      id text not null,
      data jsonb not null,
      primary key(user_id, id)
    );
  `);

  const rootSql = readFileSync("supabase/77-pending-cash-fast-path.sql", "utf8");
  const migrationSql = readFileSync("supabase/migrations/20260907000100_pending_cash_fast_path.sql", "utf8");
  assert.equal(rootSql, migrationSql, "La migración y su copia numerada deben permanecer idénticas.");
  await db.exec(rootSql);
  await db.exec(rootSql);

  const payment = async (id, data, userId = owner) => {
    await db.query("insert into payments_cloud(user_id,id,data) values($1,$2,$3)", [userId, id, JSON.stringify({ id, ...data })]);
  };
  const cash = (amountReceived, dateApplied, extra = {}) => ({
    amountReceived,
    dateApplied,
    paymentMethod: "Efectivo",
    moneyDelivered: false,
    ...extra
  });

  await payment("old-66", cash(66, "2026-09-05"));
  await payment("old-53", cash(53, "2026-09-05"));
  await payment("today-20", cash(20, "2026-09-07"));
  await payment("received-date", cash(10, "2026-09-08", { fundsReceivedDate: "2026-09-06" }));
  await payment("delivered", cash(99, "2026-09-05", { moneyDelivered: true }));
  await payment("bank", { amountReceived: 200, dateApplied: "2026-09-05", paymentMethod: "ACH Express", moneyDelivered: false });
  await payment("future", cash(300, "2026-09-08"));
  await payment("other-owner", cash(500, "2026-09-05"), outsider);

  const login = async (id) => db.exec(`reset role; set request.jwt.claim.sub='${id}'; set role authenticated;`);
  const readPending = async (userId = owner) => (await db.query(
    "select * from read_pending_cash_payments($1,$2)",
    [userId, "2026-09-07"]
  )).rows.map((row) => row.read_pending_cash_payments);

  await login(routeUser);
  const rows = await readPending();
  assert.deepEqual(rows.map((row) => row.id), ["old-53", "old-66", "received-date", "today-20"]);
  assert.equal(rows.reduce((sum, row) => sum + row.amountReceived, 0), 149);
  await assert.rejects(readPending(outsider), /permiso/);

  await login(outsider);
  assert.deepEqual((await readPending(outsider)).map((row) => row.id), ["other-owner"]);
  await assert.rejects(readPending(owner), /permiso/);

  const cloudSource = readFileSync("src/cloud/paymentCloudData.ts", "utf8");
  const syncSource = readFileSync("src/app/useCoreCloudSync.ts", "utf8");
  assert.match(cloudSource, /rpc\("read_pending_cash_payments"/);
  assert.match(syncSource, /mergeById\(recentPayments, pendingCashPayments\)/);
  assert.equal((syncSource.match(/loadRecentAndPendingCloudPayments\(ownerUserId\)/g) ?? []).length, 3,
    "La carga inicial, el refresco periódico y el fallback manual deben incluir todos los pendientes.");

  console.log("OK: efectivo pendiente completo, aislado por owner y combinado con los pagos recientes.");
} finally {
  await db.close();
}
