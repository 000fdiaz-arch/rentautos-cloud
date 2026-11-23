import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '../.tmp/lead-portal-tests/node_modules/@electric-sql/pglite/dist/index.js';
const db=new PGlite();
const owner='11111111-1111-4111-8111-111111111111',delta='22222222-2222-4222-8222-222222222222',foreign='33333333-3333-4333-8333-333333333333',inactive='44444444-4444-4444-8444-444444444444';
const pub='2026-11-23T12:00:00Z';
try {
  await db.exec(`create role authenticated;create role anon;create schema auth;
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table public.user_profiles(id uuid primary key,email text,role text,is_active boolean,data_owner_user_id uuid);
    insert into public.user_profiles values
      ('${owner}','admin@example.com','admin',true,null),('${delta}','delta1@auth.rentautos.local','buscador',true,'${owner}'),
      ('${foreign}','other@example.com','admin',true,null),('${inactive}','delta3@auth.rentautos.local','buscador',false,'${owner}');
    create function public.can_edit_owner_screen(o uuid,s text) returns boolean language sql security definer as $$select exists(select 1 from public.user_profiles where id=auth.uid() and is_active and role='admin' and coalesce(data_owner_user_id,id)=o)$$;
    create function public.can_report_route_payment(o uuid) returns boolean language sql security definer as $$select exists(select 1 from public.user_profiles where id=auth.uid() and is_active and coalesce(data_owner_user_id,id)=o)$$;
    grant usage on schema public,auth to authenticated,anon;`);
  for(const prefix of ['', 'cxc_v2_']) {
    await db.exec(`create table public.${prefix}active_route_items_cloud(user_id uuid,client_id text,data jsonb,updated_at timestamptz);
      create table public.${prefix}street_management_items_cloud(user_id uuid,client_id text,data jsonb,updated_at timestamptz);
      create table public.${prefix}route_payment_reports(user_id uuid,client_id text,published_at text,snapshot jsonb,amount numeric,method text,cash_amount numeric,bank_amount numeric,management_outcome text,reported_by uuid,reporter_name text);
      insert into public.${prefix}active_route_items_cloud values('${owner}','own','{"publishedAt":"${pub}","assignedDelta":"delta1","releaseAmount":89,"managementType":"cobrar_o_quitar"}',now()),
      ('${owner}','peer','{"publishedAt":"${pub}","assignedDelta":"delta2"}',now()),
      ('${owner}','removed','{"publishedAt":"${pub}","assignedDelta":"delta1","removedAt":"2026-11-23"}',now());
      insert into public.${prefix}street_management_items_cloud values('${owner}','own','{"managementType":"cobrar_o_quitar","comment":"Keep this"}',now());`);
  }
  await db.exec(readFileSync('supabase/migrations/20261123000200_route_admin_actions_and_declarations.sql','utf8'));
  const actor=async id=>db.exec(`reset role;set request.jwt.claim.sub='${id}';set role authenticated;`);
  const edit=(version='legacy',previous='cobrar_o_quitar',publication=pub,client='own',type='desiste')=>db.query('select public.update_route_management_type($1,$2,$3,$4,$5,$6)',[owner,client,publication,previous,type,version]);
  const declare=(prefix='',client='own',publication=pub,cash=10,bank=15,old=false)=>db.query(`select public.${prefix}report_route_payment_split($1,$2,$3,$4,$5${old?'':',$6'})`,[owner,client,publication,cash,bank,...old?[]:['collected']]);
  await actor(owner);
  for(const prefix of ['', 'cxc_v2_']) for(const old of [true,false]) await assert.rejects(declare(prefix,'own',pub,10,15,old),/exclusivas de los buscadores/);
  await edit();
  await assert.rejects(edit(),/otro dispositivo/);
  await assert.rejects(edit('legacy','desiste','old'),/ya no está en ruta/);
  await assert.rejects(edit('legacy','desiste',pub,'own','bad'),/válida/);
  await assert.rejects(edit('legacy','solo_cobrar',pub,'removed'),/ya no está en ruta/);
  await edit('v2');
  await actor(delta);
  await assert.rejects(edit('legacy','desiste'),/Solo Administración/);
  for(const prefix of ['', 'cxc_v2_']) {
    await declare(prefix);
    await declare(prefix,'own',pub,5,0,true);
    await assert.rejects(declare(prefix,'peer'),/no pertenece a tu Delta/);
    await assert.rejects(declare(prefix,'own','old'),/ya no está en ruta/);
    await assert.rejects(declare(prefix,'removed'),/ya no está en ruta/);
    for(const bad of [-1,1.001,'NaN']) await assert.rejects(declare(prefix,'own',pub,bad,1),/importes válidos/);
  }
  for(const id of [foreign,inactive,'']) {
    await actor(id);
    await assert.rejects(edit('legacy','desiste'),/Solo Administración/);
    await assert.rejects(declare(),/exclusivas/);
  }
  await db.exec('reset role;');
  for(const prefix of ['', 'cxc_v2_']) {
    const data=(await db.query(`select data from ${prefix}active_route_items_cloud where client_id='own'`)).rows[0].data;
    assert.equal(data.managementType,'desiste'); assert.equal(data.releaseAmount,89);assert.equal(data.publishedAt,pub);assert.equal(data.assignedDelta,'delta1');
    assert.equal(data.managementTypeEdits.length,1);assert.equal(data.managementTypeEdits[0].by,owner);
    const street=(await db.query(`select data from ${prefix}street_management_items_cloud`)).rows[0].data;
    assert.equal(street.managementType,'desiste');assert.equal(street.comment,'Keep this');
    const reports=(await db.query(`select * from ${prefix}route_payment_reports`)).rows;
    assert.equal(reports.length,2);assert.equal(Number(reports[0].cash_amount),10);assert.equal(Number(reports[0].bank_amount),15);
  }
  await db.exec('set role anon;');await assert.rejects(edit(),/permission denied/);
  console.log('Route DB: admin action edits audited, stale/removed checks, money preserved, both declaration signatures operator-only, own Delta and V2 isolation OK');
} finally {await db.close();}
