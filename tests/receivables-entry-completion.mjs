import fs from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import ts from 'typescript';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
const compiled = await build({entryPoints:['src/pages/receivablesV2/FirstContactSummary.tsx'],bundle:true,platform:'node',format:'cjs',write:false,packages:'external',jsx:'automatic',loader:{'.css':'empty'}});
const module = {exports:{}};
vm.runInNewContext(compiled.outputFiles[0].text,{module,exports:module.exports,require:createRequire(import.meta.url),Date,Intl});
const summary = module.exports.firstContactSummary;
const source = fs.readFileSync('src/pages/receivablesV2/ReceivablesLedgerTable.tsx','utf8');
const tree = ts.createSourceFile('ledger.tsx',source,99,true);
const names = ['retryIds','explicitlyFinished','firstRoundComplete','roundFinished'];
const statements=[];
function walk(node){if(ts.isVariableStatement(node) && node.declarationList.declarations.some(d=>names.some(name=>d.name.getText(tree)===name || d.name.getText(tree).startsWith('['+name+','))))statements.push(node.getText(tree));ts.forEachChild(node,walk);}
walk(tree);
function enter(rows,managed){return vm.runInNewContext(ts.transpile(statements.join('\n'),{target:9})+';({retryIds,roundFinished})',{
 rows,firstContactManagedIds:managed,reviewedFollowupIds:[],collectionStatusByClient:{},collectorKey:'collector-1',todayDateKey:'2026-11-25',portfolioFollowupToday:()=>null,useState:value=>[value,()=>{}],
 // A previous browser session had already entered automatic retries.
 initialProgress:{retryIds:rows.map(r=>r.id)},
 useWorkdayValue:()=>{throw Error('Must not restore legacy automatic retry state');}
});}
for(const [collector,unit] of [['collector-1','C37'],['collector-2','D04']]){
 const rows=[{id:unit,unitId:unit,operationalStatus:'libre'}];
 const records=collector==='collector-2'?{D04:{contactOutcomes:[{collector,date:'2026-11-25',at:'2026-11-25T15:57:00Z',result:'no_answer',note:'Conservar comentario'}]}}:{};
 const reviews=collector==='collector-1'?{C37:{collector,status:'libre',reviewed_at:'2026-11-25T16:13:15Z',fleet_updated_at:'2026-11-14T22:53:23Z'}}:{};
 const input={rows,records,reviews,collector,today:'2026-11-25'};
 const original=JSON.stringify(input);
 const managed=new Set(summary(input).entries.filter(e=>e.category!=='pending').map(e=>e.row.id));
 for(let reload=0;reload<2;reload++){
  const state=enter(rows,managed);assert.equal(state.roundFinished,true);assert.equal(state.retryIds,null);
 }
 assert.equal(JSON.stringify(input),original,'Opening or reloading cannot alter history');
 assert.equal(enter(rows,new Set()).roundFinished,false,'Unmanaged first contacts must remain pending');
 assert.equal(summary({...input,today:'2026-11-26'}).entries[0].category,'pending','Completion belongs to its business date');
 if(records.D04){records.D04.contactOutcomes.push({collector,date:'2026-11-25',at:'2026-11-25T20:00:00Z',result:'promise',promiseAmount:20});assert.equal(summary(input).entries[0].category,'no_answer','Second contact preserves first contact');assert.equal(records.D04.contactOutcomes.length,2);}
}
console.log('PASS completed collectors enter summary on reload, legacy retries ignored, history preserved, pending/day isolation, second contact retains first result');
