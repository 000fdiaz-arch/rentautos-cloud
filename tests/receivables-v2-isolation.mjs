import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
const read = path => fs.readFileSync(path,'utf8');
// The original rendering/calculation code must match the deployed commit.
const baseline='e4541d2dbaac506a628ded9e69a6449fde0d3061';
const paths=execFileSync('git',['ls-tree','-r','--name-only',baseline,'src/pages/receivables'],{encoding:'utf8'}).trim().split('\n');
for(const path of [...paths,'src/pages/ReceivablesPage.tsx']){
 const expected=execFileSync('git',['show',`${baseline}:${path}`],{encoding:'utf8'});
 const actual=read(path).replace('import "./receivables/productionSnapshot.css";\n','').replaceAll('receivablesLegacy"','receivables"').replaceAll('./RouteSearchLegacyPage"','./RouteSearchPage"');
 assert.equal(actual.replaceAll('\r\n','\n'),expected.replaceAll('\r\n','\n'),path);
}
assert.equal(read('src/receivablesLegacy.ts'),execFileSync('git',['show',`${baseline}:src/receivables.ts`],{encoding:'utf8'}));
const stores=new Map(); const requests=[]; const owner='test-owner';
function table(name){
 let action='read',payload,filters=[];
 const q={select(){return q},eq(k,v){filters.push(r=>r[k]===v);return q},in(k,vs){filters.push(r=>vs.includes(r[k]));return q},neq(k,v){filters.push(r=>r[k]!==v);return q},delete(){action='delete';return q},upsert(rows){action='upsert';payload=Array.isArray(rows)?rows:[rows];return q},
 then(resolve,reject){try{requests.push({name,action});let rows=stores.get(name)??[];const matches=r=>filters.every(fn=>fn(r));if(action==='delete')rows=rows.filter(r=>!matches(r));if(action==='upsert')for(const row of payload){const i=rows.findIndex(r=>r.user_id===row.user_id&&r.client_id===row.client_id);if(i<0)rows.push(structuredClone(row));else rows[i]=structuredClone(row);}stores.set(name,rows);return Promise.resolve({data:structuredClone(rows.filter(matches)),error:null,count:rows.filter(matches).length}).then(resolve,reject)}catch(e){return Promise.reject(e).then(resolve,reject)}}};return q;
}
const db={from:table};const cacheKeys=[];
const bundled=await build({entryPoints:['src/cloud/operationsCloudDataV2.ts'],bundle:true,write:false,define:{'import.meta.env.DEV':'false'},platform:'node',format:'cjs',plugins:[{name:'isolated-db',setup(b){b.onResolve({filter:/cloudClient$/},()=>({path:'client',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const PAGE_SIZE=1000; export const getCloudClient=()=>globalThis.testDb; export const withCloudRetry=f=>f(); export const dedupeLoad=(k,f)=>{globalThis.cacheKeys.push(k);return f()};',loader:'js'}));b.onResolve({filter:/lib\/supabase$/},()=>({path:'supabase',namespace:'supabase-mock'}));b.onLoad({filter:/.*/,namespace:'supabase-mock'},()=>({contents:'export const supabase=null;',loader:'js'}));}}]});
const module={exports:{}};const ctx=vm.createContext({module,exports:module.exports,console,testDb:db,cacheKeys,crypto:globalThis.crypto,TextEncoder,TextDecoder,URL,Date,setTimeout,clearTimeout});vm.runInContext(bundled.outputFiles[0].text,ctx);
const api=module.exports;
const legacy=[{user_id:owner,client_id:'A02',data:{status:'contacted',comment:'Gestión original'}}];stores.set('street_management_items_cloud',structuredClone(legacy));
const first={date:'2026-11-18',collector:'collector-1',result:'no_answer',at:'2026-11-18T14:00:00Z'};
const one={A02:{status:'pending',updatedAt:first.at,contactOutcomes:[first]}};
await api.syncCloudStreetManagementDelta(owner,{},one);
const loaded=await api.loadCloudStreetManagement(owner);assert.equal(loaded.A02.contactOutcomes.length,1);
const second={...first,result:'promise',at:'2026-11-18T16:00:00Z'};
const two={A02:{...one.A02,updatedAt:second.at,contactOutcomes:[second]}};
await api.syncCloudStreetManagementDelta(owner,loaded,two);
assert.equal((await api.loadCloudStreetManagement(owner)).A02.contactOutcomes.length,2);
// A new day's save must append history, including the other collector's records.
const tomorrow={...first,date:'2026-11-19',at:'2026-11-19T14:00:00Z'};
const otherCollector={...tomorrow,collector:'collector-2'};
const beforeMidnight=await api.loadCloudStreetManagement(owner);
await api.syncCloudStreetManagementDelta(owner,beforeMidnight,{
  A02:{...one.A02,updatedAt:tomorrow.at,contactOutcomes:[tomorrow]},
  B01:{status:'pending',updatedAt:otherCollector.at,contactOutcomes:[otherCollector]}
});
const afterMidnight=await api.loadCloudStreetManagement(owner);
assert.equal(afterMidnight.A02.contactOutcomes.length,3);
assert.equal(afterMidnight.A02.contactOutcomes.filter(item=>item.date==='2026-11-18').length,2);
assert.equal(afterMidnight.B01.contactOutcomes[0].collector,'collector-2');
assert.deepEqual(stores.get('street_management_items_cloud'),legacy);
console.log('PASS next-day V2 save retains both prior attempts and separates collector history; original records unchanged (mock database).');
await api.saveCloudStreetManagement(owner,{});
assert.deepEqual(stores.get('street_management_items_cloud'),legacy,'V2 save/clear cannot change legacy');
assert(requests.every(r=>r.name==='cxc_v2_street_management_items_cloud'));
assert(cacheKeys.every(k=>k.startsWith('cxc-v2:')));
const shell=read('src/AppShell.tsx');const block=shell.slice(shell.indexOf('{page === "receivables_v2"'),shell.indexOf('{page === "route_search"'));
assert(!block.includes('setHasPendingChanges(true)'),'V2 must not enqueue legacy cloud mirror');
assert(!block.includes('cobrapp.module3.'));
assert(read('src/pages/receivablesV2/ReceivablesLedgerTable.tsx').includes('cxc.v2.workday.v1:'));
assert(read('src/receivablesV2CollectorAccess.ts').includes('rentautos.receivables-v2.collector-session'));
const sql=read('supabase/migrations/20261118000300_cxc_v2_isolated_management.sql');
for(const match of sql.matchAll(/(?:insert into|update|delete from)\s+public\.([a-z0-9_]+)/gi))assert(match[1].startsWith('cxc_v2_')||['fleet_units_cloud','clients_cloud'].includes(match[1]),`Unexpected write: ${match[1]}`);
assert(!/create or replace function public\.(?!cxc_v2_)/i.test(sql));
console.log('PASS: deployed legacy view preserved; V2 writes/readback, two attempts and clear stay isolated; independent cache/local drafts; no original management SQL writes. No network or real data writes.');
