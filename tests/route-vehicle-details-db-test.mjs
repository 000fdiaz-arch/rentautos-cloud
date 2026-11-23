import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '../.tmp/lead-portal-tests/node_modules/@electric-sql/pglite/dist/index.js';

const db = new PGlite();
const owner = '11111111-1111-4111-8111-111111111111';
const delta = '22222222-2222-4222-8222-222222222222';
const peer = '33333333-3333-4333-8333-333333333333';
const outsider = '44444444-4444-4444-8444-444444444444';
const inactive = '55555555-5555-4555-8555-555555555555';
const unknown = '66666666-6666-4666-8666-666666666666';
const publishedAt = '2026-11-23T12:00:00Z';
try {
  await db.exec(`
    create role authenticated; create role anon; create schema auth;
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table public.user_profiles(id uuid primary key,email text,role text,is_active boolean,data_owner_user_id uuid);
    insert into public.user_profiles values
      ('${owner}','admin@example.com','admin',true,null),
      ('${delta}','delta1@auth.rentautos.local','buscador',true,'${owner}'),
      ('${peer}','delta2@auth.rentautos.local','buscador',true,'${owner}'),
      ('${outsider}','foreign@example.com','admin',true,null),
      ('${inactive}','delta3@auth.rentautos.local','buscador',false,'${owner}'),
      ('${unknown}','other@example.com','buscador',true,'${owner}');
    create function public.can_view_owner_screen(o uuid,s text) returns boolean language sql security definer stable as $$
      select exists(select 1 from public.user_profiles where id=auth.uid() and is_active and coalesce(data_owner_user_id,id)=o and s='route_search')$$;
    create table public.active_route_items_cloud(user_id uuid,client_id text,data jsonb);
    create table public.cxc_v2_active_route_items_cloud(user_id uuid,client_id text,data jsonb);
    create table public.fleet_units_cloud(user_id uuid,unit_id text,plate text,color text,brand_model text,retired_at timestamptz);
    insert into public.active_route_items_cloud values
      ('${owner}','one','{"unitId":" A10 ","assignedDelta":"delta1","publishedAt":"${publishedAt}"}'),
      ('${owner}','peer','{"unitId":"B20","assignedDelta":"delta2","publishedAt":"${publishedAt}"}'),
      ('${owner}','missing','{"unitId":"M01","assignedDelta":"delta1","publishedAt":"${publishedAt}"}'),
      ('${owner}','removed','{"unitId":"A10","assignedDelta":"delta1","publishedAt":"${publishedAt}","removedAt":"2026-11-23"}');
    insert into public.cxc_v2_active_route_items_cloud values
      ('${owner}','one','{"unitId":"V01","assignedDelta":"delta1","publishedAt":"${publishedAt}"}');
    insert into public.fleet_units_cloud values
      ('${owner}','a10',' AB1234 ',' Blanco ',' Toyota Yaris ',null),
      ('${owner}','A10','OLD','Rojo','Anterior',now()),
      ('${owner}','B20','PEER','Azul','Auto ajeno',null),
      ('${owner}','V01','V2-001',null,'Kia Picanto',null),
      ('${owner}','M01','RETIRED','Negro','Retirado',now()),
      ('${outsider}','A10','FOREIGN','Negro','Otro dataset',null);
    grant usage on schema public,auth to authenticated,anon;
  `);
  await db.exec(readFileSync('supabase/migrations/20261123000100_route_vehicle_details.sql','utf8'));
  const actor = async id => db.exec(`reset role; set request.jwt.claim.sub='${id}'; set role authenticated;`);
  const read = async (client = 'one', version = 'legacy', target = owner, publication = publishedAt) =>
    (await db.query('select public.read_route_vehicle_details($1,$2,$3,$4) as details',[target,client,publication,version])).rows[0].details;
  await actor(delta);
  assert.deepEqual(await read(), { plate: 'AB1234', color: 'Blanco', brandModel: 'Toyota Yaris' });
  await assert.rejects(db.query('select * from public.fleet_units_cloud'), /permission denied/);
  await assert.rejects(read('peer'), /asignados a tu Delta/);
  await assert.rejects(read('one','legacy',outsider), /No tienes permiso/);
  await assert.rejects(read('one','legacy',owner,'old-publication'), /cambió/);
  await assert.rejects(read('removed'), /ya no está en ruta/);
  await assert.rejects(read('one','invalid'), /Versión/);
  assert.deepEqual(await read('missing'), { plate:null, color:null, brandModel:null });
  assert.deepEqual(await read('one','v2'), { plate:'V2-001', color:null, brandModel:'Kia Picanto' });
  await db.exec(`reset role; update public.fleet_units_cloud set color='Azul' where user_id='${owner}' and plate=' AB1234 ';`);
  await actor(delta);
  assert.equal((await read()).color, 'Azul', 'Reads reflect current Autos data without republishing routes.');
  await actor(peer);
  await assert.rejects(read(), /asignados a tu Delta/);
  assert.equal((await read('peer')).plate, 'PEER');
  await actor(owner);
  assert.equal((await read('peer')).plate, 'PEER');
  for (const id of [outsider,inactive,unknown,'']) {
    await actor(id);
    await assert.rejects(read(), /No tienes permiso|asignados a tu Delta/);
  }
  await db.exec('reset role; set role anon;');
  await assert.rejects(read(), /permission denied/);
  console.log('Route vehicle DB: only 3 fields, own Delta/owner/publication checks, no fleet access, live Autos updates, retired units and V2 isolation OK');
} finally { await db.close(); }
