import fs from 'node:fs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const env = {};
for (const file of ['.env','.env.local']) {
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file,'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if(m) env[m[1]]=m[2].trim().replace(/^["']|["']$/g,'');
  }
}
assert.equal(new URL(env.VITE_SUPABASE_URL).hostname.split('.')[0], JSON.parse(fs.readFileSync('supabase/.temp/linked-project.json','utf8')).ref, 'Test targets the same database as the migration');
const options={auth:{persistSession:false,autoRefreshToken:false}};
const admin=createClient(env.VITE_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,options);
const operator=createClient(env.VITE_SUPABASE_URL,env.VITE_SUPABASE_ANON_KEY,options);
let owner, actor;
async function checked(result){if(result.error)throw result.error;return result.data;}
try {
  const password=randomUUID()+'aA9!';
  const email='status-test-'+randomUUID()+'@auth.rentautos.local';
  owner=(await checked(await admin.auth.admin.createUser({email:'owner-'+email,password,email_confirm:true}))).user.id;
  actor=(await checked(await admin.auth.admin.createUser({email,password,email_confirm:true}))).user.id;
  await checked(await admin.from('user_profiles').upsert([
    {id:owner,email:'owner-'+email,role:'admin',is_active:true,data_owner_user_id:owner,permissions:{}},
    {id:actor,email,role:'operador',is_active:true,data_owner_user_id:owner,permissions:{receivables:{view:true,edit:true},control_units:{view:false,edit:false}}}
  ]));
  await checked(await operator.auth.signInWithPassword({email,password}));
  await checked(await admin.from('fleet_units_cloud').insert({user_id:owner,unit_id:'A01',operational_status:'taller'}));
  await checked(await admin.from('clients_cloud').insert({user_id:owner,id:'isolated-client',data:{id:'isolated-client',unitId:'A01',name:'Prueba aislada',status:'taller'}}));
  const compiled=await build({entryPoints:['src/pages/receivables/operationalReview.ts'],bundle:true,platform:'node',format:'cjs',write:false,
    plugins:[{name:'auth-client',setup(b){b.onResolve({filter:/lib\/supabase$/},()=>({path:'test-client',external:true}));}}]});
  const module={exports:{}};const require=createRequire(import.meta.url);
  const clientBinding={supabase:operator};
  vm.runInNewContext(compiled.outputFiles[0].text,{module,exports:module.exports,require:name=>name==='test-client'?clientBinding:require(name),Date,Intl,console});
  const {saveOperationalReview,needsOperationalReview,operationalReviewConfirmed}=module.exports;
  let saved=await saveOperationalReview(owner,'A01','taller','taller','collector-1');
  assert.equal(saved.review.reviewed_by,actor);
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Panama',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  assert.equal(operationalReviewConfirmed(saved.review,'taller','collector-1',today),true);
  assert.equal(operationalReviewConfirmed(saved.review,'taller','collector-2',today),false);
  assert.equal(operationalReviewConfirmed(saved.review,'custodia','collector-1',today),false);
  assert.equal(operationalReviewConfirmed(saved.review,'taller','collector-1','2000-01-01'),false);
  for(const status of ['libre','taller','chapisteria','custodia','archivado','provisional_rental','otro']) assert.equal(needsOperationalReview(status),true);
  assert.equal(needsOperationalReview('activo'),false);
  for(const next of ['chapisteria','custodia','activo']) {
    const expected=saved.review.status;
    saved=await saveOperationalReview(owner,'A01',expected,next,'collector-1');
    const fleet=await checked(await operator.from('vw_control_unidades').select('operational_status').eq('user_id',owner).eq('unit_id','A01').single());
    assert.equal(fleet.operational_status,next);
  }
  await assert.rejects(()=>saveOperationalReview(owner,'A01','custodia','taller','collector-1')); // stale screen
  await assert.rejects(()=>saveOperationalReview(owner,'A01','activo','taller','collector-1')); // active cannot use this RPC
  await checked(await admin.from('clients_cloud').update({data:{id:'isolated-client',unitId:'A01',status:'taller'}}).eq('user_id',owner));
  await checked(await admin.from('fleet_units_cloud').update({operational_status:'taller'}).eq('user_id',owner));
  await assert.rejects(()=>saveOperationalReview(owner,'A01','taller','inventado','collector-1'));
  await assert.rejects(()=>saveOperationalReview(owner,'A01','taller','custodia','collector-2'));
  // A failed confirmation read must reject even after a successful transaction.
  clientBinding.supabase={rpc:operator.rpc.bind(operator),from(){return {select(){return this},eq(){return this},single:async()=>({error:new Error('Simulated confirmation failure')})}}};
  await assert.rejects(()=>saveOperationalReview(owner,'A01','taller','custodia','collector-1'),/Simulated/);
  clientBinding.supabase=operator;
  saved=await saveOperationalReview(owner,'A01','custodia','libre','collector-1');
  assert.deepEqual(Array.from(saved.archivedIds),['isolated-client']);
  const archived=await checked(await admin.from('clients_cloud').select('data').eq('user_id',owner).single());
  assert.equal(archived.data.status,'archivado');
  assert.ok(archived.data.archivedAt);
  await checked(await admin.from('fleet_units_cloud').insert({user_id:owner,unit_id:'B01',operational_status:'provisional_rental'}));
  saved=await saveOperationalReview(owner,'B01','provisional_rental','provisional_rental','collector-2');
  assert.equal(saved.review.collector,'collector-2');
  for(const status of ['taller','chapisteria','custodia','libre','archivado']) {
    saved=await saveOperationalReview(owner,'B01',saved.review.status,status,'collector-2');
    const same=await saveOperationalReview(owner,'B01',status,status,'collector-2');
    assert.equal(same.review.status,status);
    assert.equal(operationalReviewConfirmed(same.review,status,'collector-2',today,'2000-01-01'),false);
  }
  // Read-only user and cross-owner access are denied by the database.
  await assert.rejects(()=>saveOperationalReview(actor,'A01','libre','taller','collector-1'));
  await checked(await admin.from('user_profiles').update({permissions:{receivables:{view:true,edit:false}}}).eq('id',actor));
  await assert.rejects(()=>saveOperationalReview(owner,'A01','libre','taller','collector-1'));
  console.log('PASS: real database, collector-only permissions, confirmation read, states, audit, stale state, invalid state, ownership, read-only, archive semantics.');
} finally {
  if(owner){
    for(const table of ['receivables_operational_reviews','clients_cloud','fleet_units_cloud']) await checked(await admin.from(table).delete().eq('user_id',owner));
  }
  for(const id of [actor,owner].filter(Boolean)){
    await checked(await admin.from('user_profiles').delete().eq('id',id));
    await checked(await admin.auth.admin.deleteUser(id));
  }
  console.log('Isolated test data cleaned up.');
}
