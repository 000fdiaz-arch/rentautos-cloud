import assert from 'node:assert/strict';import{readFileSync}from'node:fs';
import{PGlite}from'../.tmp/lead-portal-tests/node_modules/@electric-sql/pglite/dist/index.js';
const db=new PGlite();const owner='11111111-1111-4111-8111-111111111111',delta='22222222-2222-4222-8222-222222222222',foreign='33333333-3333-4333-8333-333333333333',inactive='44444444-4444-4444-8444-444444444444',pub='2026-11-23T12:00:00Z';
try {
 await db.exec(`create role authenticated;create role anon;create schema auth;
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table public.user_profiles(id uuid,email text,role text,is_active boolean,data_owner_user_id uuid);
 insert into public.user_profiles values('${owner}','admin@example.com','admin',true,null),('${delta}','delta1@auth.rentautos.local','buscador',true,'${owner}'),('${foreign}','other@example.com','admin',true,null),('${inactive}','inactive@example.com','admin',false,'${owner}');
 create function public.can_edit_owner_screen(o uuid,s text) returns boolean language sql security definer as $$select exists(select 1 from public.user_profiles where id=auth.uid() and is_active and role='admin' and coalesce(data_owner_user_id,id)=o)$$;
 grant usage on schema public,auth to authenticated,anon;`);
 const original={unitId:'A10',publishedAt:pub,releaseAmount:89,managementType:'cobrar_o_quitar',assignedDelta:'delta1',comment:'Keep',financialData:{balance:120,savings:5}};
 for(const prefix of['','cxc_v2_']) {
  await db.exec(`create table ${prefix}active_route_items_cloud(user_id uuid,client_id text,data jsonb,updated_at timestamptz);`);
  for(const id of ['one','peer','removed'])await db.query(`insert into ${prefix}active_route_items_cloud values($1,$2,$3,now())`,[owner,id,{...original,...id==='removed'?{removedAt:pub}:{}}]);
 }
 await db.exec(readFileSync('supabase/migrations/20261123000400_route_panapass_reason.sql','utf8'));
 const actor=id=>db.exec(`reset role;set request.jwt.claim.sub='${id}';set role authenticated;`);
 const mark=(version='legacy',previous=false,next=true,publication=pub,client='one')=>db.query('select public.set_route_panapass_reason($1,$2,$3,$4,$5,$6)',[owner,client,publication,previous,next,version]);
 for(const version of ['legacy','v2']) {
  const prefix=version==='v2'?'cxc_v2_':'';
  for(const id of[delta,foreign,inactive,'']){await actor(id);await assert.rejects(mark(version),/Solo Administración/);}
  await actor(owner);await assert.rejects(mark(version,false,true,'old'),/ya no está en ruta/);await assert.rejects(mark(version,false,true,pub,'removed'),/ya no está en ruta/);
  await mark(version);await assert.rejects(mark(version),/otro dispositivo/);
  await db.exec('reset role;');
  let row=(await db.query(`select data from ${prefix}active_route_items_cloud where client_id='one'`)).rows[0].data;
  assert.equal(row.panapassRoute,true);assert.equal(row.panapassUpdatedBy,owner);assert.ok(row.panapassUpdatedAt);
  const{panapassRoute,panapassUpdatedAt,panapassUpdatedBy,...unchanged}=row;assert.deepEqual(unchanged,original);
  assert.equal((await db.query(`select data from ${prefix}active_route_items_cloud where client_id='peer'`)).rows[0].data.panapassRoute,undefined);
  await actor(owner);await mark(version,true,false);await db.exec('reset role;');row=(await db.query(`select data from ${prefix}active_route_items_cloud where client_id='one'`)).rows[0].data;assert.equal(row.panapassRoute,false);
 }
 await actor(owner);await assert.rejects(mark('wrong'),/Versión/);await assert.rejects(mark('legacy',null),/válida/);
 await db.exec('reset role;set role anon;');await assert.rejects(mark(),/permission denied/);
 console.log('Panapass DB: active same-owner Admin only, manual opt-in, timestamp/actor, stale publication/state and removed checks, removal, other clients/financial fields preserved, V2 isolation OK');
}finally{await db.close();}
