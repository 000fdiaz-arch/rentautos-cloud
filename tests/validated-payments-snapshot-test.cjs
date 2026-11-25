const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),vm=require('node:vm');
const {webcrypto,createHash}=require('node:crypto');
const source=ts.transpileModule(fs.readFileSync('src/cloud/validatedPaymentsSnapshot.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const checksum=payload=>createHash('sha256').update(payload).digest('hex');
function fixture(options={}){
 const cache=options.cache??new Map(),calls=[],writes=[],state={recent:[],pending:[],...options},exports={};
 vm.runInNewContext(source,{exports,crypto:options.noCrypto?undefined:webcrypto,TextEncoder,Uint8Array,require(name){
  if(name.endsWith('indexedDbStorage'))return{readIndexedDb:async key=>{if(state.storageError)throw Error('storage');return cache.get(key);},writeIndexedDb:async(key,value)=>{if(state.storageError)throw Error('storage');cache.set(key,structuredClone(value));writes.push(key);}};
  if(name.endsWith('/supabase'))return{supabaseUrl:options.project??'https://payments.test'};
  if(name.endsWith('cloudClient'))return{getCloudClient:()=>({rpc:async(name,args)=>{
   assert.equal(name,'read_initial_payments_snapshot');calls.push(args);if(state.error)return{error:state.error,data:null};
   const payload=JSON.stringify({recent:state.recent,pending:state.pending}),fingerprint=checksum(payload),unchanged=args.p_fingerprint===fingerprint;
   return{error:null,data:state.bad??{version:1,owner:args.p_user_id,through_date:args.p_through_date,limit:args.p_limit,recent_count:state.recent.length,pending_count:state.pending.length,fingerprint,not_modified:unchanged,payload:unchanged?null:payload}};
  }})};throw Error(name);
 }});
 return{load:(owner='OWNER',date='2026-11-25',limit=300)=>exports.loadValidatedInitialPayments(owner,date,limit),state,cache,calls,writes};
}
(async()=>{
 const recent=Array.from({length:300},(_,i)=>({id:`p${i}`,amount:i+.25,nested:{history:['ñ',i]}})),pending=Array.from({length:1501},(_,i)=>({id:`old-${i}`,amount:i+1,moneyDelivered:false,dateApplied:'2025-01-01'}));
 const f=fixture({recent,pending});
 assert.deepEqual(JSON.parse(JSON.stringify(await f.load())),{recent,pending});assert.equal(f.calls[0].p_fingerprint,null);
 await f.load();assert.ok(f.calls[1].p_fingerprint);assert.equal(f.writes.length,1);
 f.state.pending=pending.slice(1);f.state.recent=[{...recent[0],amount:999},...recent.slice(1)];
 assert.deepEqual(JSON.parse(JSON.stringify(await f.load())),{recent:f.state.recent,pending:f.state.pending});
 await f.load('OWNER','2026-11-26');assert.equal(f.calls.at(-1).p_fingerprint,null,'date change must revalidate scope');
 await f.load('OWNER','2026-11-26',400);assert.equal(f.calls.at(-1).p_fingerprint,null,'limit change must revalidate scope');
 const cached=[...f.cache.values()][0];cached.payload='{}';await f.load();assert.equal(f.calls.at(-1).p_fingerprint,null,'corrupt data must be ignored');
 for(const code of['08006','42501','P0001']){f.state.error={code};await assert.rejects(f.load(),e=>e.code===code);}
 for(const code of['PGRST202','42883']){f.state.error={code};assert.equal(await f.load(),null);}
 f.state.error=null;f.state.recent=[];f.state.pending=[];assert.deepEqual(JSON.parse(JSON.stringify(await f.load())),{recent:[],pending:[]});
 await f.load('OTHER');assert.equal(f.calls.at(-1).p_fingerprint,null);
 const other=fixture({cache:f.cache,project:'https://other.test'});await other.load();assert.equal(other.calls[0].p_fingerprint,null);
 const payload=JSON.stringify({recent,pending}),valid={version:1,owner:'owner',through_date:'2026-11-25',limit:300,recent_count:300,pending_count:1501,fingerprint:checksum(payload),not_modified:false,payload};
 for(const override of[{owner:'other'},{through_date:'2026-11-24'},{limit:301},{fingerprint:'0'.repeat(64)},{recent_count:0},{pending_count:0},{payload:null},{not_modified:true}]){
  const bad=fixture({bad:{...valid,...override}});await assert.rejects(bad.load());assert.equal(bad.writes.length,0);
 }
 assert.equal((await fixture({recent,pending,storageError:true}).load()).pending.length,1501);
 const noCrypto=fixture({noCrypto:true});assert.equal(await noCrypto.load(),null);assert.equal(noCrypto.calls.length,0);
 console.log('PASS initial payments: complete 300 recent and 1501 older pending, fresh validation, updates/deletions, date/limit/owner/project isolation, corruption, fail-closed errors and storage/legacy fallback.');
})().catch(e=>{console.error(e);process.exitCode=1;});
