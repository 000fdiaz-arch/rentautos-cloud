const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const { createHash, webcrypto } = require('node:crypto');
const source = ts.transpileModule(fs.readFileSync('src/cloud/validatedClientsSnapshot.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const hash = text => createHash('sha256').update(text,'utf8').digest('hex');
const response = (owner,rows,fingerprint) => {
  const payload=JSON.stringify(rows), digest=hash(payload), unchanged=fingerprint===digest;
  return {version:1,owner,fingerprint:digest,count:rows.length,not_modified:unchanged,payload:unchanged?null:payload};
};
function fixture(options={}) {
  const cache=options.cache??new Map(),calls=[],writes=[];
  const state={rows:[],...options};
  const exports={};
  vm.runInNewContext(source,{exports,TextEncoder,Uint8Array,crypto:options.noCrypto?undefined:webcrypto,
    require(name){
      if(name.endsWith('indexedDbStorage'))return{
        async readIndexedDb(key){if(state.readFail)throw Error('storage unavailable');return cache.get(key);},
        async writeIndexedDb(key,value){if(state.writeFail)throw Error('storage full');writes.push(key);cache.set(key,structuredClone(value));}
      };
      if(name.endsWith('/supabase'))return{supabaseUrl:options.project??'https://project.example.test'};
      if(name.endsWith('cloudClient'))return{getCloudClient:()=>({async rpc(name,args){
        assert.equal(name,'read_clients_snapshot_if_changed');calls.push(args);
        if(state.error)return{data:null,error:state.error};
        return{data:state.badResponse??response(args.p_user_id,state.rows,args.p_fingerprint),error:null};
      }})};
      throw Error(name);
    }
  });
  return{load:exports.loadValidatedClientsSnapshot,cache,calls,writes,state};
}
const rows=Array.from({length:2501},(_,i)=>({id:String(i).padStart(5,'0'),data:{id:String(i).padStart(5,'0'),balance:i+0.25,nested:{history:[1,2,3]},extra:'ñá'}}));
(async()=>{
  const f=fixture({rows});
  assert.deepEqual(JSON.parse(JSON.stringify(await f.load('OWNER-A'))),rows);
  assert.equal(f.calls[0].p_fingerprint,null);
  assert.equal(f.calls[0].p_user_id,'owner-a');
  assert.deepEqual(JSON.parse(JSON.stringify(await f.load('owner-a'))),rows);
  assert.equal(f.calls[1].p_fingerprint,hash(JSON.stringify(rows)),'every cache reuse must validate against cloud');
  assert.equal(f.writes.length,1,'unchanged reads need no cache rewrite');
  f.state.rows=[...rows,{id:'new',data:{id:'new',balance:77}}];
  assert.equal((await f.load('owner-a')).length,2502);
  f.state.rows=rows.slice(1);
  assert.equal((await f.load('owner-a'))[0].id,'00001','remote deletions must not resurrect');
  const [key,cached]=[...f.cache.entries()][0];
  cached.payload=JSON.stringify([{id:'tampered',data:{id:'tampered',balance:999}}]);
  f.cache.set(key,cached);
  assert.equal((await f.load('owner-a')).length,2500);
  assert.equal(f.calls.at(-1).p_fingerprint,null,'corrupt local data must be ignored');
  f.state.error={code:'08006',message:'network failed'};
  await assert.rejects(f.load('owner-a'),error=>error.code==='08006','network failures must never display stale cached clients');
  f.state.error={code:'42501',message:'RLS denied'};
  await assert.rejects(f.load('owner-a'),error=>error.code==='42501');
  f.state.error={code:'PGRST202',message:'old deployment'};
  assert.equal(await f.load('owner-a'),null,'old deployments use the existing complete paginated reader');
  f.state.error=null;f.state.rows=[];
  assert.equal((await f.load('owner-a')).length,0,'an empty cloud dataset is authoritative');
  assert.equal((await f.load('owner-b')).length,0);
  assert.equal(f.calls.at(-1).p_fingerprint,null,'owners must not share cache entries');
  const other=fixture({rows,cache:f.cache,project:'https://different.example.test'});
  assert.equal((await other.load('owner-a')).length,2501);
  assert.equal(other.calls[0].p_fingerprint,null,'projects must not share cache entries');
  for(const mutation of [s=>({...s,fingerprint:'0'.repeat(64)}),s=>({...s,owner:'other'}),s=>({...s,count:0}),s=>({...s,payload:null}),s=>({...s,not_modified:true,payload:null})]){
    const bad=fixture({badResponse:mutation(response('owner-a',rows,null))});
    await assert.rejects(bad.load('owner-a'));
    assert.equal(bad.writes.length,0,'invalid responses must never commit partial data');
  }
  const unavailable=fixture({rows,readFail:true,writeFail:true});
  assert.equal((await unavailable.load('owner-a')).length,2501,'local persistence failure must not prevent a valid cloud read');
  const noCrypto=fixture({noCrypto:true});
  assert.equal(await noCrypto.load('owner-a'),null);
  assert.equal(noCrypto.calls.length,0);
  console.log('PASS validated clients: complete 2501-row payload, fresh server validation on reuse, updates/deletions, checksum/owner/project isolation, fail-closed network and permission errors, corruption and storage/legacy fallback.');
})().catch(error=>{console.error(error);process.exitCode=1;});
