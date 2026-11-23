import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '../.tmp/lead-portal-tests/node_modules/@electric-sql/pglite/dist/index.js';
const db=new PGlite();
const owner='11111111-1111-4111-8111-111111111111',delta='22222222-2222-4222-8222-222222222222',peer='33333333-3333-4333-8333-333333333333',inactive='44444444-4444-4444-8444-444444444444',foreign='55555555-5555-4555-8555-555555555555',unknown='66666666-6666-4666-8666-666666666666';
const pub='2026-11-23T12:00:00Z';
try {
 await db.exec(`create role authenticated;create role anon;create schema auth;
  create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  create table user_profiles(id uuid primary key,email text,role text,is_active boolean,data_owner_user_id uuid);
  insert into user_profiles values('${owner}','admin@example.com','admin',true,null),('${delta}','delta1@auth.rentautos.local','buscador',true,'${owner}'),
  ('${peer}','delta2@auth.rentautos.local','buscador',true,'${owner}'),('${inactive}','delta3@auth.rentautos.local','buscador',false,'${owner}'),
  ('${foreign}','admin@other.com','admin',true,null),('${unknown}','other@example.com','buscador',true,'${owner}');
  create function can_report_route_payment(o uuid) returns boolean language sql security definer as $$select exists(select 1 from public.user_profiles where id=auth.uid() and is_active and coalesce(data_owner_user_id,id)=o and role in('admin','buscador'))$$;
  create function can_edit_owner_screen(o uuid,s text) returns boolean language sql security definer as $$select exists(select 1 from public.user_profiles where id=auth.uid() and is_active and role='admin' and coalesce(data_owner_user_id,id)=o)$$;
  grant usage on schema public,auth to authenticated,anon;
  create table financial_data(data jsonb);insert into financial_data values('{"balance":120,"payments":[],"savings":5}');`);
 for(const prefix of ['', 'cxc_v2_']) {
  await db.exec(`create table ${prefix}active_route_items_cloud(user_id uuid,client_id text,data jsonb,in_custody boolean default false,
    custody_since timestamptz,custody_changed_at timestamptz,custody_changed_by uuid,custody_history jsonb default '[]',updated_at timestamptz,primary key(user_id,client_id));
   create table ${prefix}route_runs(id uuid primary key default gen_random_uuid(),user_id uuid,route_assignment text,operator_id uuid,operator_name text,status text default 'in_progress',started_at timestamptz default now());
   create unique index ${prefix}active_run on ${prefix}route_runs(user_id,operator_id) where status='in_progress';
   create table ${prefix}route_capture_events(id uuid primary key,user_id uuid,client_id text,unit_id text,client_name text,published_at text,route_assignment text,route_run_id uuid,reported_by uuid,reporter_name text,reported_at timestamptz,status text default 'pending',released_at timestamptz);
   create unique index ${prefix}active_capture on ${prefix}route_capture_events(user_id,client_id) where released_at is null;`);
  for(const [client,route,assigned] of [['one','PTY','delta1'],['two','WC','delta1'],['long','RUTA PERSONALIZADA','delta1'],['peer','PTY','delta2'],['admin','PTY','delta3'],['removed','PTY','delta1']]) {
   await db.query(`insert into ${prefix}active_route_items_cloud(user_id,client_id,data) values($1,$2,$3)`,[owner,client,{unitId:client,clientName:'Example',assignedDelta:assigned,routeAssignment:route,publishedAt:pub,releaseAmount:75,...client==='removed'?{removedAt:pub}:{}}]);
  }
 }
 await db.exec(readFileSync('supabase/migrations/20261123000300_route_delta_custody_declaration.sql','utf8'));
 const actor=async id=>db.exec(`reset role;set request.jwt.claim.sub='${id}';set role authenticated;`);
 const declare=(prefix='',client='one',publication=pub,enter=true,previous=false)=>db.query(`select public.${prefix}set_active_route_custody($1,$2,$3,$4,$5)`,[owner,client,publication,enter,previous]);
 for(const prefix of ['', 'cxc_v2_']) {
  await actor(delta);
  await assert.rejects(declare(prefix,'peer'),/asignadas a tu Delta/);
  await assert.rejects(declare(prefix,'removed'),/ya no está activa/);
  await assert.rejects(declare(prefix,'one','old'),/ya no está activa/);
  await declare(prefix);await declare(prefix,'two');await declare(prefix,'long');
  await assert.rejects(declare(prefix),/ya no está activa/);
  await assert.rejects(declare(prefix,'one',pub,false,true),/Solo Administración/);
  await db.exec('reset role;');
  const captures=(await db.query(`select * from ${prefix}route_capture_events order by client_id`)).rows;
  assert.equal(captures.length,3);assert.ok(captures.every(c=>c.reported_by===delta&&c.status==='pending'));
  assert.deepEqual(captures.map(c=>c.route_assignment).sort(),['PTY','RUTA PERSONALIZADA','WC']);
  const runs=(await db.query(`select * from ${prefix}route_runs`)).rows;
  assert.equal(runs.length,1,'All assigned routes can be captured within the same Delta run');assert.ok(captures.every(c=>c.route_run_id===runs[0].id));
  const item=(await db.query(`select * from ${prefix}active_route_items_cloud where client_id='one'`)).rows[0];
  assert.equal(item.in_custody,true);assert.equal(item.data.releaseAmount,75);assert.equal(item.data.publishedAt,pub);
  assert.equal(item.custody_changed_by,delta);assert.equal(item.custody_history[0].by,delta);assert.equal(item.custody_history[0].captureEventId,captures.find(c=>c.client_id==='one').id);
  await actor(peer);await declare(prefix,'peer');
  await assert.rejects(declare(prefix,'admin'),/asignadas a tu Delta/);
  for(const id of [inactive,foreign,unknown,'']){await actor(id);await assert.rejects(declare(prefix,'admin'),/permiso|asignadas a tu Delta/);}
  await actor(owner);await declare(prefix,'admin');await declare(prefix,'one',pub,false,true);
  await db.exec('reset role;');assert.equal((await db.query(`select in_custody from ${prefix}active_route_items_cloud where client_id='one'`)).rows[0].in_custody,false);
 }
 assert.deepEqual((await db.query('select data from financial_data')).rows[0].data,{balance:120,payments:[],savings:5});
 await db.exec('set role anon;');await assert.rejects(declare(),/permission denied/);
 console.log('Delta custody DB: own assigned units across routes, actor audit, pending admin review, auto-run reuse, stale/removed/foreign/inactive rejection, no duplicate, admin exit, no financial writes and V2 isolation OK');
}finally{await db.close();}
