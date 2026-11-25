import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '../.tmp/lead-portal-tests/node_modules/@electric-sql/pglite/dist/index.js';

const mappings = JSON.parse(readFileSync('tests/fixtures/cloud-mirror-snapshot-map.json', 'utf8'));
const fixture = JSON.parse(readFileSync('tests/fixtures/startup-read-permissions.json', 'utf8'));
const migration = readFileSync('supabase/137-cloud-mirror-read-snapshot.sql', 'utf8');
assert.equal(migration, readFileSync('supabase/migrations/20261124000700_cloud_mirror_read_snapshot.sql', 'utf8'));
const source = readFileSync('src/cloudMirror.ts', 'utf8');
for (const item of mappings) assert.ok(source.includes(`"${item.key}": "${item.table}"`));
const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const db = new PGlite();
try {
  await db.exec(`create role authenticated; create role anon; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public,auth to authenticated,anon;
    create type public.app_role as enum ('admin','operador','lectura','buscador');
    create table public.user_profiles (id uuid primary key,role public.app_role,is_active boolean,data_owner_user_id uuid,permissions jsonb);`);
  for (const name of ['default_screen_permissions','current_data_owner_user_id','has_role','current_user_screen_permissions','current_user_can_view_screen','can_access_owner_data','can_view_owner_screen']) {
    await db.exec(fixture.functions.find(f => f.name === name).definition);
  }
  for (const [n,role,active,owner] of [[1,'operador',true,2],[2,'operador',true,null],[4,'admin',true,null],[6,'admin',false,null],[7,'lectura',true,2]]) {
    await db.query('insert into public.user_profiles values ($1,$2,$3,$4,null)',[uid(n),role,active,owner ? uid(owner) : null]);
  }
  for (const {table,array} of mappings) {
    await db.exec(`create table public.${table} (user_id uuid,id text,data jsonb,seq integer,status_filter text,primary key(user_id,id));
      alter table public.${table} enable row level security;
      grant select,update on public.${table} to authenticated;
      create policy mirror_read on public.${table} for select to authenticated using (public.can_view_owner_screen(user_id,'payments'));
      create policy own_write on public.${table} for update to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));`);
    for (const n of [1,2,3]) await db.query(`insert into public.${table} values ($1,'row-one',$2,42,'activo')`,
      [uid(n),{id:'row-one',amount:123.45,nested:{history:[1,2,3]},array}]);
  }
  await db.exec(`insert into public.pending_bank_items_cloud(user_id,id,data)
    select '${uid(1)}', 'row-'||lpad(n::text,5,'0'), jsonb_build_object('id','row-'||lpad(n::text,5,'0'),'amount',n,'history',jsonb_build_array(n,n+1))
    from generate_series(1,2500) n`);
  const tableRows = async () => Promise.all(mappings.map(async ({table}) =>
    (await db.query(`select * from public.${table} order by user_id,id`)).rows));
  const beforeRows = await tableRows();
  const beforePolicies = (await db.query("select * from pg_policies order by tablename,policyname")).rows;
  const beforeGrants = (await db.query("select * from information_schema.role_table_grants where table_schema='public' order by table_name,grantee,privilege_type")).rows;
  await db.exec(migration);
  assert.deepEqual((await db.query("select * from pg_policies order by tablename,policyname")).rows,beforePolicies);
  assert.deepEqual((await db.query("select * from information_schema.role_table_grants where table_schema='public' order by table_name,grantee,privilege_type")).rows,beforeGrants);
  assert.deepEqual((await db.query("select prosecdef,provolatile from pg_proc where proname='read_cloud_mirror_snapshot'")).rows,[{prosecdef:false,provolatile:'s'}]);
  assert.equal((await db.query("select has_function_privilege('anon','public.read_cloud_mirror_snapshot(uuid,text[])','execute') allowed")).rows[0].allowed,false);
  const keysSQL = `array[${mappings.map(m => `'${m.key}'`).join(',')}]::text[]`;
  for (const actor of [0,1,4,5,6,7]) {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor ? uid(actor) : '']);
    await db.exec('set role authenticated');
    try {
      for (const target of [1,2,3]) {
        const expected = {};
        for (const {key,table,array} of mappings) {
          const rows = (await db.query(`select * from public.${table} where user_id=$1`,[uid(target)])).rows;
          expected[key] = array ? rows.map(row => row.data) : rows[0] ?? null;
        }
        const actual = (await db.query(`select public.read_cloud_mirror_snapshot($1,${keysSQL}) snapshot`,[uid(target)])).rows[0].snapshot;
        assert.deepEqual(actual,{version:1,values:expected},`snapshot changed RLS or data for actor ${actor}, owner ${target}`);
        if (actor===1 && target===1) assert.equal(actual.values['cobrapp.module2.pending_bank.v1'].length,2501,'snapshot must exceed REST page limits without truncation');
      }
      await assert.rejects(db.query('select public.read_cloud_mirror_snapshot(null,array[]::text[])'),/owner is required/i);
      await assert.rejects(db.query('select public.read_cloud_mirror_snapshot($1,array[$2])',[uid(1),"not-a-key'; drop table clients_cloud; --"]),/Unknown mirror key/);
      assert.deepEqual((await db.query('select public.read_cloud_mirror_snapshot($1,array[]::text[]) snapshot',[uid(1)])).rows[0].snapshot,{version:1,values:{}});
    } finally { await db.exec('reset role'); }
  }
  assert.deepEqual(await tableRows(),beforeRows,'read snapshot changed data');
  console.log('PASS mirror snapshot: 21 keys, 2501 rows without truncation, own/shared/admin/restricted/inactive/missing/anonymous RLS, unchanged data/grants/write policies and invalid-key rejection.');
} finally { await db.close(); }
