import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '../.tmp/lead-portal-tests/node_modules/@electric-sql/pglite/dist/index.js';

const db = new PGlite();
const owner = '11111111-1111-4111-8111-111111111111';
const publishedAt = '2026-09-26T12:00:00.000Z';

try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key);
    insert into auth.users values('${owner}');
    create function auth.uid() returns uuid language sql as
      $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
    grant usage on schema auth to authenticated, anon;

    create table public.user_profiles(
      id uuid primary key, role text, is_active boolean, email text,
      owner_id uuid, view_route boolean, edit_route boolean
    );
    insert into public.user_profiles values
      ('${owner}', 'admin', true, 'Admin', '${owner}', true, true);
    create function public.can_view_owner_screen(o uuid, s text)
    returns boolean language sql security definer as
      $$select auth.uid() = o$$;
    create function public.can_edit_owner_screen(o uuid, s text)
    returns boolean language sql security definer as
      $$select auth.uid() = o$$;

    create table public.active_route_items_cloud(
      user_id uuid, client_id text, data jsonb,
      primary key(user_id, client_id)
    );
    create table public.payments_cloud(
      user_id uuid, id text, data jsonb,
      primary key(user_id, id)
    );
    insert into public.active_route_items_cloud values(
      '${owner}', 'client-1',
      '{"clientId":"client-1","unitId":"A91","publishedAt":"${publishedAt}","releaseAmount":100}'
    );
  `);

  await db.exec(readFileSync('supabase/69-route-payment-reports.sql', 'utf8'));
  await db.exec(readFileSync('supabase/70-route-mixed-payment-reports.sql', 'utf8'));
  const migration = readFileSync('supabase/94-route-cash-receipt-delete-cancels-report.sql', 'utf8');
  assert.equal(
    migration,
    readFileSync('supabase/migrations/20260926000600_route_cash_receipt_delete_cancels_report.sql', 'utf8')
  );
  await db.exec(migration);
  await db.exec(migration);
  await db.exec(`set request.jwt.claim.sub='${owner}'; set role authenticated;`);

  const report = (cash, bank = 0) => db.query(
    'select report_route_payment_split($1,$2,$3,$4,$5)',
    [owner, 'client-1', publishedAt, cash, bank]
  );
  const payment = async (id, method, amount, source) => {
    await db.exec('reset role');
    const time = (await db.query(`
      select clock_timestamp() as stamp,
        to_char(clock_timestamp() at time zone 'America/Panama', 'YYYY-MM-DD') as day
    `)).rows[0];
    const data = {
      clientId: 'client-1',
      clientUnit: 'A91',
      amountReceived: amount,
      paymentMethod: method,
      createdAt: time.stamp,
      dateApplied: time.day,
      ...(source ? { source } : {})
    };
    await db.query('insert into payments_cloud values($1,$2,$3)', [owner, id, JSON.stringify(data)]);
  };
  const latestReport = async () => (await db.query(
    'select * from route_payment_reports order by reported_at desc, id desc limit 1'
  )).rows[0];

  // El flujo nuevo: el recibo inmediato de Ruta confirma el reporte.
  await report(100);
  await payment('route-cash', 'Efectivo', 100, 'route');
  assert.equal((await latestReport()).status, 'confirmed');

  // Al borrarlo desde Pagos, la notificación completa desaparece y no
  // vuelve a existir como "Efectivo pendiente".
  await db.exec("delete from payments_cloud where id='route-cash'");
  let current = await latestReport();
  assert.equal(current.status, 'cancelled');
  assert.ok(current.cancelled_at);
  assert.equal((await db.query(
    'select count(*)::int as total from route_report_payment_links where report_id=$1',
    [current.id]
  )).rows[0].total, 0);

  // Un pago de efectivo normal, ajeno a Ruta, conserva la regla histórica:
  // si se corrige o elimina, el reporte se reabre para conciliación.
  await db.exec(`set request.jwt.claim.sub='${owner}'; set role authenticated;`);
  await report(100);
  await payment('ordinary-cash', 'Efectivo', 100);
  assert.equal((await latestReport()).status, 'confirmed');
  await db.exec("delete from payments_cloud where id='ordinary-cash'");
  current = await latestReport();
  assert.equal(current.status, 'review');

  // En un pago mixto, borrar el recibo de efectivo de Ruta cancela la unidad
  // completa de notificación, pero no borra el pago bancario ya registrado.
  await db.exec("update route_payment_reports set status='cancelled' where id='" + current.id + "'");
  await db.exec(`set request.jwt.claim.sub='${owner}'; set role authenticated;`);
  await report(40, 60);
  await payment('mixed-route-cash', 'Efectivo', 40, 'route');
  await payment('mixed-bank', 'Transferencia Bancaria', 60);
  assert.equal((await latestReport()).status, 'confirmed');
  await db.exec("delete from payments_cloud where id='mixed-route-cash'");
  current = await latestReport();
  assert.equal(current.status, 'cancelled');
  assert.equal((await db.query(
    'select count(*)::int as total from route_report_payment_links where report_id=$1',
    [current.id]
  )).rows[0].total, 0);
  assert.equal((await db.query(
    "select count(*)::int as total from payments_cloud where id='mixed-bank'"
  )).rows[0].total, 1);

  console.log('OK: deleting a Route cash receipt cancels its notification and returns the unit to Trabajo');
} finally {
  await db.close();
}
