import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "../.tmp/lead-portal-tests/node_modules/@electric-sql/pglite/dist/index.js";

const db = new PGlite();
const owner = "11111111-1111-4111-8111-111111111111";

const client = (id, unitId, balance, lastChargeDate) => ({
  id,
  unitId,
  name: unitId,
  balance,
  rentAmount: 192,
  frequency: "weekly",
  installmentsAgreed: 173,
  installmentsRemaining: 173,
  installmentsPaid: 0,
  otherCharges: [],
  advanceBalance: 0,
  savings: 0,
  createdAt: "2026-09-16T00:00:00.000Z",
  lastChargeDate,
  status: "activo"
});

async function sync(changes) {
  return db.query(
    "select public.sync_client_deltas_guarded($1, $2::jsonb) as result",
    [owner, JSON.stringify(changes)]
  );
}

try {
  await db.exec(`
    create role authenticated;
    create function public.can_access_owner_data(target uuid)
    returns boolean language sql stable as $$select target = '${owner}'::uuid$$;
    create table public.clients_cloud(
      user_id uuid not null,
      id text not null,
      data jsonb not null,
      updated_at timestamptz not null default now(),
      primary key(user_id, id)
    );
    grant select on public.clients_cloud to authenticated;
  `);

  const rootSql = readFileSync("supabase/100-guarded-client-delta-sync.sql", "utf8");
  const migrationSql = readFileSync("supabase/migrations/20261007000100_guarded_client_delta_sync.sql", "utf8");
  assert.equal(rootSql, migrationSql, "La migracion y su copia numerada deben permanecer identicas.");
  await db.exec(rootSql);
  await db.exec(rootSql);

  const cloudA95 = client("client-a95", "A95", 54, "2026-09-24");
  const cloudB01 = client("client-b01", "B01", 100, "2026-09-24");
  await db.query(
    "insert into public.clients_cloud(user_id,id,data) values ($1,$2,$3::jsonb),($1,$4,$5::jsonb)",
    [owner, cloudA95.id, JSON.stringify(cloudA95), cloudB01.id, JSON.stringify(cloudB01)]
  );
  await db.exec("set role authenticated");

  const staleA95 = client("client-a95", "A95", 77, "2026-09-24");
  const staleClosingA95 = { ...staleA95, lastChargeDate: "2026-09-25" };
  await assert.rejects(
    sync([{ clientId: staleA95.id, previousClient: staleA95, nextClient: staleClosingA95 }]),
    /Cliente desactualizado para A95/
  );
  const afterRejectedClose = await db.query("select data from public.clients_cloud where id='client-a95'");
  assert.equal(Number(afterRejectedClose.rows[0].data.balance), 54, "El cierre viejo no puede restaurar el saldo 77.");

  const freshClosingA95 = { ...cloudA95, lastChargeDate: "2026-09-25" };
  await sync([{ clientId: cloudA95.id, previousClient: cloudA95, nextClient: freshClosingA95 }]);
  const afterFreshClose = await db.query("select data from public.clients_cloud where id='client-a95'");
  assert.equal(Number(afterFreshClose.rows[0].data.balance), 54);
  assert.equal(afterFreshClose.rows[0].data.lastChargeDate, "2026-09-25");

  const freshA95 = freshClosingA95;
  const staleB01 = { ...cloudB01, balance: 999 };
  await assert.rejects(
    sync([
      { clientId: freshA95.id, previousClient: freshA95, nextClient: { ...freshA95, statusComment: "no debe persistir" } },
      { clientId: staleB01.id, previousClient: staleB01, nextClient: { ...staleB01, lastChargeDate: "2026-09-25" } }
    ]),
    /Cliente desactualizado para B01/
  );
  const afterAtomicFailure = await db.query("select data from public.clients_cloud where id='client-a95'");
  assert.equal(afterAtomicFailure.rows[0].data.statusComment, undefined, "Un conflicto debe revertir todo el lote.");

  const cloudSource = readFileSync("src/cloud/clientCloudData.ts", "utf8");
  const closingSource = readFileSync("src/pages/payments/useCashClosing.ts", "utf8");
  assert.match(cloudSource, /rpc\("sync_client_deltas_guarded"/);
  assert.match(closingSource, /await loadCloudClients\(dataOwnerUserId\)/);
  assert.match(closingSource, /applyNextDayChargesFromClosing\(date, \{\}, currentCloudClients\)/);

  console.log("OK escritura protegida: un cierre desactualizado no restaura saldos y el lote revierte completo.");
} finally {
  await db.close();
}
