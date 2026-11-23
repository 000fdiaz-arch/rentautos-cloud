import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '../.tmp/lead-portal-tests/node_modules/@electric-sql/pglite/dist/index.js';
const db = new PGlite();
const owner = '11111111-1111-4111-8111-111111111111';
const delta = '22222222-2222-4222-8222-222222222222';
const outsider = '33333333-3333-4333-8333-333333333333';
try {
  await db.exec(`
    create role anon; create role authenticated; create schema auth;
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid$$;
    create function public.can_access_owner_data(o uuid) returns boolean language sql stable as $$select o='${owner}'::uuid and auth.uid()='${delta}'::uuid$$;
    create function public.can_report_route_payment(o uuid) returns boolean language sql stable as $$select public.can_access_owner_data(o)$$;
    create function public.can_edit_owner_screen(o uuid,s text) returns boolean language sql stable as $$select false$$;
    create table public.receipt_sequences_cloud(user_id uuid primary key,seq integer not null default 0,updated_at timestamptz not null default now());
    create table public.clients_cloud(user_id uuid,id text,data jsonb,updated_at timestamptz,primary key(user_id,id));
    create table public.payments_cloud(user_id uuid,id text,data jsonb,updated_at timestamptz,primary key(user_id,id));
    create table public.notified_payments_cloud(user_id uuid,id text,data jsonb,primary key(user_id,id));
    grant usage on schema public,auth to authenticated;
    grant select on public.receipt_sequences_cloud,public.clients_cloud,public.payments_cloud to authenticated;
    insert into public.clients_cloud values('${owner}','outside','{"id":"outside","unitId":"X01","status":"activo","balance":120}',now());
  `);
  for (const file of ['supabase/61-receipt-sequence-fast-reservation.sql', 'supabase/64-provisional-rental-payment-balance.sql',
    'supabase/migrations/20260910000300_single_payment_with_receipt.sql', 'supabase/95-route-reporter-payment-scope.sql']) {
    await db.exec(readFileSync(file, 'utf8'));
  }
  await db.exec(`set request.jwt.claim.sub='${delta}'; set role authenticated;`);
  const collection = { version: 'legacy', delta: 'delta2', team: 'WC', collectedBy: delta, collectedAt: '2026-11-23T15:00:00Z' };
  const payment = { id: 'outside-payment', clientId: 'outside', clientUnit: 'X01', source: 'route',
    paymentMethod: 'Efectivo', receiptNumber: '', amountReceived: 40, balanceBefore: 120, balanceAfter: 80,
    collectionTeam: 'WC', collectionDelta: 'delta2', moneyDelivered: false, outsideRouteCollection: collection };
  const next = { id: 'outside', unitId: 'X01', status: 'activo', balance: 80 };
  const register = value => db.query('select public.register_client_payment_with_receipt($1,$2,$3,$4::jsonb,$5::jsonb) as result',
    [owner, 'outside', 120, JSON.stringify(next), JSON.stringify(value)]);
  const first = (await register(payment)).rows[0].result;
  assert.equal(first.payment.receiptNumber, 'REC-0001');
  assert.deepEqual(first.payment.outsideRouteCollection, collection);
  assert.equal(first.client.status, 'activo');
  assert.equal(first.client.balance, 80);
  assert.equal(first.payment.moneyDelivered, false);
  const retry = (await register(payment)).rows[0].result;
  assert.equal(retry.idempotent, true);
  assert.equal(retry.payment.receiptNumber, first.payment.receiptNumber);
  assert.equal((await db.query('select count(*) as n from payments_cloud')).rows[0].n, 1);
  await assert.rejects(register({ ...payment, id: 'stale' }), /Saldo desactualizado/);
  assert.equal((await db.query('select seq from receipt_sequences_cloud')).rows[0].seq, 1, 'Failed payment rolls receipt sequence back');
  await db.exec(`reset role; set request.jwt.claim.sub='${outsider}'; set role authenticated;`);
  await assert.rejects(register({ ...payment, id: 'unauthorized' }), /No autorizado/);
  console.log('outside-route-cash DB: authorized Delta issues receipt without an active route, persists audit and cash custody, retries once, rejects stale balance and foreign owner');
} finally { await db.close(); }
