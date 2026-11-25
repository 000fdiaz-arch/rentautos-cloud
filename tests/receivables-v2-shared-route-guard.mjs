import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '../.tmp/lead-portal-tests/node_modules/@electric-sql/pglite/dist/index.js';
const db=new PGlite();
try {
 await db.exec(`create table active_route_items_cloud(user_id text,client_id text,data jsonb);create table cxc_v2_active_route_items_cloud(user_id text,client_id text,data jsonb);create table cxc_v2_street_management_items_cloud(user_id text,client_id text,data jsonb);`);
 const old=fs.readFileSync('supabase/migrations/20261118000300_cxc_v2_isolated_management.sql','utf8');
 await db.exec(old.slice(old.indexOf('CREATE OR REPLACE FUNCTION public.cxc_v2_guard_active_route_management_tag()'),old.indexOf('revoke all on function public.cxc_v2_guard_active_route_management_tag()')));
 await db.exec(`create trigger guard before update on cxc_v2_street_management_items_cloud for each row execute function cxc_v2_guard_active_route_management_tag();insert into active_route_items_cloud values('owner','A87','{}');insert into cxc_v2_active_route_items_cloud values('owner','A87','{}');`);
 const initial={isRouteTagged:true,routeAssignment:'PTY',routeReleaseAmount:4,supportNote:'Keep',contactOutcomes:[{result:'promise',at:'old'}]};
 await db.query('insert into cxc_v2_street_management_items_cloud values($1,$2,$3)',['owner','A87',JSON.stringify(initial)]);
 const attempt={...initial,isRouteTagged:false,contactOutcomes:[...initial.contactOutcomes,{result:'no_answer',at:'new'}]};
 const save=()=>db.query('update cxc_v2_street_management_items_cloud set data=$1 returning data',[JSON.stringify(attempt)]);
 assert.equal((await save()).rows.length,0,'reproduce silently rejected attempt');
 await db.exec(fs.readFileSync('supabase/migrations/20261124000200_cxc_v2_shared_route_guard.sql','utf8'));
 const saved=(await save()).rows[0].data;
 assert.equal(saved.isRouteTagged,true);assert.equal(saved.routeAssignment,'PTY');assert.equal(saved.routeReleaseAmount,4);assert.deepEqual(saved.contactOutcomes,attempt.contactOutcomes);assert.equal(saved.supportNote,'Keep');
 await db.exec(`update active_route_items_cloud set data='{"removedAt":"2026-11-24T22:00:00Z"}'`);
 assert.equal((await save()).rows[0].data.isRouteTagged,false,'actual shared removal allowed despite obsolete isolated route');
 console.log('PASS reproduced discarded A87-style contact; fixed guard retains contact history and route, allows shared removal, ignores obsolete separate route. Memory database only.');
} finally {await db.close();}
