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
const agreement={contactOutcomes:[{collector:'collector-1',date:'2026-11-19',at:'2026-11-19T15:04:38.625Z',result:'promise',promiseDate:'2026-11-22',promiseTime:'06:00',promiseAmount:180}]};
const a30={contactOutcomes:[{collector:'collector-1',date:'2026-11-21',at:'2026-11-21T19:29:25.470Z',result:'no_answer'}]};
const original=JSON.stringify({agreement,a30});
for(const [time,due] of [['2026-11-21T23:59:59-05:00',false],['2026-11-22T05:59:59-05:00',false],['2026-11-22T06:00:00-05:00',true]]) {
 const now=new Date(time),day=time.slice(0,10);
 assert.equal(api.hasReviewedPaymentPromise(agreement,'collector-1',day),true);
 assert.equal(api.promiseFollowup(agreement,'collector-1',[],now).overdue,due);
}
const full=[{id:'full',amountReceived:180,createdAt:'2026-11-22T10:30:00Z'}];
assert.equal(api.promiseFollowup(agreement,'collector-1',full,new Date('2026-11-22T11:00:00Z')).overdue,false);
assert.equal(api.promiseFollowup(agreement,'collector-1',[{...full[0],amountReceived:100}],new Date('2026-11-22T11:00:00Z')).remaining,80);
const ledger=fs.readFileSync('src/pages/receivablesV2/ReceivablesLedgerTable.tsx','utf8');
const predicate=ts.transpile('(row=>{'+ledger.match(/const eligibleRows = openRows\.filter\(row => \{([\s\S]*?)\n  \}\);/)[1]+'})',{target:9});
const context={...api,collectionStatusByClient:{A02:agreement,A30:a30},collectorKey:'collector-1',todayDateKey:'2026-11-21',now:new Date('2026-11-21T20:26:00Z'),retryIds:null,isUnitStatusConfirmed:()=>false};
const rows=[{id:'A02'},{id:'A30'},{id:'A31'},{id:'A32'}];
const remaining=rows.filter(vm.runInNewContext(predicate,context));
assert.deepEqual(remaining,[{id:'A31'},{id:'A32'}]);
// Remount the actual React storage hook, as on page reload, using isolated memory storage.
const React=createRequire(import.meta.url)('react');
const {renderToString}=createRequire(import.meta.url)('react-dom/server');
const data=new Map();
const storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};
const hookModule={exports:{}};
vm.runInNewContext(bundle.outputFiles[0].text,{module:hookModule,exports:hookModule.exports,require:createRequire(import.meta.url),Date,Intl,localStorage:storage});
function mount(key,initial){let value;function Probe(){value=hookModule.exports.useWorkdayValue(key,initial);return null;}renderToString(React.createElement(Probe));return value;}
const scope='cxc.v2.workday.v1:test-owner:collector-1:2026-11-21';
mount(scope+':unit',null)[1]('A31');
mount(scope+':draft:A31:amount','')[1]('75');
const restored=mount(scope+':unit',null)[0];
assert.equal(restored,'A31');
assert.equal(remaining[api.restoredRoundIndex(remaining,rows,restored)].id,'A31');
assert.equal(mount(scope+':draft:A31:amount','')[0],'75');
assert.equal(api.alreadyManagedToday(a30,'collector-1',context.now),true);
assert.equal(JSON.stringify({agreement,a30}),original);
console.log('PASS actual hook remount retains unit/draft; A02 waits until 22 Nov 6 AM Panama; full/partial payments checked; today history retained and managed units excluded. Isolated storage only.');
