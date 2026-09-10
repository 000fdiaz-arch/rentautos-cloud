import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "../.tmp/lead-portal-tests/node_modules/@electric-sql/pglite/dist/index.js";

const db = new PGlite();
const owner = "11111111-1111-4111-8111-111111111111";

const payment = (id, clientId, balanceBefore, balanceAfter) => ({
  id,
  clientId,
  paymentContext: "regular",
  balanceBefore,
  balanceAfter
});

const group = (clientId, expectedBalanceBefore, nextBalance, payments) => ({
  clientId,
  expectedBalanceBefore,
  nextClient: { id: clientId, unitId: clientId.toUpperCase(), balance: nextBalance },
  payments
});

try {
  await db.exec(`
    create role authenticated;
    create function public.can_access_owner_data(target uuid)
    returns boolean language sql stable as $$select target = '${owner}'::uuid$$;

    create table public.clients_cloud(
      user_id uuid not null,
      id text not null,
      data jsonb not null,
      updated_at timestamptz,
      primary key(user_id, id)
    );
    create table public.payments_cloud(
      user_id uuid not null,
      id text not null,
      data jsonb not null,
      updated_at timestamptz,
      primary key(user_id, id)
    );
    insert into public.clients_cloud(user_id, id, data) values
      ('${owner}', 'client-a', '{"id":"client-a","unitId":"A1","balance":100}'),
      ('${owner}', 'client-b', '{"id":"client-b","unitId":"B1","balance":200}');
  `);

  await db.exec(readFileSync("supabase/64-provisional-rental-payment-balance.sql", "utf8"));
  const rootSql = readFileSync("supabase/82-payment-delta-groups.sql", "utf8");
  const migrationSql = readFileSync("supabase/migrations/20260910000100_payment_delta_groups.sql", "utf8");
  assert.equal(rootSql, migrationSql, "La migración y su copia numerada deben permanecer idénticas.");
  await db.exec(rootSql);
  await db.exec(rootSql);

  const groups = [
    group("client-a", 100, 50, [
      payment("payment-a1", "client-a", 100, 80),
      payment("payment-a2", "client-a", 80, 50)
    ]),
    group("client-b", 200, 150, [payment("payment-b1", "client-b", 200, 150)])
  ];

  await db.query("select public.register_client_payment_delta_groups($1, $2::jsonb)", [owner, JSON.stringify(groups)]);
  const paymentsAfterSave = await db.query("select id from public.payments_cloud order by id");
  assert.deepEqual(paymentsAfterSave.rows.map((row) => row.id), ["payment-a1", "payment-a2", "payment-b1"]);

  const clientA = await db.query("select data from public.clients_cloud where id = 'client-a'");
  assert.equal(Number(clientA.rows[0].data.balance), 50, "Dos pagos del mismo cliente deben dejar el saldo final correcto.");

  await db.query("select public.register_client_payment_delta_groups($1, $2::jsonb)", [owner, JSON.stringify(groups)]);
  const idempotentCount = await db.query("select count(*)::int as count from public.payments_cloud");
  assert.equal(idempotentCount.rows[0].count, 3, "Reintentar el mismo lote no debe duplicar pagos.");

  const failingGroups = [
    group("client-a", 50, 40, [payment("payment-a3", "client-a", 50, 40)]),
    group("client-b", 999, 140, [payment("payment-b2", "client-b", 999, 140)])
  ];
  await assert.rejects(
    db.query("select public.register_client_payment_delta_groups($1, $2::jsonb)", [owner, JSON.stringify(failingGroups)]),
    /Saldo desactualizado/
  );

  const paymentA3 = await db.query("select count(*)::int as count from public.payments_cloud where id = 'payment-a3'");
  assert.equal(paymentA3.rows[0].count, 0, "Un fallo posterior debe revertir los pagos anteriores del mismo lote.");
  const clientAAfterRollback = await db.query("select data from public.clients_cloud where id = 'client-a'");
  assert.equal(Number(clientAAfterRollback.rows[0].data.balance), 50, "Un fallo debe revertir también el saldo del cliente.");

  const cloudSource = readFileSync("src/cloud/paymentCloudData.ts", "utf8");
  const workflowSource = readFileSync("src/pages/payments/usePendingBankWorkflow.ts", "utf8");
  const panelSource = readFileSync("src/pages/payments/PendingBankPanel.tsx", "utf8");
  assert.match(cloudSource, /rpc\("register_client_payment_delta_groups"/);
  assert.match(cloudSource, /if \(!isMissingRpcFunctionError\(error\)\) throw error;/);
  assert.match(cloudSource, /existingGroup\.payments\.push\(payment\)/,
    "Los movimientos repetidos deben agruparse por cliente antes de enviarse.");
  assert.match(workflowSource, /if \(isBulkPendingApplyingRef\.current\) return;/,
    "Un doble clic no debe iniciar un segundo lote.");
  assert.match(panelSource, /disabled=\{bulkPendingApplyingCount > 0\}/,
    "Los controles deben bloquearse mientras el lote está en curso.");

  console.log("OK pagos en lote: múltiples clientes en una solicitud, pagos repetidos por cliente, reintento idempotente y rollback total.");
} finally {
  await db.close();
}
