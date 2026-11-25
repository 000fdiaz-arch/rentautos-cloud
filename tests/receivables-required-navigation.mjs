import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import {build} from 'esbuild';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
async function load(path){const module={exports:{}};const out=await build({entryPoints:[path],bundle:true,platform:'node',format:'cjs',write:false,define:{'import.meta.env':'{}'}});vm.runInNewContext(out.outputFiles[0].text,{module,exports:module.exports,require,Date,Intl});return module.exports;}
const access=await load('src/receivablesV2CollectorAccess.ts');
assert.equal(access.receivablesCollectorForUnit('C01'),'collector-1');assert.equal(access.receivablesCollectorForUnit(' d12 '),'collector-2');for(const unit of ['A01','B10','E04','T02'])assert.equal(access.receivablesCollectorForUnit(unit),null);
const {alreadyManagedToday}=await load('src/pages/receivablesV2/paymentReview.ts');const {needsOperationalReview}=await load('src/pages/receivablesV2/operationalReview.ts');
const source=fs.readFileSync('src/pages/receivablesV2/ReceivablesLedgerTable.tsx','utf8');const block=source.slice(source.indexOf('  const reviewedRow ='),source.indexOf('  const stableOnSelectDetail'))+'\nnavigationBlocked;';
const row={id:'C01',operationalStatus:'activo'};const context={rows:[row],visibleRow:row,hotClientId:null,operationalPending:false,isUnitStatusConfirmed:()=>false,retryIds:null,collectionStatusByClient:{},collectorKey:'collector-1',now:new Date('2026-11-25T17:00:00Z'),alreadyManagedToday,needsOperationalReview};
const blocked=extra=>vm.runInNewContext(block,{...context,...extra});
assert.equal(blocked({}),true);
assert.equal(blocked({collectionStatusByClient:{C01:{paymentPromiseDate:'2026-11-26',paymentPromiseTime:'18:00',paymentPromiseAmount:20}}}),true);
for(const result of ['promise','no_answer','paid_up','reminder_today','reminder_tomorrow']){
 const records={C01:{contactOutcomes:[{collector:'collector-1',date:'2026-11-25',at:'2026-11-25T16:00:00Z',result}]}};
 assert.equal(blocked({collectionStatusByClient:records}),false);
 assert.equal(blocked({collectionStatusByClient:records,retryIds:['C01']}),true);
}
const inactive={...row,operationalStatus:'taller'};
assert.equal(blocked({visibleRow:inactive}),true);assert.equal(blocked({visibleRow:inactive,isUnitStatusConfirmed:()=>true}),false);
assert.match(source,/if \(navigationBlocked \|\| outcomeSaving\) return;/);
console.log('PASS C/D scope; drafts cannot unlock Next; saved outcomes unlock; retries need new save; operational validation required.');
