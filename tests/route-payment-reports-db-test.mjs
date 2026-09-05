import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '../.tmp/lead-portal-tests/node_modules/@electric-sql/pglite/dist/index.js';

const db = new PGlite();
const owner='11111111-1111-4111-8111-111111111111';
const seeker='22222222-2222-4222-8222-222222222222';
const peer='33333333-3333-4333-8333-333333333333';
const other='44444444-4444-4444-8444-444444444444';
const pub='2026-09-04T12:00:00.000Z';
try {
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key);
    insert into auth.users values('${owner}'),('${seeker}'),('${peer}'),('${other}');
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated,anon;
    create table public.user_profiles(id uuid primary key,role text,is_active boolean,email text,owner_id uuid,view_route boolean,edit_route boolean);
    insert into user_profiles values
    ('${owner}','admin',true,'Admin','${owner}',true,true),
    ('${seeker}','buscador',true,'Ana','${owner}',true,false),
    ('${peer}','buscador',true,'Luis','${owner}',true,false),
    ('${other}','lectura',true,'Otro','${other}',true,false);
    create function public.can_view_owner_screen(o uuid,s text) returns boolean language sql security definer as
    $$select exists(select 1 from public.user_profiles where id=auth.uid() and is_active and owner_id=o and view_route)$$;
    create function public.can_edit_owner_screen(o uuid,s text) returns boolean language sql security definer as
    $$select exists(select 1 from public.user_profiles where id=auth.uid() and is_active and owner_id=o and view_route and edit_route)$$;
    create table public.active_route_items_cloud(user_id uuid,client_id text,data jsonb,primary key(user_id,client_id));
    create table public.payments_cloud(user_id uuid,id text,data jsonb,primary key(user_id,id));
    create table public.clients_cloud(user_id uuid,id text,data jsonb);
    alter table active_route_items_cloud enable row level security;
    alter table payments_cloud enable row level security;
    alter table clients_cloud enable row level security;
    grant select,insert,update,delete on active_route_items_cloud,payments_cloud,clients_cloud to authenticated;
    insert into active_route_items_cloud values('${owner}','c1','{"clientId":"c1","unitId":"RA-042","publishedAt":"${pub}","releaseAmount":60}');
  `);
  const sql=readFileSync('supabase/69-route-payment-reports.sql','utf8');
  assert.equal(sql,readFileSync('supabase/migrations/20260904000100_route_payment_reports.sql','utf8'));
  await db.exec(sql); await db.exec(sql);
  const login=async id=>db.exec(`reset role; set request.jwt.claim.sub='${id}'; set role authenticated;`);
  const report=(amount=60,method='cash',o=owner,p=pub)=>db.query('select report_route_payment($1,$2,$3,$4,$5)',[o,'c1',p,amount,method]);
  const rows=async()=> (await db.query('select * from route_payment_reports order by reported_at')).rows;
  await login(seeker);
  await assert.rejects(report(0),/monto/); await assert.rejects(report(-1),/monto/);
  await assert.rejects(report(1.001),/monto/); await assert.rejects(report(60,'bogus'),/monto/);
  await assert.rejects(report(60,'cash',other),/permiso/);
  await assert.rejects(report(60,'cash',owner,'old'),/cambió/);
  for (const table of ['payments_cloud','clients_cloud']) {
    await assert.rejects(db.query(`insert into ${table} values($1,'forged','{}')`,[owner]),/row-level security/);
  }
  await assert.rejects(db.query("insert into active_route_items_cloud values($1,'forged','{}')",[owner]),/row-level security/);
  await report();
  let r=(await rows())[0]; assert.equal(r.status,'review');assert.equal(r.reported_by,seeker);
  await assert.rejects(report(),/ya tiene un reporte/);
  await assert.rejects(db.exec("update route_payment_reports set status='confirmed'"),/permission denied/);
  await assert.rejects(db.exec('delete from route_payment_reports'),/permission denied/);
  await login(peer);await assert.rejects(db.query('select cancel_route_payment_report($1)',[r.id]),/permiso/);
  await login(other);assert.equal((await rows()).length,0);await assert.rejects(report(),/permiso/);
  await db.exec(`reset role; update user_profiles set is_active=false where id='${seeker}';`);
  await login(seeker);await assert.rejects(report(),/permiso/);
  await db.exec(`reset role; update user_profiles set is_active=true,view_route=false where id='${seeker}';`);
  await login(seeker);await assert.rejects(report(),/permiso/);
  await db.exec(`reset role; update user_profiles set view_route=true where id='${seeker}';`);
  await db.exec(`update user_profiles set role='lectura' where id='${seeker}';`);
  await login(seeker);await assert.rejects(report(),/permiso/);
  await db.exec(`reset role; update user_profiles set role='buscador' where id='${seeker}';`);
  console.log('OK: scoped RPC, active profile, screen access, owner isolation, no direct writes, duplicate protection');
  const payment=async(id,patch={})=> {
    await db.exec('reset role');
    const time=(await db.query("select clock_timestamp() as stamp,to_char(clock_timestamp() at time zone 'America/Panama','YYYY-MM-DD') as day")).rows[0];
    const data={clientId:'c1',clientUnit:'RA-042',amountReceived:60,paymentMethod:'Efectivo',createdAt:time.stamp,dateApplied:time.day,...patch};
    await db.query('insert into payments_cloud values($1,$2,$3)',[owner,id,JSON.stringify(data)]);
  };
  await payment('old',{createdAt:'2020-01-01T00:00:00Z'});
  await payment('wrong-unit',{clientUnit:'RA-099'});
  await payment('wrong-amount',{amountReceived:50});
  await payment('wrong-method',{paymentMethod:'Transferencia Bancaria'});
  await payment('wrong-day',{dateApplied:'2020-01-01'});
  await payment('provisional',{paymentContext:'provisional_rental'});
  assert.equal((await rows())[0].status,'review');
  await payment('match');r=(await rows())[0];assert.equal(r.status,'confirmed');assert.equal(r.confirmed_payment_id,'match');
  await login(seeker);await assert.rejects(db.query('select cancel_route_payment_report($1)',[r.id]),/pendientes/);
  await db.exec("reset role; update payments_cloud set data=jsonb_set(data,'{amountReceived}','20') where id='match'");
  assert.equal((await rows())[0].status,'review');
  await payment('match2');assert.equal((await rows())[0].status,'confirmed');
  await db.exec("delete from payments_cloud where id='match2'");assert.equal((await rows())[0].status,'review');
  await login(seeker);await db.query('select cancel_route_payment_report($1)',[r.id]);assert.equal((await rows())[0].status,'cancelled');
  await report(60,'bank');await payment('bank',{paymentMethod:'ACH Express'});
  assert.equal((await rows()).find(x=>x.status==='confirmed').method,'bank');
  console.log('OK: only new matching applied payments confirm; corrections/deletions reopen; cancellation and bank reports');
  const mixedSql=readFileSync('supabase/70-route-mixed-payment-reports.sql','utf8');
  assert.equal(mixedSql,readFileSync('supabase/migrations/20260904000200_route_mixed_payment_reports.sql','utf8'));
  await db.exec(mixedSql);await db.exec(mixedSql);
  const bankReport=(await rows()).find(x=>x.status==='confirmed');
  assert.equal(Number(bankReport.bank_amount),60);assert.equal(Number(bankReport.confirmed_bank_amount),60);
  await db.exec("delete from payments_cloud where id='bank'");
  await login(seeker);await db.query('select cancel_route_payment_report($1)',[bankReport.id]);
  const split=(cash,bank,o=owner)=>db.query('select report_route_payment_split($1,$2,$3,$4,$5)',[o,'c1',pub,cash,bank]);
  for(const values of [[-1,60],[0,0],[1.001,60],[null,60],['NaN',60],[40,'Infinity']]) await assert.rejects(split(...values),/importes/);
  await assert.rejects(split(40,60,other),/permiso/);
  await assert.rejects(db.exec("select refresh_route_report_confirmation('00000000-0000-4000-8000-000000000000')"),/permission denied/);
  await assert.rejects(db.exec('select * from route_report_payment_links'),/permission denied/);
  await split(40,60);
  let mixed=(await rows()).find(x=>x.status==='review');
  assert.equal(mixed.method,'mixed');assert.equal(Number(mixed.amount),100);
  await payment('mixed-wrong-total',{amountReceived:100});
  await payment('mixed-old-bank',{amountReceived:60,paymentMethod:'ACH Express',createdAt:'2020-01-01T00:00:00Z'});
  assert.equal((await rows()).find(x=>x.id===mixed.id).status,'review');
  await payment('mixed-cash',{amountReceived:40});
  mixed=(await rows()).find(x=>x.id===mixed.id);
  assert.equal(mixed.status,'review');assert.equal(Number(mixed.confirmed_cash_amount),40);assert.equal(Number(mixed.confirmed_bank_amount),0);
  await payment('mixed-duplicate-cash',{amountReceived:40});
  assert.equal((await db.query('select count(*)::int as n from route_report_payment_links where report_id=$1',[mixed.id])).rows[0].n,1);
  await payment('mixed-bank',{amountReceived:60,paymentMethod:'Transferencia Bancaria'});
  mixed=(await rows()).find(x=>x.id===mixed.id);assert.equal(mixed.status,'confirmed');assert.equal(Number(mixed.confirmed_bank_amount),60);
  await db.exec("delete from payments_cloud where id='mixed-cash'");
  mixed=(await rows()).find(x=>x.id===mixed.id);assert.equal(mixed.status,'review');assert.equal(Number(mixed.confirmed_cash_amount),0);assert.equal(Number(mixed.confirmed_bank_amount),60);
  await payment('mixed-cash-replacement',{amountReceived:40});
  assert.equal((await rows()).find(x=>x.id===mixed.id).status,'confirmed');
  await db.exec("update payments_cloud set data=jsonb_set(data,'{amountReceived}','55') where id='mixed-bank'");
  mixed=(await rows()).find(x=>x.id===mixed.id);assert.equal(mixed.status,'review');assert.equal(Number(mixed.confirmed_bank_amount),0);
  console.log('OK: upgrade keeps existing confirmations; split validation; both parts required; duplicate/old payments ignored; deleting or correcting one part reopens report');

  await db.exec('reset role; alter table active_route_items_cloud add column updated_at timestamptz;');
  const routeSql=readFileSync('supabase/71-route-assignment-change.sql','utf8');
  assert.equal(routeSql,readFileSync('supabase/migrations/20260904000300_route_assignment_change.sql','utf8'));
  await db.exec(routeSql);await db.exec(routeSql);
  await db.query("update active_route_items_cloud set data=$1 where client_id='c1'",[JSON.stringify({clientId:'c1',publishedAt:pub,routeAssignment:'PTY',releaseAmount:60,zone:'Centro'})]);
  const change=(route='WC',previous='PTY',o=owner,p=pub)=>db.query('select change_active_route_assignment($1,$2,$3,$4,$5)',[o,'c1',p,previous,route]);
  await login(seeker);await change();
  await assert.rejects(change(),/cambió/);
  await assert.rejects(change('invalid','WC'),/Solo puedes/);
  await assert.rejects(change(null,'WC'),/Solo puedes/);
  await assert.rejects(change('PTY','WC',other),/permiso/);
  await assert.rejects(change('PTY','WC',owner,'old'),/cambió/);
  await db.exec('reset role');
  const changed=(await db.query("select data from active_route_items_cloud where client_id='c1'")).rows[0].data;
  assert.equal(changed.routeAssignment,'WC');assert.equal(changed.releaseAmount,60);assert.equal(changed.zone,'Centro');assert.equal(changed.routeChangedBy,seeker);
  for(const state of ["is_active=false","is_active=true,view_route=false","view_route=true,role='lectura'"]){
    await db.exec('reset role');await db.exec("update user_profiles set "+state+" where id='"+seeker+"'");
    await login(seeker);await assert.rejects(change('PTY','WC'),/permiso/);
  }
  await db.exec('reset role');await db.exec("update user_profiles set role='buscador' where id='"+seeker+"'");
  await login(seeker);await change('PTY','WC');
  await db.exec('reset role');await db.exec("update active_route_items_cloud set data=jsonb_set(data,'{removedAt}',to_jsonb('removed'::text))");
  await login(seeker);await assert.rejects(change(),/cambió/);
  console.log('OK: route switch permits active seeker only, validates owner and WC/PTY, rejects stale/removed routes, preserves other data and records author');
} finally { await db.close(); }
