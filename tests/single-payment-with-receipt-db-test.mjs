import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "../.tmp/lead-portal-tests/node_modules/@electric-sql/pglite/dist/index.js";

const db = new PGlite();
const owner = "11111111-1111-4111-8111-111111111111";
const otherOwner = "22222222-2222-4222-8222-222222222222";

const client = (balance) => ({ id: "client-a", unitId: "A57", balance });
const payment = (id, balanceBefore, balanceAfter) => ({
  id,
  clientId: "client-a",
  paymentContext: "regular",
  receiptNumber: "",
  balanceBefore,
  balanceAfter,
  amountReceived: balanceBefore - balanceAfter
});

async function register(nextBalance, value) {
  const result = await db.query(
    "select public.register_client_payment_with_receipt($1,$2,$3,$4::jsonb,$5::jsonb) as result",
    [owner, "client-a", value.balanceBefore, JSON.stringify(client(nextBalance)), JSON.stringify(value)]
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
    insert into public.clients_cloud(user_id,id,data)
    values ('${owner}','client-a','{"id":"client-a","unitId":"A57","balance":100}');
    grant select on public.receipt_sequences_cloud, public.clients_cloud, public.payments_cloud to authenticated;
  `);

  await db.exec(readFileSync("supabase/61-receipt-sequence-fast-reservation.sql", "utf8"));
  await db.exec(readFileSync("supabase/64-provisional-rental-payment-balance.sql", "utf8"));
  const rootSql = readFileSync("supabase/84-single-payment-with-receipt.sql", "utf8");
  const migrationSql = readFileSync("supabase/migrations/20260910000300_single_payment_with_receipt.sql", "utf8");
  assert.equal(rootSql, migrationSql, "La migracion y su copia numerada deben permanecer identicas.");
  await db.exec(rootSql);
  await db.exec(rootSql);
  await db.exec("set role authenticated");

  const first = await register(80, payment("payment-1", 100, 80));
  assert.equal(first.payment.receiptNumber, "REC-0001");
  assert.equal(Number(first.client.balance), 80);

  const storedFirst = await db.query("select data from public.payments_cloud where id='payment-1'");
  assert.equal(storedFirst.rows[0].data.receiptNumber, "REC-0001");
  const firstSequence = await db.query("select seq from public.receipt_sequences_cloud where user_id=$1", [owner]);
  assert.equal(firstSequence.rows[0].seq, 1);

  const retry = await register(80, payment("payment-1", 100, 80));
  assert.equal(retry.payment.receiptNumber, "REC-0001", "Un reintento debe devolver el recibo ya guardado.");
  assert.equal(retry.idempotent, true);
  const sequenceAfterRetry = await db.query("select seq from public.receipt_sequences_cloud where user_id=$1", [owner]);
  assert.equal(sequenceAfterRetry.rows[0].seq, 1, "Un reintento no debe consumir otro recibo.");

  await assert.rejects(register(70, payment("payment-stale", 999, 70)), /Saldo desactualizado/);
  const sequenceAfterFailure = await db.query("select seq from public.receipt_sequences_cloud where user_id=$1", [owner]);
  assert.equal(sequenceAfterFailure.rows[0].seq, 1, "Un pago fallido debe revertir tambien la reserva del recibo.");

  const second = await register(70, payment("payment-2", 80, 70));
  assert.equal(second.payment.receiptNumber, "REC-0002");

  await assert.rejects(
    db.query(
      "select public.register_client_payment_with_receipt($1,$2,$3,$4::jsonb,$5::jsonb)",
      [otherOwner, "client-a", 70, JSON.stringify(client(60)), JSON.stringify(payment("unauthorized", 70, 60))]
    ),
    /No autorizado/
  );

  const cloudSource = readFileSync("src/cloud/paymentCloudData.ts", "utf8");
  const appShellSource = readFileSync("src/AppShell.tsx", "utf8");
  const workflowSource = readFileSync("src/pages/payments/usePendingBankWorkflow.ts", "utf8");
  assert.match(cloudSource, /rpc\("register_client_payment_with_receipt"/);
  assert.match(appShellSource, /await registerCloudPaymentWithReceipt\(/);
  assert.match(appShellSource, /nextPaymentsById\.get\(previousPayment\.id\)/,
    "La validacion append-only debe ser lineal y no buscar todo el historial por cada pago.");
  assert.match(workflowSource, /dataOwnerUserId && isSupabaseOnlyMode \? "" : await reserveReceiptNumber\(\)/,
    "Los pendientes individuales deben delegar la reserva del recibo a la transaccion unica.");

  console.log("OK pago individual: recibo, pago y cliente se guardan en una sola transaccion idempotente con rollback total.");
} finally {
  await db.close();
}
