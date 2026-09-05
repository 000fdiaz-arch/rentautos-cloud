import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '../.tmp/lead-portal-tests/node_modules/@electric-sql/pglite/dist/index.js';
const db=new PGlite();
const owner='11111111-1111-4111-8111-111111111111';
const stamp='2026-09-05T12:00:00Z';
try {
  await db.exec(`create role anon;create role authenticated;
    create function public.can_edit_owner_screen(uuid,text) returns boolean language sql as $$select $1='${owner}'::uuid and current_setting('test.editor',true)='yes'$$;
    create table street_management_items_cloud(user_id uuid,client_id text,data jsonb,primary key(user_id,client_id));
    create table clients_cloud(user_id uuid,id text,data jsonb);
    insert into clients_cloud values('${owner}','c1','{"unitId":"A10","status":"activo"}');
    create table active_route_items_cloud(user_id uuid,client_id text,data jsonb,updated_at timestamptz,in_custody boolean default false,custody_history jsonb default '[]',primary key(user_id,client_id));
    set test.editor='yes';`);
  const sql=readFileSync('supabase/migrations/20260905000300_auto_publish_route.sql','utf8');await db.exec(sql);await db.exec(sql);
  let record={isRouteTagged:true,updatedAt:stamp,routeReleaseAmount:40,routeAssignment:'PTY',routeUrgency:'urgent'};
  const save=()=>db.query('insert into street_management_items_cloud values($1,$2,$3) on conflict(user_id,client_id) do update set data=excluded.data',[owner,'c1',JSON.stringify(record)]);
  const item={clientId:'c1',unitId:'A10',releaseAmount:999,routeAssignment:'WC',publishedAt:'old',routeStartedAt:stamp};
  const publish=(o=owner,version=record.updatedAt)=>db.query('select publish_prepared_route_item($1,$2,$3) item',[o,JSON.stringify(item),version]);
  await save();await assert.rejects(publish(owner,'stale'),/preparación cambió/);
  await assert.rejects(publish('22222222-2222-4222-8222-222222222222'),/permiso/);
  await db.exec("set test.editor='no'");await assert.rejects(publish(),/permiso/);await db.exec("set test.editor='yes'");
  for(const patch of [{routeAssignment:''},{routeReleaseAmount:0},{isRouteTagged:false}]) {
    const previous=record;record={...record,...patch};await save();await assert.rejects(publish());record=previous;
  }
  await save();const first=(await publish()).rows[0].item;
  assert.equal(first.releaseAmount,40);assert.equal(first.routeAssignment,'PTY');assert.equal(first.urgency,'urgent');
  assert.notEqual(first.publishedAt,'old');
  assert.deepEqual((await publish()).rows[0].item,first,'Retry must not republish');
  await db.exec("update active_route_items_cloud set in_custody=true,custody_history='[1]',data=data||'{\"partialDecisionRentAmount\":32}'::jsonb");
  record={...record,routeReleaseAmount:50,updatedAt:'2026-09-05T13:00:00Z'};await save();
  const same=(await publish()).rows[0].item;assert.equal(same.releaseAmount,40);assert.equal(same.partialDecisionRentAmount,32);assert.equal(same.publishedAt,first.publishedAt);
  await db.exec("update active_route_items_cloud set data=data||'{\"removedAt\":\"2026-09-05T14:00:00Z\",\"removedReason\":\"paid\"}'::jsonb");
  await assert.rejects(publish(),/retirada/);
  record={...record,updatedAt:'2026-09-05T15:00:00Z'};await save();
  const resent=(await publish()).rows[0].item;assert.equal(resent.releaseAmount,50);assert.equal(resent.removedAt,undefined);assert.equal(resent.partialDecisionRentAmount,undefined);
  assert.equal((await db.query('select in_custody from active_route_items_cloud')).rows[0].in_custody,true);
  assert.equal((await db.query('select count(*)::int n from active_route_items_cloud')).rows[0].n,1);
  console.log('OK: saved readiness, permissions, stale requests, idempotent retry, existing decisions and custody, removal guard and deliberate resend');
} finally { await db.close(); }
