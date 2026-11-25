import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '../.tmp/lead-portal-tests/node_modules/@electric-sql/pglite/dist/index.js';
const fixture=JSON.parse(readFileSync('tests/fixtures/startup-read-permissions.json','utf8'));
const migration=readFileSync('supabase/139-control-units-read-snapshot.sql','utf8');
assert.equal(migration,readFileSync('supabase/migrations/20261125000200_control_units_read_snapshot.sql','utf8'));
const uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const catalog=['catalog_contract_months','catalog_daily_rate','catalog_weekly_rate','catalog_biweekly_rate','catalog_daily_management_fee','catalog_weekly_management_fee','catalog_biweekly_management_fee','catalog_photo_path'];
const db=new PGlite();
try{
 await db.exec(`create role authenticated;create role anon;create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema public,auth to authenticated,anon;
 create type public.app_role as enum('admin','operador','lectura','buscador');
 create table public.user_profiles(id uuid primary key,role public.app_role,is_active boolean,data_owner_user_id uuid,permissions jsonb);
 create table public.fleet_units_cloud(user_id uuid,fleet_id text,unit_id text,retired_at timestamptz,key_coded boolean,${catalog.map(c=>`${c} ${c==='catalog_photo_path'?'text':'numeric'}`).join(',')},primary key(user_id,fleet_id));
 alter table public.fleet_units_cloud enable row level security;
 grant select,update on public.fleet_units_cloud to authenticated;
 create view public.vw_control_unidades with(security_invoker=true) as select f.*,42.25 financial_balance,'cliente-vigente' client_name from public.fleet_units_cloud f where retired_at is null;
 grant select on public.vw_control_unidades to authenticated;`);
 for(const name of['default_screen_permissions','current_data_owner_user_id','has_role','current_user_screen_permissions','current_user_can_view_screen','can_access_owner_data','can_view_owner_screen'])await db.exec(fixture.functions.find(f=>f.name===name).definition);
 for(const policy of fixture.policies.filter(p=>p.tablename==='fleet_units_cloud'))await db.exec(`create policy ${policy.policyname} on public.fleet_units_cloud for select to authenticated using(${policy.qual})`);
 for(const block of readFileSync('supabase/133-startup-read-rls-fast-path.sql','utf8').matchAll(/alter policy \w+ on public\.fleet_units_cloud[\s\S]*?\n\);/g))await db.exec(block[0]);
 await db.exec(`create policy own_write on public.fleet_units_cloud for update to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));`);
 const deny=Object.fromEntries(['clients','payments','receivables','route_search','incidents','control_units','leads','settings','dashboard'].map(s=>[s,{view:false,edit:false}]));
 for(const[n,role,active,owner,permissions]of[[1,'operador',true,2,null],[2,'operador',true,null,null],[4,'admin',true,null,null],[6,'admin',false,null,null],[7,'lectura',true,2,null],[9,'buscador',true,2,null],[10,'operador',true,2,deny]])await db.query('insert into public.user_profiles values($1,$2,$3,$4,$5)',[uid(n),role,active,owner?uid(owner):null,permissions]);
 await db.exec(`insert into public.fleet_units_cloud(user_id,fleet_id,unit_id,key_coded,${catalog.join(',')}) select '${uid(1)}',n::text,lpad(n::text,5,'0'),n%2=0,24,25.5,150.25,300.5,1.1,2.2,3.3,'foto-ñ-'||n from generate_series(0,2500)n`);
 for(const owner of[1,2,3])await db.query('insert into public.fleet_units_cloud(user_id,fleet_id,unit_id,retired_at) values($1,$2,$3,now())',[uid(owner),'retired','retired']);
 for(const owner of[2,3])await db.query('insert into public.fleet_units_cloud(user_id,fleet_id,unit_id) values($1,$2,$3)',[uid(owner),'legacy-id','B01']);
 const dataBefore=(await db.query('select * from public.fleet_units_cloud order by user_id,fleet_id')).rows;
 const meta=async()=>(await db.query("select jsonb_build_object('policies',(select jsonb_agg(p order by policyname) from pg_policies p where tablename='fleet_units_cloud'),'grants',(select jsonb_agg(g order by table_name,grantee,privilege_type) from information_schema.role_table_grants g where table_name in('fleet_units_cloud','vw_control_unidades'))) m")).rows;
 const before=await meta();await db.exec(migration);assert.deepEqual(await meta(),before);
 for(const actor of[0,1,2,4,6,7,8,9,10]){
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor?uid(actor):'']);await db.exec('set role authenticated');
  try{for(const target of[1,2,3]){
   // PostgREST encodes numeric values through JSON; PGlite's direct numeric
   // driver returns strings, so compare the same JSON representation.
   const view=(await db.query('select to_jsonb(v) row from public.vw_control_unidades v where user_id=$1 order by unit_id',[uid(target)])).rows.map(r=>r.row);
   const details=(await db.query('select to_jsonb(f) row from public.fleet_units_cloud f where user_id=$1 and retired_at is null',[uid(target)])).rows.map(r=>r.row);
   const expected=view.map(v=>{const f=details.find(f=>f.fleet_id===v.fleet_id);return f?{...v,...Object.fromEntries(catalog.map(c=>[c,f[c]])),key_coded:f.key_coded??v.key_coded??null}:v;});
   const result=(await db.query('select public.read_control_units_snapshot($1) result',[uid(target)])).rows[0].result;
   assert.equal(result.version,1);assert.equal(result.owner,uid(target));assert.equal(result.rows.length,expected.length);
   for(let i=0;i<expected.length;i++)assert.deepEqual(result.rows[i],expected[i],`Actor ${actor} target ${target} row ${i}`);
   if(actor===1&&target===1)assert.equal(result.rows.length,2501);
  }}finally{await db.exec('reset role');}
 }
 assert.deepEqual((await db.query('select * from public.fleet_units_cloud order by user_id,fleet_id')).rows,dataBefore);
 assert.equal((await db.query("select has_function_privilege('anon','public.read_control_units_snapshot(uuid)','execute') allowed")).rows[0].allowed,false);
 assert.deepEqual((await db.query("select prosecdef,provolatile from pg_proc where proname='read_control_units_snapshot'")).rows,[{prosecdef:false,provolatile:'s'}]);
 console.log('PASS fleet SQL snapshot: parity with three direct reads for 9 access contexts/3 owners, all 2501 active rows, catalog/key/financial fields, retired excluded, data/grants/view/write policies unchanged.');
}finally{await db.close();}
