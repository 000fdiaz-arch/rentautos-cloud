import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "../.tmp/lead-portal-tests/node_modules/@electric-sql/pglite/dist/index.js";

const db = new PGlite();
const owner = "11111111-1111-4111-8111-111111111111";
const editor = "22222222-2222-4222-8222-222222222222";
const viewer = "33333333-3333-4333-8333-333333333333";
const outsider = "44444444-4444-4444-8444-444444444444";

const paymentData = (id, dateApplied, paymentMethod, amountReceived) => JSON.stringify({
  id,
  dateApplied,
  paymentMethod,
  amountReceived
});

try {
  await db.exec(`
    create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key);
    insert into auth.users values ('${owner}'), ('${editor}'), ('${viewer}'), ('${outsider}');
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;

    create function public.can_view_owner_screen(target uuid, screen text)
    returns boolean language sql stable security definer as $$
      select target = '${owner}'::uuid
        and screen = 'payments'
        and auth.uid() in ('${editor}'::uuid, '${viewer}'::uuid)
    $$;
    create function public.can_edit_owner_screen(target uuid, screen text)
    returns boolean language sql stable security definer as $$
      select target = '${owner}'::uuid
        and screen = 'payments'
        and auth.uid() = '${editor}'::uuid
    $$;

    create table public.payments_cloud(
      user_id uuid not null,
      id text not null,
      data jsonb not null,
      primary key(user_id, id)
    );
  `);

  for (const [id, date, method, amount] of [
    ["bank-whole-1", "2026-09-10", "ACH Express", 20],
    ["bank-cents", "2026-09-10", "ACH Express", 20.37],
    ["cash-whole", "2026-09-10", "Efectivo", 20],
    ["bank-whole-2", "2026-09-10", "Transferencia Bancaria", 31],
    ["bank-next-day", "2026-09-11", "Deposito Bancario", 42]
  ]) {
    await db.query(
      "insert into public.payments_cloud(user_id,id,data) values($1,$2,$3::jsonb)",
      [owner, id, paymentData(id, date, method, amount)]
    );
  }

  const rootSql = readFileSync("supabase/83-daily-payment-attention.sql", "utf8");
  const migrationSql = readFileSync("supabase/migrations/20260910000200_daily_payment_attention.sql", "utf8");
  const cloudSource = readFileSync("src/cloud/paymentCloudData.ts", "utf8");
  assert.equal(rootSql, migrationSql, "La migración y su copia numerada deben permanecer idénticas.");
  assert.match(rootSql, /alter publication supabase_realtime add table public\.daily_payment_attention_cloud/,
    "El checklist debe publicarse por realtime.");
  assert.match(cloudSource, /table: "daily_payment_attention_cloud"/,
    "El cliente debe suscribirse a los cambios del checklist compartido.");
  await db.exec(rootSql);
  await db.exec(rootSql);

  const login = async (userId) => db.exec(`reset role; set request.jwt.claim.sub='${userId}'; set role authenticated;`);
  const toggle = (paymentId, date, checked) => db.query(
    "select public.set_daily_payment_attention($1,$2::date,$3,$4) as result",
    [owner, date, paymentId, checked]
  );
  const readAttention = async () => (await db.query(
    "select work_date::text, payment_ids from public.daily_payment_attention_cloud where user_id=$1",
    [owner]
  )).rows;

  await login(editor);
  await toggle("bank-whole-1", "2026-09-10", true);
  await toggle("bank-whole-2", "2026-09-10", true);
  assert.deepEqual((await readAttention())[0].payment_ids, ["bank-whole-1", "bank-whole-2"]);
  await assert.rejects(
    db.query("update public.daily_payment_attention_cloud set payment_ids=array['cash-whole'] where user_id=$1", [owner]),
    /permission denied/,
    "Las escrituras directas deben estar bloqueadas para impedir ganchitos inválidos."
  );

  await toggle("bank-whole-1", "2026-09-10", false);
  assert.deepEqual((await readAttention())[0].payment_ids, ["bank-whole-2"]);
  await assert.rejects(toggle("bank-cents", "2026-09-10", true), /sin centavos/);
  await assert.rejects(toggle("cash-whole", "2026-09-10", true), /pago bancario/);

  await toggle("bank-next-day", "2026-09-11", true);
  const nextDay = (await readAttention())[0];
  assert.equal(nextDay.work_date, "2026-09-11");
  assert.deepEqual(nextDay.payment_ids, ["bank-next-day"], "El nuevo día debe reemplazar, no acumular, el seguimiento anterior.");

  await login(viewer);
  assert.equal((await readAttention()).length, 1, "Un usuario con lectura de Pagos debe ver el checklist compartido.");
  await assert.rejects(toggle("bank-next-day", "2026-09-11", false), /No autorizado/);

  await login(outsider);
  assert.equal((await readAttention()).length, 0, "Un usuario ajeno no debe leer el checklist.");

  console.log("OK checklist diario: compartido, restringido a pagos bancarios sin centavos, editable por permisos y reemplazado al cambiar de día.");
} finally {
  await db.close();
}
