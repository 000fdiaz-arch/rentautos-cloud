import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "../.tmp/lead-portal-tests/node_modules/@electric-sql/pglite/dist/index.js";

const db = new PGlite();
const owner = "11111111-1111-4111-8111-111111111111";

const payment = (id, clientId, balanceBefore, balanceAfter) => ({
  id,
  clientId,
  paymentContext: "regular",
  receiptNumber: "",
  balanceBefore,
  balanceAfter,
  amountReceived: balanceBefore - balanceAfter
});
const group = (clientId, expectedBalanceBefore, nextBalance, payments) => ({
  clientId,
  expectedBalanceBefore,
  nextClient: { id: clientId, unitId: clientId === "client-a" ? "A1" : "B1", balance: nextBalance },
  payments
});

async function save(groups) {
  const result = await db.query(
    "select public.register_client_payment_groups_with_receipts($1,$2::jsonb) as result",
    [owner, JSON.stringify(groups)]
  );
  return result.rows[0].result;
}

try {
  await db.exec(`
    create role authenticated;
    create function public.can_access_owner_data(target uuid)
    returns boolean language sql stable as $$select target = '${owner}'::uuid$$;

    create table public.receipt_sequences_cloud(
      user_id uuid primary key,
      seq integer not null default 0,
      updated_at timestamptz not null default now()
    );
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
    insert into public.clients_cloud(user_id,id,data) values
      ('${owner}','client-a','{"id":"client-a","unitId":"A1","balance":100}'),
      ('${owner}','client-b','{"id":"client-b","unitId":"B1","balance":200}');
  `);

  await db.exec(readFileSync("supabase/61-receipt-sequence-fast-reservation.sql", "utf8"));
  await db.exec(readFileSync("supabase/64-provisional-rental-payment-balance.sql", "utf8"));
  const rootSql = readFileSync("supabase/85-bulk-payments-with-receipts.sql", "utf8");
  const migrationSql = readFileSync("supabase/migrations/20260910000400_bulk_payments_with_receipts.sql", "utf8");
  assert.equal(rootSql, migrationSql, "La migracion y su copia numerada deben permanecer identicas.");
  await db.exec(rootSql);
  await db.exec(rootSql);

  const groups = [
    group("client-a", 100, 50, [
      payment("payment-a1", "client-a", 100, 80),
      payment("payment-a2", "client-a", 80, 50)
    ]),
    group("client-b", 200, 150, [
      payment("payment-b1", "client-b", 200, 150)
    ])
  ];

  const first = await save(groups);
  assert.equal(first.paymentCount, 3);
  assert.deepEqual(
    first.groups.flatMap((savedGroup) => savedGroup.payments.map((savedPayment) => savedPayment.receiptNumber)),
    ["REC-0001", "REC-0002", "REC-0003"]
  );
  assert.equal(Number(first.groups[0].client.balance), 50,
    "Dos pagos del mismo cliente deben guardarse juntos y dejar el saldo final correcto.");

  const retry = await save(groups);
  assert.equal(retry.idempotent, true);
  assert.deepEqual(
    retry.groups.flatMap((savedGroup) => savedGroup.payments.map((savedPayment) => savedPayment.receiptNumber)),
    ["REC-0001", "REC-0002", "REC-0003"],
    "El reintento debe devolver los recibos originales."
  );
  const afterRetry = await db.query("select seq from public.receipt_sequences_cloud where user_id=$1", [owner]);
  assert.equal(afterRetry.rows[0].seq, 3, "El reintento no debe consumir recibos.");

  const failing = [
    group("client-a", 50, 40, [payment("payment-a3", "client-a", 50, 40)]),
    group("client-b", 999, 140, [payment("payment-b2", "client-b", 999, 140)])
  ];
  await assert.rejects(save(failing), /Saldo desactualizado/);
  const failedPayments = await db.query("select count(*)::int as count from public.payments_cloud where id in ('payment-a3','payment-b2')");
  assert.equal(failedPayments.rows[0].count, 0, "Un error debe revertir el lote completo.");
  const afterFailure = await db.query("select seq from public.receipt_sequences_cloud where user_id=$1", [owner]);
  assert.equal(afterFailure.rows[0].seq, 3, "Un error debe revertir tambien la reserva de recibos.");

  const cloudSource = readFileSync("src/cloud/paymentCloudData.ts", "utf8");
  const shellSource = readFileSync("src/AppShell.tsx", "utf8");
  const workflowSource = readFileSync("src/pages/payments/usePendingBankWorkflow.ts", "utf8");
  const panelSource = readFileSync("src/pages/payments/PendingBankPanel.tsx", "utf8");
  assert.match(cloudSource, /rpc\("register_client_payment_groups_with_receipts"/);
  assert.match(shellSource, /await registerCloudPaymentGroupsWithReceipts\(/);
  assert.match(workflowSource, /dataOwnerUserId && !isSupabaseOnlyMode/,
    "El modo nube debe delegar la reserva de todo el lote a la unica RPC.");
  assert.match(panelSource, /pendingErrors\.map/,
    "Ver pendientes debe mostrar los errores de guardado en el panel visible.");

  console.log("OK lote rapido: una RPC, varios pagos del mismo cliente, recibos idempotentes y rollback total.");
} finally {
  await db.close();
}

