import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '../.tmp/lead-portal-tests/node_modules/@electric-sql/pglite/dist/index.js';

const fixture = JSON.parse(readFileSync('tests/fixtures/startup-read-permissions.json', 'utf8'));
fixture.policies.push(JSON.parse(readFileSync('tests/fixtures/startup-payment-read-policy.json', 'utf8')));
const mirrorPolicies = JSON.parse(readFileSync('tests/fixtures/startup-mirror-read-policies.json', 'utf8'));
fixture.policies.push(...mirrorPolicies);
const auditPolicy = JSON.parse(readFileSync('tests/fixtures/startup-audit-read-policy.json', 'utf8'));
fixture.policies.push(auditPolicy);
const migration = readFileSync('supabase/133-startup-read-rls-fast-path.sql', 'utf8');
assert.equal(migration, readFileSync('supabase/migrations/20261124000300_startup_read_rls_fast_path.sql', 'utf8'));
const paymentMigration = readFileSync('supabase/134-startup-payment-read-rls-fast-path.sql', 'utf8');
assert.equal(paymentMigration, readFileSync('supabase/migrations/20261124000400_startup_payment_read_rls_fast_path.sql', 'utf8'));
const tables = ['clients_cloud', 'fleet_units_cloud', 'late_fee_ledger_cloud', 'payments_cloud'];
const mirrorMigration = readFileSync('supabase/135-startup-mirror-read-rls-fast-path.sql', 'utf8');
assert.equal(mirrorMigration, readFileSync('supabase/migrations/20261124000500_startup_mirror_read_rls_fast_path.sql', 'utf8'));
tables.push(...mirrorPolicies.map(policy => policy.tablename));
tables.push(auditPolicy.tablename);
const auditMigration = readFileSync('supabase/136-startup-audit-read-rls-fast-path.sql', 'utf8');
assert.equal(auditMigration, readFileSync('supabase/migrations/20261124000600_startup_audit_read_rls_fast_path.sql', 'utf8'));
const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const db = new PGlite();
try {
  await db.exec(`
    create role authenticated; create role anon;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema auth, public to authenticated, anon;
    create type public.app_role as enum ('admin', 'operador', 'lectura', 'buscador');
    create table public.user_profiles (
      id uuid primary key, role public.app_role, is_active boolean,
      data_owner_user_id uuid, permissions jsonb
    );
  `);
  const order = ['default_screen_permissions', 'current_data_owner_user_id', 'has_role',
    'current_user_screen_permissions', 'current_user_can_view_screen', 'can_access_owner_data', 'can_view_owner_screen'];
  for (const name of order) await db.exec(fixture.functions.find(f => f.name === name).definition);
  for (const table of tables) {
    await db.exec(`create table public.${table} (id text primary key, user_id uuid, data jsonb);
      alter table public.${table} enable row level security;
      grant select, update on public.${table} to authenticated;
      create policy own_write on public.${table} for update to authenticated
        using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));`);
    for (let n = 1; n <= 9; n++) {
      await db.query(`insert into public.${table} values ($1, $2, $3)`,
        [`row-${n}`, uid(n), { amount: n * 123.45, nested: { history: [n, n + 1] } }]);
    }
    await db.query(`insert into public.${table} values ('null-owner', null, '{"amount":0}')`);
  }
  for (const policy of fixture.policies) {
    await db.exec(`create policy ${policy.policyname} on public.${policy.tablename}
      for select to authenticated using (${policy.qual});`);
  }
  const deny = Object.fromEntries(['clients', 'payments', 'receivables', 'route_search', 'incidents',
    'control_units', 'leads', 'settings', 'dashboard'].map(screen => [screen, { view: false, edit: false }]));
  for (const [n, role, active, owner, permissions] of [
    [1, 'admin', true, null, deny], [2, 'operador', true, 3, {}], [3, 'operador', true, null, {}],
    [4, 'lectura', true, 3, {}], [5, 'buscador', true, 3, {}], [6, 'admin', false, 3, {}],
    [7, 'operador', true, 3, deny], [9, 'operador', true, null, {}],
  ]) await db.query('insert into public.user_profiles values ($1,$2,$3,$4,$5)',
    [uid(n), role, active, owner ? uid(owner) : null, permissions]);

  async function readAs(n) {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [n ? uid(n) : '']);
    await db.exec('set role authenticated');
    try {
      return Object.fromEntries(await Promise.all(tables.map(async table =>
        [table, (await db.query(`select * from public.${table} order by id`)).rows])));
    } finally { await db.exec('reset role'); }
  }
  async function allRows() {
    return Promise.all(tables.map(async table => (await db.query(`select * from public.${table} order by id`)).rows));
  }
  async function writePolicies() {
    return (await db.query("select * from pg_policies where schemaname='public' and cmd <> 'SELECT' order by tablename,policyname")).rows;
  }
  const before = [];
  for (let n = 0; n <= 9; n++) before.push(await readAs(n));
  const dataBefore = await allRows();
  const writesBefore = await writePolicies();
  await db.exec(migration);
  await db.exec(paymentMigration);
  await db.exec(mirrorMigration);
  await db.exec(auditMigration);
  for (let n = 0; n <= 9; n++) assert.deepEqual(await readAs(n), before[n], `access changed for actor ${n}`);
  assert.deepEqual(await allRows(), dataBefore, 'migration changed business data');
  assert.deepEqual(await writePolicies(), writesBefore, 'migration changed write policies');
  assert.equal(before[1].clients_cloud.length, 10, 'admin retains all-owner access including nullable owner');
  assert.deepEqual(before[2].clients_cloud.map(r => r.user_id).sort(), [uid(2), uid(3)]);
  for (const n of [0, 6, 7, 8]) for (const table of tables) assert.equal(before[n][table].length, 0);
  assert.equal(before[4].fleet_units_cloud.length, 2);
  assert.equal(before[4].clients_cloud.length, 0);
  assert.equal(before[5].clients_cloud.length, 2);
  assert.equal(before[5].late_fee_ledger_cloud.length, 0);
  assert.equal(before[5].payments_cloud.length, 2, 'route viewers retain payment reads');
  assert.equal(before[4].payments_cloud.length, 0, 'fleet-only viewers do not gain payment access');
  await db.exec('set role anon');
  try { await assert.rejects(db.query('select * from public.clients_cloud'), /permission denied/); }
  finally { await db.exec('reset role'); }
  await db.query('update public.user_profiles set is_active=false where id=$1', [uid(2)]);
  for (const rows of Object.values(await readAs(2))) assert.equal(rows.length, 0, 'revocation must apply next statement');
  await db.query('update public.user_profiles set is_active=true, data_owner_user_id=$2 where id=$1', [uid(2), uid(9)]);
  assert.deepEqual((await readAs(2)).clients_cloud.map(r => r.user_id).sort(), [uid(2), uid(9)]);
  await db.query('update public.user_profiles set permissions=$2 where id=$1', [uid(2), deny]);
  for (const rows of Object.values(await readAs(2))) assert.equal(rows.length, 0, 'screen changes must apply next statement');
  console.log('PASS: ten read policies preserve all roles, own/shared/global access, inactive/missing/anonymous denial, data and write policies; revocations apply immediately.');
} finally { await db.close(); }
