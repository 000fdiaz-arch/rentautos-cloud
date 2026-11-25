import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import ts from 'typescript';

// Production rules and navigation, with in-memory records only. No real DB connection.
const compiled=await build({stdin:{contents:'export * from "./src/pages/receivablesV2/promiseFollowup"; export * from "./src/pages/receivablesV2/paymentReview"; export {parseCollectionStatusMapFromStorage} from "./src/pages/receivablesV2/receivablesPageRules";',resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'cjs',write:false,external:['react'],define:{'import.meta.env.DEV':'false'}});
const module={exports:{}};
vm.runInNewContext(compiled.outputFiles[0].text,{module,exports:module.exports,require:createRequire(import.meta.url),Date,Intl,console});
const {promiseFollowup,closedForToday,parseCollectionStatusMapFromStorage}=module.exports;
const now=new Date('2026-11-19T13:00:00Z'); // 08:00 Panama, following workday
const attempt={date:'2026-11-18',at:'2026-11-18T14:00:00Z',collector:'collector-1',result:'promise',promiseDate:'2026-11-18',promiseTime:'10:00',promiseAmount:100};
const base={status:'pending',comment:'',contactOutcomes:[attempt]};
const receipt=(id,amount,at='2026-11-18T16:00:00Z')=>({id,amountReceived:amount,createdAt:at});
for(const collector of ['collector-1','collector-2']){
  const record={...base,contactOutcomes:[{...attempt,collector}]};
  for(const [payments,remaining,overdue] of [
    [[],100,true],
    [[receipt('partial',40)],60,true],
    [[receipt('partial',40),receipt('partial',40)],60,true],
    [[receipt('full',100)],0,false],
    [[receipt('overpaid',120)],0,false],
    [[receipt('p1',40),receipt('p2',60,'2026-11-19T05:01:00Z')],0,false],
    [[receipt('before-agreement',100,'2026-11-18T13:59:59Z')],100,true],
    [[receipt('future',100,'2026-11-19T14:00:00Z')],100,true]
  ]){
    const actual=promiseFollowup(record,collector,payments,now);
    assert.equal(actual.remaining,remaining);assert.equal(actual.overdue,overdue);
  }
  assert.equal(promiseFollowup(record,collector==='collector-1'?'collector-2':'collector-1',[],now),null);
  const closed={...record,contactOutcomes:[...record.contactOutcomes,{...attempt,collector,result:'closed_today',at:'2026-11-18T18:00:00Z'}]};
  assert.equal(closedForToday(closed,collector,'2026-11-19'),false);
  assert.equal(promiseFollowup(closed,collector,[],now).overdue,true);
  const scheduled={...record,contactOutcomes:[...record.contactOutcomes,{...attempt,collector,result:'no_answer',at:'2026-11-18T18:00:00Z',followupOf:attempt.at,nextContactAt:'2026-11-19T09:00:00-05:00'}]};
  assert.equal(promiseFollowup(scheduled,collector,[],now).overdue,false);
  assert.equal(promiseFollowup(scheduled,collector,[],new Date('2026-11-19T14:00:00Z')).overdue,true);
  const renewed={...record,contactOutcomes:[...record.contactOutcomes,{...attempt,collector,date:'2026-11-19',at:'2026-11-19T12:30:00Z',promiseDate:'2026-11-19',promiseTime:'10:00',promiseAmount:60}]};
  assert.equal(promiseFollowup(renewed,collector,[receipt('partial',40)],now).remaining,60);
  assert.equal(promiseFollowup(renewed,collector,[],now).overdue,false);
}

// Yesterday's unresolved agreement enters the actual follow-up navigation only
// after the current unit is finished; fully paid agreements cannot enter it.
const ledger=fs.readFileSync('src/pages/receivablesV2/ReceivablesLedgerTable.tsx','utf8');
const advance=ledger.slice(ledger.indexOf('  function advanceAfterManagement('),ledger.indexOf('  function renderImportantNote'));
for(const paid of [0,40,100]){
  const followup=promiseFollowup(base,'collector-1',[receipt('payment',paid)],now);
  let hot=null,cursor='A10';
  const context={paymentReviews:[],hotClientId:null,automaticFollowup:false,dueFollowups:followup.overdue?[{row:{id:'A02'},followup}]:[],shownPromises:[],visibleRow:{id:'A10'},nextRowIndex:1,currentRowIndex:0,roundRows:[{id:'A10'},{id:'A11'}],retryIds:null,
    setHotClientId(v){hot=v},setAutomaticFollowup(){},setShownPromises(){},changeSelectedRow(){cursor='A11'}};
  vm.runInNewContext(ts.transpile(advance,{target:9}),context);
  assert.equal(hot,null); // no interruption while editing
  context.advanceAfterManagement();
  assert.equal(hot,paid<100?'A02':null);
  assert.equal(cursor,paid<100?'A10':'A11');
}

// Parsing a long daily history must not truncate or discard older events.
const history=Array.from({length:400},(_,i)=>({...attempt,at:new Date(Date.UTC(2025,0,1+i,15)).toISOString(),date:new Date(Date.UTC(2025,0,1+i)).toISOString().slice(0,10),note:`Daily attempt ${i}`}));
const parsed=parseCollectionStatusMapFromStorage(JSON.stringify({A02:{...base,contactOutcomes:history}})).A02;
assert.equal(parsed.contactOutcomes.length,400);
assert.equal(parsed.contactOutcomes[0].note,'Daily attempt 0');
assert.equal(parsed.contactOutcomes[399].note,'Daily attempt 399');
console.log('PASS overnight promises for both collectors: unpaid/partial return, complete payment suppresses follow-up, receipt deduplication, old/future payment exclusion, next-contact time, renewed agreement, non-interrupting navigation, 400-day history retained. No real DB writes.');

// A06's actual agreement metadata, read-only verified in the real DB. Payment
// variations below are isolated fixtures and never sent to the database.
const a06={...base,contactOutcomes:[{date:'2026-11-19',at:'2026-11-19T14:57:50.444Z',collector:'collector-1',result:'promise',promiseDate:'2026-11-19',promiseTime:'20:00',promiseAmount:31,paymentReviewKey:'reviewed-morning-payment'}]};
const morning=receipt('morning',31.06,'2026-11-19T14:42:23.594Z');
const before=new Date('2026-11-20T00:59:59Z');
const due=new Date('2026-11-20T01:00:00Z');
for(const [paid,remaining] of [[0,31],[10,21],[30.99,0.01],[31,0],[40,0]]){
  const afterAgreement=receipt('evening',paid,'2026-11-20T00:30:00Z');
  const payments=[morning,afterAgreement,afterAgreement];
  assert.equal(promiseFollowup(a06,'collector-1',payments,before).overdue,false,'Never alert before 20:00 Panama');
  const followup=promiseFollowup(a06,'collector-1',payments,due);
  assert.equal(followup.remaining,remaining);
  assert.equal(followup.overdue,remaining>0);
  let active=null,cursor='A10';
  const ctx={paymentReviews:[],hotClientId:null,automaticFollowup:false,dueFollowups:followup.overdue?[{row:{id:'A06'},followup}]:[],shownPromises:[],visibleRow:{id:'A10'},nextRowIndex:1,currentRowIndex:0,roundRows:[{id:'A10'},{id:'A11'}],retryIds:null,
    setHotClientId(v){active=v},setAutomaticFollowup(){},setShownPromises(){},changeSelectedRow(){cursor='A11'}};
  vm.runInNewContext(ts.transpile(advance,{target:9}),ctx);
  assert.equal(active,null,'Clock reaching 20:00 does not switch the current unit');
  assert.equal(cursor,'A10');
  ctx.advanceAfterManagement();
  assert.equal(active,remaining>0?'A06':null,'A06 is picked only when current management finishes and money remains');
  assert.equal(cursor,remaining>0?'A10':'A11','Follow-up preserves portfolio resume point');
}
console.log('PASS A06 $31 at 20:00 Panama: 19:59:59 suppressed; unpaid/partial/one cent pending queued; full/overpayment suppressed; morning receipt excluded; duplicate receipts counted once; current unit uninterrupted.');
