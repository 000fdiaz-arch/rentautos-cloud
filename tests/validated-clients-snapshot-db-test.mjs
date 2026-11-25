import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {PGlite} from '../.tmp/lead-portal-tests/node_modules/@electric-sql/pglite/dist/index.js';

const fixture=JSON.parse(readFileSync('tests/fixtures/startup-read-permissions.json','utf8'));
const migration=readFileSync('supabase/138-validated-clients-snapshot.sql','utf8');
assert.equal(migration,readFileSync('supabase/migrations/20261125000100_validated_clients_snapshot.sql','utf8'));
const uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const db=new PGlite();
try{
 await db.exec(`create role authenticated;create role anon;create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema public,auth to authenticated,anon;
 create type public.app_role as enum('admin','operador','lectura','buscador');
 create table public.user_profiles(id uuid primary key,role public.app_role,is_active boolean,data_owner_user_id uuid,permissions jsonb);
 create table public.clients_cloud(user_id uuid,id text,data jsonb,primary key(user_id,id));
 alter table public.clients_cloud enable row level security;
 grant select,update on public.clients_cloud to authenticated;`);
 for(const name of ['default_screen_permissions','current_data_owner_user_id','has_role','current_user_screen_permissions','current_user_can_view_screen','can_access_owner_data','can_view_owner_screen'])await db.exec(fixture.functions.find(f=>f.name===name).definition);
 const original=fixture.policies.find(p=>p.tablename==='clients_cloud');
 await db.exec(`create policy ${original.policyname} on public.clients_cloud for select to authenticated using(${original.qual});
 create policy own_write on public.clients_cloud for update to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));`);
 await db.exec(readFileSync('supabase/133-startup-read-rls-fast-path.sql','utf8').match(/alter policy clients_cloud_operational_read[\s\S]*?\n\);/)[0]);
 for(const[n,role,active,owner]of[[1,'operador',true,2],[2,'operador',true,null],[4,'admin',true,null],[6,'admin',false,null],[7,'lectura',true,2],[9,'buscador',true,2]])await db.query('insert into public.user_profiles values($1,$2,$3,$4,null)',[uid(n),role,active,owner?uid(owner):null]);
 await db.exec(`insert into public.clients_cloud select '${uid(1)}',lpad(n::text,5,'0'),jsonb_build_object('id',lpad(n::text,5,'0'),'balance',n+0.25,'history',jsonb_build_array('ñá',n)) from generate_series(0,2500)n`);
 for(const owner of[2,3])await db.query('insert into public.clients_cloud values($1,$2,$3)',[uid(owner),'legacy-id',{id:'legacy-id',balance:123.45,custom:{preserve:true}}]);
 const beforeRows=(await db.query('select * from public.clients_cloud order by user_id,id')).rows;
 const beforePolicies=(await db.query("select * from pg_policies where tablename='clients_cloud' order by policyname")).rows;
 const beforeGrants=(await db.query("select * from information_schema.role_table_grants where table_schema='public' and table_name='clients_cloud' order by grantee,privilege_type")).rows;
 await db.exec(migration);
 assert.deepEqual((await db.query("select * from pg_policies where tablename='clients_cloud' order by policyname")).rows,beforePolicies);
 assert.deepEqual((await db.query("select * from information_schema.role_table_grants where table_schema='public' and table_name='clients_cloud' order by grantee,privilege_type")).rows,beforeGrants);
 assert.equal((await db.query("select has_function_privilege('anon','public.read_clients_snapshot_if_changed(uuid,text)','execute') allowed")).rows[0].allowed,false);
 assert.deepEqual((await db.query("select prosecdef,provolatile from pg_proc where proname='read_clients_snapshot_if_changed'")).rows,[{prosecdef:false,provolatile:'s'}]);
 for(const actor of[0,1,4,6,7,8,9]){
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor?uid(actor):'']);
  await db.exec('set role authenticated');
  try{
   for(const target of[1,2,3]){
    const direct=(await db.query('select id,data from public.clients_cloud where user_id=$1 order by id',[uid(target)])).rows;
    const first=(await db.query('select public.read_clients_snapshot_if_changed($1,null) result',[uid(target)])).rows[0].result;
    assert.equal(first.not_modified,false);
    assert.equal(first.count,direct.length);
    assert.deepEqual(JSON.parse(first.payload),direct);
    assert.equal(first.fingerprint,createHash('sha256').update(first.payload,'utf8').digest('hex'));
    const second=(await db.query('select public.read_clients_snapshot_if_changed($1,$2) result',[uid(target),first.fingerprint])).rows[0].result;
    assert.deepEqual(second,{...first,not_modified:true,payload:null});
    if(actor===1&&target===1)assert.equal(first.count,2501,'all rows must cross the REST row limit');
   }
   await assert.rejects(db.query('select public.read_clients_snapshot_if_changed(null,null)'),/owner is required/i);
  }finally{await db.exec('reset role');}
 }
 assert.deepEqual((await db.query('select * from public.clients_cloud order by user_id,id')).rows,beforeRows);
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid(1)]);
 await db.exec('set role authenticated');
 const old=(await db.query('select public.read_clients_snapshot_if_changed($1,null) result',[uid(1)])).rows[0].result;
 await db.exec('reset role');
 await db.query('update public.user_profiles set is_active=false where id=$1',[uid(1)]);
 await db.exec('set role authenticated');
 const revoked=(await db.query('select public.read_clients_snapshot_if_changed($1,$2) result',[uid(1),old.fingerprint])).rows[0].result;
 await db.exec('reset role');
 assert.equal(revoked.not_modified,false);
 assert.equal(revoked.payload,'[]');
 console.log('PASS validated snapshot SQL: complete 2501 rows, SHA-256 exact payload, own/shared/admin/restricted/inactive/missing access, immediate revocation, unchanged data/grants/write policies.');
}finally{await db.close();}
