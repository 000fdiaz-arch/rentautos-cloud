import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "../.tmp/lead-portal-tests/node_modules/@electric-sql/pglite/dist/index.js";

const db = new PGlite();
const owner = "11111111-1111-4111-8111-111111111111";
const client = (id, unitId, balance) => ({ id, unitId, name: unitId, balance });
const change = (clientId, previousClient, nextClient, paymentIds) => ({
  clientId,
  previousClient,
  nextClient,
  paymentIds
});

try {
  await db.exec(`
    create role authenticated;
    create role anon;
    create function public.can_edit_owner_screen(target uuid, screen text)
    returns boolean language sql stable as $$select target = '${owner}'::uuid and screen = 'payments'$$;
    create function public.client_write_guard_state(payload jsonb)
    returns jsonb language sql immutable as $$select coalesce(payload, '{}'::jsonb) - 'installmentsIssued' - 'installmentsIssuedEstimateNeedsReview'$$;

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
  `);

  const rootSql = readFileSync("supabase/115-atomic-payment-deletion.sql", "utf8");
  const migrationSql = readFileSync("supabase/migrations/20261022000100_atomic_payment_deletion.sql", "utf8");
  assert.equal(rootSql, migrationSql, "La migracion y su copia numerada deben permanecer identicas.");
  await db.exec(rootSql);
  await db.exec(rootSql);

  const before = client("client-t25", "T25", 40);
  const afterDelete = client("client-t25", "T25", 100);
  await db.query(
    "insert into public.clients_cloud(user_id,id,data) values ($1,'client-t25',$2::jsonb)",
    [owner, JSON.stringify(before)]
  );
  await db.query(
    "insert into public.payments_cloud(user_id,id,data) values ($1,'payment-t25',$2::jsonb)",
    [owner, JSON.stringify({ id: "payment-t25", clientId: "client-t25", appliedToRent: 60 })]
  );

  const first = await db.query(
    "select public.delete_client_payments_atomic($1,$2::jsonb) as result",
    [owner, JSON.stringify([change("client-t25", before, afterDelete, ["payment-t25"])])]
  );
  assert.equal(first.rows[0].result.idempotent, false);
  assert.deepEqual(first.rows[0].result.deletedPaymentIds, ["payment-t25"]);

  const retry = await db.query(
    "select public.delete_client_payments_atomic($1,$2::jsonb) as result",
    [owner, JSON.stringify([change("client-t25", afterDelete, client("client-t25", "T25", 160), ["payment-t25"])])]
  );
  assert.equal(retry.rows[0].result.idempotent, true, "Reintentar el mismo pago debe ser inocuo.");
  const t25 = await db.query("select data from public.clients_cloud where id = 'client-t25'");
  assert.equal(Number(t25.rows[0].data.balance), 100, "El doble clic no puede sumar el pago dos veces.");

  const clientA = client("client-a", "A1", 20);
  const clientB = client("client-b", "B1", 30);
  await db.query(
    "insert into public.clients_cloud(user_id,id,data) values ($1,'client-a',$2::jsonb),($1,'client-b',$3::jsonb)",
    [owner, JSON.stringify(clientA), JSON.stringify(clientB)]
  );
  await db.query(
    "insert into public.payments_cloud(user_id,id,data) values ($1,'payment-a',$2::jsonb),($1,'payment-b',$3::jsonb)",
    [owner, JSON.stringify({ id: "payment-a", clientId: "client-a" }), JSON.stringify({ id: "payment-b", clientId: "client-b" })]
  );
  await assert.rejects(
    db.query(
      "select public.delete_client_payments_atomic($1,$2::jsonb)",
      [owner, JSON.stringify([
        change("client-a", clientA, client("client-a", "A1", 50), ["payment-a"]),
        change("client-b", client("client-b", "B1", 999), client("client-b", "B1", 60), ["payment-b"])
      ])]
    ),
    /Cliente desactualizado/
  );
  const remaining = await db.query("select id from public.payments_cloud where id in ('payment-a','payment-b') order by id");
  assert.deepEqual(remaining.rows.map((row) => row.id), ["payment-a", "payment-b"], "Un fallo debe revertir todo el lote.");
  const unchangedA = await db.query("select data from public.clients_cloud where id = 'client-a'");
  assert.equal(Number(unchangedA.rows[0].data.balance), 20, "Un fallo no puede modificar parcialmente un saldo.");

  const pageSource = readFileSync("src/pages/PaymentsPage.tsx", "utf8");
  const dialogSource = readFileSync("src/pages/payments/PaymentDialogs.tsx", "utf8");
  const shellSource = readFileSync("src/AppShell.tsx", "utf8");
  assert.match(pageSource, /if \(readOnly \|\| deleteInFlightRef\.current\) return;/, "El primer clic debe bloquear inmediatamente los siguientes.");
  assert.match(dialogSource, /disabled=\{isClosed \|\| isDeleting\}/, "El boton debe quedar deshabilitado durante la eliminacion.");
  assert.match(shellSource, /deleteCloudPaymentsAtomic\(/, "La app debe usar la operacion atomica.");
  const deleteFlow = shellSource.slice(shellSource.indexOf("async function persistDeletedPayments"), shellSource.indexOf("async function persistDeletedPayment("));
  assert.doesNotMatch(deleteFlow, /syncCloudClientsDelta|deleteCloudPayment\(/, "La eliminacion no debe separar el saldo y la factura.");

  console.log("OK eliminacion de pagos: bloqueo de doble clic, reintento idempotente y transaccion atomica validados.");
} finally {
  await db.close();
}
