import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {PGlite} from '../.tmp/lead-portal-tests/node_modules/@electric-sql/pglite/dist/index.js';
const fixture=JSON.parse(readFileSync('tests/fixtures/startup-read-permissions.json','utf8'));
const policy=JSON.parse(readFileSync('tests/fixtures/startup-payment-read-policy.json','utf8'));
const migration=readFileSync('supabase/140-initial-payments-read-snapshot.sql','utf8');
assert.equal(migration,readFileSync('supabase/migrations/20261125000300_initial_payments_read_snapshot.sql','utf8'));
const uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const db=new PGlite();
try{
 await db.exec(`create role authenticated;create role anon;create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,anon;
 create type public.app_role as enum('admin','operador','lectura','buscador');create table public.user_profiles(id uuid primary key,role public.app_role,is_active boolean,data_owner_user_id uuid,permissions jsonb);
 create table public.payments_cloud(user_id uuid,id text,data jsonb,updated_at timestamptz,primary key(user_id,id));alter table public.payments_cloud enable row level security;grant select,update on public.payments_cloud to authenticated;`);
 for(const name of['default_screen_permissions','current_data_owner_user_id','has_role','current_user_screen_permissions','current_user_can_view_screen','can_access_owner_data','can_view_owner_screen'])await db.exec(fixture.functions.find(f=>f.name===name).definition);
 await db.exec(`create policy ${policy.policyname} on public.payments_cloud for select to authenticated using(${policy.qual});create policy own_write on public.payments_cloud for update to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));`);
 await db.exec(readFileSync('supabase/134-startup-payment-read-rls-fast-path.sql','utf8'));
 await db.exec(readFileSync('supabase/77-pending-cash-fast-path.sql','utf8'));
 for(const[n,role,active,owner]of[[1,'operador',true,2],[2,'operador',true,null],[4,'admin',true,null],[6,'admin',false,null],[7,'lectura',true,2],[9,'buscador',true,2]])await db.query('insert into public.user_profiles values($1,$2,$3,$4,null)',[uid(n),role,active,owner?uid(owner):null]);
 await db.exec(`insert into public.payments_cloud select '${uid(1)}',lpad(n::text,5,'0'),jsonb_build_object('id',lpad(n::text,5,'0'),'amount',n+0.25,'custom',jsonb_build_array('ñ',n),'paymentMethod','Efectivo','moneyDelivered',false,'dateApplied',case when n=1800 then '2026-11-26' else '2025-01-01' end),timestamptz '2026-01-01'+n*interval '1 second' from generate_series(0,1800)n`);
 for(const owner of[2,3])await db.query("insert into public.payments_cloud values($1,'legacy',$2,now())",[uid(owner),{id:'legacy',amount:123.45,paymentMethod:'Efectivo',moneyDelivered:false,dateApplied:'2025-01-01'}]);
 const beforeData=(await db.query('select * from public.payments_cloud order by user_id,id')).rows;
 const meta=async()=>(await db.query("select jsonb_build_object('policies',(select jsonb_agg(p order by policyname) from pg_policies p where tablename='payments_cloud'),'grants',(select jsonb_agg(g order by grantee,privilege_type) from information_schema.role_table_grants g where table_name='payments_cloud')) m")).rows;
 const beforeMeta=await meta();await db.exec(migration);assert.deepEqual(await meta(),beforeMeta);
 for(const actor of[0,1,2,4,6,7,8,9]){
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor?uid(actor):'']);await db.exec('set role authenticated');
  try{for(const target of[1,2,3]){
   let pending;try{pending=(await db.query("select p.data from public.read_pending_cash_payments($1,'2026-11-25') p(data)",[uid(target)])).rows.map(r=>r.data);}catch{
    await assert.rejects(db.query("select public.read_initial_payments_snapshot($1,'2026-11-25',300,null)",[uid(target)]));continue;
   }
   const recent=(await db.query('select data from public.payments_cloud where user_id=$1 order by updated_at desc limit 300',[uid(target)])).rows.map(r=>r.data);
   const first=(await db.query("select public.read_initial_payments_snapshot($1,'2026-11-25',300,null) result",[uid(target)])).rows[0].result;
   const actual=JSON.parse(first.payload);assert.equal(actual.recent.length,recent.length);assert.equal(actual.pending.length,pending.length);
   for(const name of['recent','pending'])assert.equal(JSON.stringify(actual[name]),JSON.stringify({recent,pending}[name]),`actor ${actor} owner ${target} ${name}`);
   assert.equal(first.fingerprint,createHash('sha256').update(first.payload).digest('hex'));assert.equal(first.not_modified,false);
   const second=(await db.query("select public.read_initial_payments_snapshot($1,'2026-11-25',300,$2) result",[uid(target),first.fingerprint])).rows[0].result;assert.deepEqual(second,{...first,payload:null,not_modified:true});
   if(actor===1&&target===1)assert.equal(actual.pending.length,1800,'older pending must not be limited to recent 300 or REST 1000');
  }}finally{await db.exec('reset role');}
 }
 assert.deepEqual((await db.query('select * from public.payments_cloud order by user_id,id')).rows,beforeData);
 assert.deepEqual((await db.query("select prosecdef,provolatile,has_function_privilege('anon',oid,'execute') anon_execute from pg_proc where oid='public.read_initial_payments_snapshot(uuid,date,integer,text)'::regprocedure")).rows,[{prosecdef:false,provolatile:'s',anon_execute:false}]);
 console.log('PASS payments SQL: same recent 300 and all 1800 older pending, dates, full fields and SHA256; 8 access contexts/3 owners preserve existing permissions/errors, data and write policies.');
}finally{await db.close();}
