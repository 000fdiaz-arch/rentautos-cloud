import fs from 'node:fs';
import assert from 'node:assert/strict';
import { PGlite } from '../.tmp/lead-portal-tests/node_modules/@electric-sql/pglite/dist/index.js';
const db=new PGlite();
try {
 await db.exec(`create role anon; create role authenticated; create schema auth;
 create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 create function public.can_view_owner_screen(owner uuid,screen text) returns boolean language sql as $$ select owner=auth.uid() $$;
 create table public.payments_cloud(user_id uuid,id text,data jsonb,updated_at timestamptz,primary key(user_id,id));
 create table public.cxc_v2_route_payment_reports(user_id uuid,client_id text,status text,reported_at timestamptz);
 create table public.street_management_items_cloud(user_id uuid,client_id text,data jsonb);
 create table observation_events(op text);
 create function public.cxc_v2_sync_route_payment_report() returns trigger language plpgsql as $$ begin insert into public.observation_events values(tg_op); if tg_op='DELETE' then return old; end if; return new; end $$;
 create function public.cxc_v2_sync_visual_route_bank_payment() returns trigger language plpgsql as $$ begin if tg_op='DELETE' then return old; end if; return new; end $$;`);
 await db.exec(fs.readFileSync('supabase/migrations/20261118000400_cxc_v2_payment_observer_isolation.sql','utf8'));
 const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
 await db.query('insert into auth.users values($1),($2)',[owner,other]);
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
 await db.query("insert into public.street_management_items_cloud values($1,'A02',$2)",[owner,{comment:'Original intacta'}]);
 await db.query("insert into cxc_v2_route_payment_reports values($1,'client-a','review','2026-11-18T14:00:00Z')",[owner]);
 const payment={clientId:'client-a',createdAt:'2026-11-18T15:00:00Z',amountReceived:40};
 await db.query("insert into payments_cloud values($1,'receipt',$2,now())",[owner,payment]);
 assert.equal((await db.query('select count(*)::int as n from observation_events')).rows[0].n,0,'Original payment insert must not invoke V2');
 await db.query('select cxc_v2_refresh_payment_observations($1)',[owner]);
 assert.equal((await db.query('select data from cxc_v2_payment_observations')).rows[0].data.amountReceived,40);
 await db.query('select cxc_v2_refresh_payment_observations($1)',[owner]);
 assert.equal((await db.query('select count(*)::int as n from observation_events')).rows[0].n,1,'Refresh is idempotent');
 await db.query('update payments_cloud set data=$1 where id=$2',[{...payment,amountReceived:50},'receipt']);
 await db.query('select cxc_v2_refresh_payment_observations($1)',[owner]);
 assert.equal((await db.query('select data from cxc_v2_payment_observations')).rows[0].data.amountReceived,50);
 await assert.rejects(db.query('select cxc_v2_refresh_payment_observations($1)',[other]),/permiso/);
 await db.query("delete from payments_cloud where id='receipt'");
 await db.query('select cxc_v2_refresh_payment_observations($1)',[owner]);
 assert.equal((await db.query('select count(*)::int as n from cxc_v2_payment_observations')).rows[0].n,0);
 assert.equal((await db.query('select data from street_management_items_cloud')).rows[0].data.comment,'Original intacta');
 console.log('PASS offline SQL: original payment writes have no V2 side effects; authorized reconciliation observes insert/update/delete, is idempotent, rejects other owners and leaves original management intact.');
} finally {await db.close();}

