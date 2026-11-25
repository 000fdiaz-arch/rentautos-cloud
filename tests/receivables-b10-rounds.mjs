import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import ts from 'typescript';
const bundle=await build({stdin:{contents:'export * from "./src/pages/receivablesV2/paymentReview"; export * from "./src/pages/receivablesV2/promiseFollowup"; export * from "./src/pages/receivablesV2/workdayProgress";',resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',write:false,external:['react']});
const module={exports:{}};
vm.runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,require:createRequire(import.meta.url),Date,Intl});
const api=module.exports;
const first={at:'2026-11-20T14:54:33.921Z',collector:'collector-2',date:'2026-11-20',result:'promise',promiseDate:'2026-11-20',promiseTime:'14:00',promiseAmount:68};
const record={contactOutcomes:[first,...['19:12:22.256','20:03:02.076','21:03:14.453'].map((at,i)=>({at:`2026-11-20T${at}Z`,collector:'collector-2',date:'2026-11-20',result:'no_answer',followupOf:first.at,nextContactAt:`2026-11-20T${15+i}:00:00-05:00`}))]};
const history=JSON.stringify(record);
const ledger=fs.readFileSync('src/pages/receivablesV2/ReceivablesLedgerTable.tsx','utf8');
const predicate=ts.transpile('(row=>{'+ledger.match(/const eligibleRows = openRows\.filter\(row => \{([\s\S]*?)\n  \}\);/)[1]+'})',{target:9});
for(const hour of [22,23]){
 const now=new Date(`2026-11-20T${hour}:30:00Z`);
 const context={...api,collectionStatusByClient:{B10:record,D01:{}},collectorKey:'collector-2',todayDateKey:'2026-11-20',now,retryIds:null,isUnitStatusConfirmed:()=>false};
 const eligible=vm.runInNewContext(predicate,context);
 assert.equal(eligible({id:'B10'}),false);
 assert.equal(eligible({id:'D01'}),true);
 const progress=api.promiseFollowup(record,'collector-2',[{id:'receipt',amountReceived:25.1,centavosAhorro:.1,createdAt:'2026-11-20T17:28:55.895Z'}],now);
 assert.equal(progress.overdue,false);
 assert.equal(progress.remaining,43);
 assert.equal(api.contactIsDue(record,'collector-2','2026-11-20',now),true);
 context.retryIds=['B10'];
 assert.equal(vm.runInNewContext(predicate,context)({id:'B10'}),true);
}
// Reloading a stale automatic follow-up clears it without touching the portfolio cursor.
const reset=ledger.match(/useEffect\(\(\) => \{\n    if \(!hotClientId \|\| outcomeSaving\) return;([\s\S]*?)\n  \}, \[hotClientId, outcomeSaving, collectionStatusByClient, collectorKey, todayDateKey\]\);/);
assert.ok(reset);
let hot='B10',automatic=true;
vm.runInNewContext('(()=>{'+reset[1]+'})()',{...api,hotClientId:hot,collectionStatusByClient:{B10:record},collectorKey:'collector-2',todayDateKey:'2026-11-20',setHotClientId:v=>hot=v,setAutomaticFollowup:v=>automatic=v});
assert.equal(hot,null);assert.equal(automatic,false);
assert.equal(JSON.stringify(record),history);
console.log('PASS B10: excluded from first round and hourly alerts, available in second round, restored alert cleared, all four history entries and $43 preserved. No database writes.');
