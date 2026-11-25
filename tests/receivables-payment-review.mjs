import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import fs from 'node:fs';
import ts from 'typescript';
const compiled=await build({stdin:{contents:'export * from "./src/pages/receivablesV2/paymentReview"; export {parseCollectionStatusMapFromStorage} from "./src/pages/receivablesV2/receivablesPageRules";',resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'cjs',write:false,external:['react'],define:{'import.meta.env.DEV':'false'}});
const module={exports:{}};vm.runInNewContext(compiled.outputFiles[0].text,{module,exports:module.exports,require:createRequire(import.meta.url),Date,Intl,console});
const {alreadyManagedToday,collectionPaymentReview,paymentReview,closedForToday,hasReviewedPaymentPromise,parseCollectionStatusMapFromStorage}=module.exports;
const now=new Date('2026-11-18T16:00:00Z');
const promise={date:'2026-11-18',at:'2026-11-18T14:00:00Z',collector:'collector-1',result:'promise',promiseDate:'2026-11-18',promiseTime:'12:00',promiseAmount:100};
const record={status:'pending',comment:'',contactOutcomes:[promise]};
const payment={id:'p1',clientId:'A02',amountReceived:40,createdAt:'2026-11-18T15:00:00Z'};
let review=paymentReview(record,'collector-1',[payment,payment],now);
assert.equal(review.total,40);assert.equal(review.agreement.remaining,60);
assert.equal(paymentReview(record,'collector-1',[{...payment,amountReceived:0}],now),null);
assert.equal(paymentReview(record,'collector-1',[{...payment,createdAt:'2026-11-19T15:00:00Z'}],now),null);
assert.equal(paymentReview(record,'collector-1',[{...payment,createdAt:'2026-11-17T15:00:00Z'}],now),null);
assert.ok(paymentReview(record,'collector-1',[{...payment,amountReceived:100}],now),'Full payment still requires decision');
const closed={...record,contactOutcomes:[promise,{date:'2026-11-18',at:now.toISOString(),collector:'collector-1',result:'closed_today',paymentReviewKey:review.key}]};
const parsed=parseCollectionStatusMapFromStorage(JSON.stringify({A02:closed})).A02;
assert.equal(parsed.contactOutcomes.length,2);assert.equal(parsed.contactOutcomes[1].paymentReviewKey,review.key);
assert.equal(paymentReview(parsed,'collector-1',[payment],now),null);
assert.equal(closedForToday(parsed,'collector-1','2026-11-19'),false);
assert.equal(closedForToday(parsed,'collector-2','2026-11-18'),false);
const renewed={...record,contactOutcomes:[promise,{...promise,at:now.toISOString(),promiseAmount:25,paymentReviewKey:review.key}]};
assert.equal(paymentReview(renewed,'collector-1',[payment],now),null);
assert.ok(paymentReview(renewed,'collector-1',[payment,{...payment,id:'p2',createdAt:'2026-11-18T16:01:00Z'}],new Date('2026-11-18T16:02:00Z')));
assert.ok(paymentReview(renewed,'collector-1',[{...payment,amountReceived:45}],now));

// Execute the actual persistence handler with an isolated storage adapter: never contacts the real database.
const source=ts.createSourceFile('page.tsx',fs.readFileSync('src/pages/ReceivablesV2Page.tsx','utf8'),ts.ScriptTarget.Latest,true);
let handler;function visit(node){if(ts.isFunctionDeclaration(node)&&node.name?.text==='handleContactOutcome')handler=node;ts.forEachChild(node,visit);}visit(source);
const context={isCollectionLocked:false,activeCollector:'collector-1',dataOwnerUserId:'test-owner',todayDateKey:'2026-11-18',payments:[payment],latestCollectionStatusByClientRef:{current:{A02:record}},optimisticStatusByClientRef:{current:{}},streetPersistQueueRef:{current:Promise.resolve()},parseCollectionStatusMapFromStorage,paymentReview,
 Date:class extends Date{constructor(...args){super(...(args.length?args:[now.toISOString()]));}static now(){return now.getTime();}},saved:null,published:null,
 setCollectionStatusByClient(fn){context.published=fn({});},
 async syncCloudStreetManagementDelta(owner,old,patch){context.saved=JSON.parse(JSON.stringify(patch.A02));},
 supabase:{from(){return {select(){return this},eq(){return this},async single(){return {data:{data:context.saved},error:null}}}}}
};
vm.runInNewContext(ts.transpile(handler.getText(source),{target:9}),context);
await context.handleContactOutcome('A02','closed_today',{promiseAt:promise.at,paymentReviewKey:review.key});
assert.equal(context.saved.contactOutcomes.length,2);assert.equal(context.published.A02.contactOutcomes[1].result,'closed_today');
context.latestCollectionStatusByClientRef.current={A02:record};
await context.handleContactOutcome('A02','paid_up');
assert.equal(context.saved.contactOutcomes.length,2);assert.equal(context.published.A02.contactOutcomes[1].result,'paid_up');
assert.equal(context.published.A02.contactOutcomes[0].result,'promise');
context.latestCollectionStatusByClientRef.current={A02:record};context.published=null;
await context.handleContactOutcome('A02','promise',{promiseAt:promise.at,paymentReviewKey:review.key,nextDate:'2026-11-18',nextTime:'13:00',amount:25});
assert.equal(context.saved.paymentPromiseAmount,25);assert.equal(context.saved.contactOutcomes[0].promiseAmount,100);
context.latestCollectionStatusByClientRef.current={A02:record};context.published=null;
context.supabase.from=()=>({select(){return this},eq(){return this},async single(){return {data:{data:record},error:null}}});
await assert.rejects(()=>context.handleContactOutcome('A02','closed_today',{promiseAt:promise.at,paymentReviewKey:review.key}));
assert.equal(context.published,null,'Failed readback must not publish success');
const ledger=fs.readFileSync('src/pages/receivablesV2/ReceivablesLedgerTable.tsx','utf8');
// A06 reviewed early with an evening promise must be skipped when the ordinary
// first round later reaches its position. Manual/history access remains available.
const evening={...record,contactOutcomes:[{...promise,promiseTime:'20:00',paymentReviewKey:'receipt-A06'}]};
assert.equal(hasReviewedPaymentPromise(evening,'collector-1','2026-11-18'),true);
assert.equal(hasReviewedPaymentPromise(evening,'collector-2','2026-11-18'),false);
assert.equal(hasReviewedPaymentPromise(evening,'collector-1','2026-11-19'),false);
assert.equal(hasReviewedPaymentPromise(record,'collector-1','2026-11-18'),true);
const nextExpression=ledger.match(/const nextRowIndex = ([^;]+);/)[1];
const nextContext={roundRows:[{id:'A05'},{id:'A06'},{id:'A07'}],currentRowIndex:0,retryIds:null,collectionStatusByClient:{A06:evening},collectorKey:'collector-1',todayDateKey:'2026-11-18',hasReviewedPaymentPromise};
assert.equal(vm.runInNewContext(nextExpression,nextContext),2,'Skip payment-reviewed A06 and continue A07');
nextContext.todayDateKey='2026-11-19';
assert.equal(vm.runInNewContext(nextExpression,nextContext),1,'New workday includes A06 again');
const advanceSource=ledger.slice(ledger.indexOf('  function advanceAfterManagement('),ledger.indexOf('  function renderImportantNote'));
const navigation={hasReviewedPaymentPromise,paymentReviews:[{row:{id:'A02'}}],hotClientId:null,automaticFollowup:false,dueFollowups:[],shownPromises:[],visibleRow:{id:'A10'},nextRowIndex:1,currentRowIndex:0,roundRows:[{id:'A10'},{id:'A11'}],retryIds:null,scheduledIds:[],readyPendingIds:[],collectionStatusByClient:{},collectorKey:'collector-1',todayDateKey:'2026-11-18',now,
 reviewId:null,cursor:0,setPaymentReviewId(v){navigation.reviewId=v},setPaymentResumeAdvance(){},setHotClientId(){},setAutomaticFollowup(){},setShownPromises(){},changeSelectedRow(i){navigation.cursor=i},setDeferredIds(){},setRetryIds(){},setSelectedRowId(){},setRoundFinished(){}};
vm.runInNewContext(ts.transpile(advanceSource,{target:9}),navigation);
navigation.advanceAfterManagement();assert.equal(navigation.reviewId,null);assert.equal(navigation.cursor,1,'Incoming payment for A02 must not divert A10 to another unit');
navigation.advanceAfterManagement(undefined,'A02');assert.equal(navigation.cursor,1,'After payment review resume next unit');
navigation.roundRows=[{id:'A10'},{id:'A02'},{id:'A11'}];navigation.cursor=0;
navigation.advanceAfterManagement(undefined,'A02');assert.equal(navigation.cursor,2,'Do not revisit reviewed unit when it was next');
// The actual review save callback must wait for confirmed persistence before clearing the review.
const saveStart=ledger.indexOf('          // Capture the position before closing');
const saveBody=ledger.slice(saveStart,ledger.indexOf('        }}/>',saveStart));
let resolveSave;
const saveContext={row:{id:'A02'},result:'closed_today',input:{},roundFinished:false,paymentResumeAdvance:true,saving:false,advanced:false,reviewId:'A02',
 advanceAfterManagement(){saveContext.advanced=true},setOutcomeSaving(v){saveContext.saving=v},setPaymentReviewId(v){saveContext.reviewId=v},onContactOutcome:()=>new Promise(resolve=>resolveSave=resolve)};
let saving=vm.runInNewContext(ts.transpile('(async()=>{'+saveBody+'})()',{target:9}),saveContext);
assert.equal(saveContext.advanced,false);assert.equal(saveContext.reviewId,'A02');resolveSave();await saving;assert.equal(saveContext.advanced,true);assert.equal(saveContext.reviewId,null);
saveContext.advanced=false;saveContext.reviewId='A02';saveContext.onContactOutcome=async()=>{throw Error('readback failure')};
await assert.rejects(()=>vm.runInNewContext(ts.transpile('(async()=>{'+saveBody+'})()',{target:9}),saveContext));assert.equal(saveContext.advanced,false);assert.equal(saveContext.reviewId,'A02');
console.log('PASS payment receipt detection, deduplication, partial/full payment decisions, editable renewal, day/collector isolation, stored history and failed readback. No real database writes.');
// A receipt for the currently displayed unit opens immediately, without Next.
const ledgerAst=ts.createSourceFile('ledger.tsx',ledger,ts.ScriptTarget.Latest,true);
let openCurrent;function findCurrent(node){if(ts.isFunctionExpression(node)&&node.name?.text==='openCurrentPaymentReview')openCurrent=node;ts.forEachChild(node,findCurrent);}findCurrent(ledgerAst);
const immediate={viewMode:'cartera',workflowTab:'management',roundFinished:false,outcomeSaving:false,paymentReviewId:null,currentPaymentReview:{row:{id:'A13'}},hotClientId:null,automaticFollowup:false,
 cursor:'A13',draft:{amount:'42',note:'Borrador'},opened:null,resume:null,
 setPaymentResumeAdvance(v){immediate.resume=v},setPaymentReviewId(v){immediate.opened=v},setHotClientId(v){immediate.hotClientId=v},setAutomaticFollowup(v){immediate.automaticFollowup=v}};
const runImmediate=()=>vm.runInNewContext(ts.transpile('('+openCurrent.getText(ledgerAst)+')()',{target:9}),immediate);
runImmediate();assert.equal(immediate.opened,'A13');assert.equal(immediate.resume,true);assert.equal(immediate.cursor,'A13');assert.equal(immediate.draft.amount,'42');
for(const patch of [{currentPaymentReview:undefined},{outcomeSaving:true},{paymentReviewId:'A02'},{viewMode:'historial'},{workflowTab:'route'},{roundFinished:true}]){
 const previous={...immediate};Object.assign(immediate,patch,{opened:null});runImmediate();assert.equal(immediate.opened,null);Object.assign(immediate,previous);
}
immediate.hotClientId='A13';immediate.automaticFollowup=false;runImmediate();assert.equal(immediate.resume,false,'Manual follow-up returns to the untouched portfolio unit');
immediate.hotClientId='A13';immediate.automaticFollowup=true;runImmediate();assert.equal(immediate.resume,true,'Automatic follow-up resumes the next portfolio unit');
console.log('PASS immediate review for current unit, preserve draft/cursor, queue other units, wait for ongoing save.');

// No-answer reviews acknowledge the receipt without scheduling a date or time.
context.latestCollectionStatusByClientRef.current={A02:record};context.published=null;
context.supabase.from=()=>({select(){return this},eq(){return this},async single(){return {data:{data:context.saved},error:null}}});
await context.handleContactOutcome('A02','no_answer',{promiseAt:promise.at,paymentReviewKey:review.key});
assert.equal(context.saved.contactOutcomes.length,2);
assert.equal(context.saved.contactOutcomes[1].nextContactAt,undefined);
assert.equal(context.saved.contactOutcomes[1].result,'no_answer');
assert.equal(context.saved.contactOutcomes[0].promiseAmount,100);
assert.equal(paymentReview(context.saved,'collector-1',[payment],now),null,'Same receipt must not reopen');
// Even a restored old draft must not impose a callback time on this decision.
context.latestCollectionStatusByClientRef.current={A02:record};
await context.handleContactOutcome('A02','no_answer',{paymentReviewKey:review.key,nextDate:'2026-11-18',nextTime:'10:00'});
assert.equal(context.saved.contactOutcomes[1].nextContactAt,undefined);
navigation.roundRows=[{id:'A02'}];navigation.currentRowIndex=0;navigation.nextRowIndex=-1;navigation.readyPendingIds=[];navigation.retryIds=null;
navigation.setRetryIds=v=>navigation.startedRetry=v;navigation.setSelectedRowId=v=>navigation.selected=v;
navigation.advanceAfterManagement({clientId:'A02',result:'no_answer'},'A02');
assert.equal(navigation.startedRetry[0],'A02','Last-unit no-answer starts second round even before React rerender');
assert.equal(navigation.selected,'A02');
console.log('PASS payment no-answer: no schedule, preserved history, acknowledged receipt and second-round entry.');
// Important notes share the durable V2 record and must confirm cloud readback.
let noteHandler;function findNote(node){if(ts.isFunctionDeclaration(node)&&node.name?.text==='handleSaveImportantNote')noteHandler=node;ts.forEachChild(node,findNote);}findNote(source);
context.normalizeSupportNote=value=>value.slice(0,300);
context.latestCollectionStatusByClientRef.current={A02:record};context.published=null;
vm.runInNewContext(ts.transpile(noteHandler.getText(source),{target:9}),context);
await context.handleSaveImportantNote('A02','Llamar al contacto autorizado');
assert.equal(context.published.A02.supportNote,'Llamar al contacto autorizado');
assert.equal(context.published.A02.contactOutcomes.length,1);
assert.equal(context.published.A02.contactOutcomes[0].promiseAmount,100);
await context.handleSaveImportantNote('A02','');
assert.equal(context.published.A02.supportNote,'');
context.published=null;context.supabase.from=()=>({select(){return this},eq(){return this},async single(){return {data:{data:record},error:null}}});
await assert.rejects(()=>context.handleSaveImportantNote('A02','No confirmado'));
assert.equal(context.published,null);
console.log('PASS important note save/delete with readback, history retained, failed confirmation keeps editing.');

// A41: a receipt review led to a 15:00 promise, then a follow-up renewed it at 19:00.
const a41={contactOutcomes:[{collector:'collector-1',date:'2026-11-19',at:'2026-11-19T15:05:22.375Z',result:'promise',promiseDate:'2026-11-19',promiseTime:'15:00',promiseAmount:20,paymentReviewKey:'receipt'},
{collector:'collector-1',date:'2026-11-19',at:'2026-11-19T20:12:54.235Z',result:'promise',promiseDate:'2026-11-19',promiseTime:'19:00',promiseAmount:20,followupOf:'2026-11-19T15:05:22.375Z'}]};
assert.equal(hasReviewedPaymentPromise(a41,'collector-1','2026-11-19'),true,'Renewed promise stays out of the ordinary round');
assert.equal(hasReviewedPaymentPromise(a41,'collector-2','2026-11-19'),false);
assert.equal(hasReviewedPaymentPromise(a41,'collector-1','2026-11-20'),false);
const before=paymentReview(a41,'collector-1',[{id:'morning',amountReceived:20.41,createdAt:'2026-11-19T13:43:31.925Z'}],new Date('2026-11-19T23:59:59Z')).agreement;
assert.equal(before.overdue,false);assert.equal(before.remaining,20);
const due=paymentReview(a41,'collector-1',[{id:'morning',amountReceived:20.41,createdAt:'2026-11-19T13:43:31.925Z'}],new Date('2026-11-20T00:00:00Z')).agreement;
assert.equal(due.overdue,true);assert.equal(due.remaining,20);
const paid=paymentReview(a41,'collector-1',[{id:'new-payment',amountReceived:20,createdAt:'2026-11-19T23:00:00Z'}],new Date('2026-11-20T00:00:00Z')).agreement;
assert.equal(paid.overdue,false);assert.equal(paid.remaining,0);
console.log('PASS A41 renewed promise: not in normal round, due only at 7 PM with unpaid amount, prior payment excluded.');
// Exercise actual navigation at the A41 deadline; a clock tick alone cannot move the cursor.
for(const [stamp,amount,expected] of [
 ['2026-11-19T23:59:59Z',0,false],
 ['2026-11-20T00:00:00Z',0,true],
 ['2026-11-20T00:00:00Z',10,true],
 ['2026-11-20T00:00:00Z',19.99,true],
 ['2026-11-20T00:00:00Z',20,false],
 ['2026-11-20T00:00:00Z',25,false]
]) {
 const receipts=[{id:'morning',amountReceived:20.41,createdAt:'2026-11-19T13:43:31.925Z'},...(amount?[{id:'after-promise',amountReceived:amount,createdAt:'2026-11-19T23:00:00Z'}]:[])];
 const agreement=paymentReview(a41,'collector-1',receipts,new Date(stamp)).agreement;
 assert.equal(agreement.remaining,Math.max(0,Math.round((20-amount)*100)/100),'Follow-up must request only the unpaid part of the $20 promise');
 Object.assign(navigation,{paymentReviews:[],hotClientId:null,automaticFollowup:false,dueFollowups:agreement.overdue?[{row:{id:'A41'},followup:agreement}]:[],shownPromises:[],visibleRow:{id:'A40'},nextRowIndex:1,currentRowIndex:0,roundRows:[{id:'A40'},{id:'A42'}],retryIds:null,cursor:0,selected:'A40',draft:'Texto pendiente de A40'});
 navigation.setHotClientId=v=>navigation.hotClientId=v;
 navigation.setAutomaticFollowup=v=>navigation.automaticFollowup=v;
 navigation.setShownPromises=fn=>navigation.shownPromises=fn(navigation.shownPromises);
 assert.equal(navigation.hotClientId,null);assert.equal(navigation.cursor,0,'Clock change must not navigate');
 navigation.advanceAfterManagement();
 assert.equal(agreement.overdue,expected); assert.equal(navigation.hotClientId,null,'Overdue promises stay in the separate window');
 assert.equal(navigation.cursor,1,"Continue to the next unit in order");
 assert.equal(navigation.draft,'Texto pendiente de A40');
}
console.log('PASS A41 18:59:59/19:00, unpaid/partial/paid, waits for current management completion and preserves draft/cursor.');
// Two receipts before the deadline complete the agreement; duplicate delivery
// of the same receipt must not make a partial payment look complete.
const a41HistoryBefore=JSON.stringify(a41);
const firstPart={id:'part-one',amountReceived:8,createdAt:'2026-11-19T22:00:00Z'};
const secondPart={id:'part-two',amountReceived:12,createdAt:'2026-11-19T23:00:00Z'};
for(const stamp of ['2026-11-19T23:59:59Z','2026-11-20T00:00:00Z']) {
 const partial=paymentReview(a41,'collector-1',[firstPart,firstPart],new Date(stamp)).agreement;
 assert.equal(partial.paid,8);assert.equal(partial.remaining,12);
 assert.equal(partial.overdue,stamp==='2026-11-20T00:00:00Z');
 const complete=paymentReview(a41,'collector-1',[firstPart,secondPart,firstPart],new Date(stamp)).agreement;
 assert.equal(complete.paid,20);assert.equal(complete.remaining,0);assert.equal(complete.overdue,false);
}
assert.equal(JSON.stringify(a41),a41HistoryBefore,'Payment evaluation must preserve the promise and its history');
console.log('PASS A41 split payments $8+$12, duplicate receipts, exact remaining balance and unchanged history.');

// Reminder confirmation uses the same durable append/readback path as contact attempts.
for (const result of ['reminder_today','reminder_tomorrow']) {
 context.latestCollectionStatusByClientRef.current={A02:record};context.published=null;
 context.supabase.from=()=>({select(){return this},eq(){return this},async single(){return {data:{data:context.saved},error:null}}});
 await context.handleContactOutcome('A02',result);
 assert.equal(context.published.contactOutcomes,undefined);
 const restored=parseCollectionStatusMapFromStorage(JSON.stringify({A02:context.saved})).A02;
 assert.equal(restored.contactOutcomes.length,2);
 assert.equal(restored.contactOutcomes[0].promiseAmount,100);
 assert.equal(restored.contactOutcomes[1].result,result);
 assert.match(restored.contactOutcomes[1].note,/Mensaje de recordatorio/);
 context.published=null;
 context.supabase.from=()=>({select(){return this},eq(){return this},async single(){return {data:{data:record},error:null}}});
 await assert.rejects(()=>context.handleContactOutcome('A02',result));
 assert.equal(context.published,null);
}
console.log('PASS reminder history survives parsing; failed database confirmation prevents publishing success.');

context.latestCollectionStatusByClientRef.current={A02:record};context.published=null;
context.supabase.from=()=>({select(){return this},eq(){return this},async single(){return {data:{data:context.saved},error:null}}});
await context.handleContactOutcome('A02','reminder_tomorrow',{promiseAt:'',paymentReviewKey:review.key});
assert.equal(context.saved.contactOutcomes.at(-1).result,'reminder_tomorrow');
assert.equal(context.saved.contactOutcomes.at(-1).paymentReviewKey,review.key);
assert.equal(paymentReview(context.saved,'collector-1',[payment],now),null);
assert.equal(context.saved.contactOutcomes[0].promiseAmount,100);
console.log('PASS reminder after payment acknowledges receipt and retains prior history.');

// A new receipt must not force a collection decision if today's dues are covered.
const settledRow={id:'B86',totalPending:0,overdueBalance:0,totalOtherCharges:255,outstandingOtherChargeAmount:255,otherChargeAmountDue:0,outstandingFineAmount:0,outstandingLateFeeAmount:0,outstandingTicketAmount:0};
const realHistory=JSON.stringify(record);
assert.equal(collectionPaymentReview(settledRow,record,'collector-1',[payment],now),null);
assert.equal(collectionPaymentReview({...settledRow,totalOtherCharges:0,outstandingOtherChargeAmount:0},record,'collector-1',[payment],now),null);
for(const patch of [{totalPending:12},{otherChargeAmountDue:15},{outstandingFineAmount:5},{outstandingLateFeeAmount:3},{outstandingTicketAmount:2}]){
 assert.ok(collectionPaymentReview({...settledRow,...patch},record,'collector-1',[payment],now),'An amount due today retains payment review');
}
assert.equal(JSON.stringify(record),realHistory,'Suppressing review does not close the client or alter history');
console.log('PASS settled accounts skip payment review; only currently due rent/charges retain it.');

const reviewed={...record,contactOutcomes:[{collector:'collector-1',date:'2026-11-18',at:'2026-11-18T15:00:00Z',result:'reminder_today'}]};
assert.equal(alreadyManagedToday(reviewed,'collector-1',now),true);
assert.equal(alreadyManagedToday(reviewed,'collector-2',now),false);
assert.equal(alreadyManagedToday(reviewed,'collector-1',new Date('2026-11-19T16:00:00Z')),false);
const reloaded=parseCollectionStatusMapFromStorage(JSON.stringify({A02:reviewed})).A02;
assert.equal(alreadyManagedToday(reloaded,'collector-1',now),true,'Reload preserves completion from durable history');
assert.equal(alreadyManagedToday({gpsLocationReviewedAt:now.toISOString()},'collector-1',now),true);
assert.ok(!ledger.includes('paymentReviews[0]'),'No global payment queue may replace the portfolio cursor');
console.log('PASS payments stay in portfolio order, saved history survives reload, collectors/days remain isolated.');

let activeReviewNode;
function findActiveReview(node){if(ts.isVariableDeclaration(node)&&node.name.getText(ledgerAst)==='activePaymentReview')activeReviewNode=node.initializer;ts.forEachChild(node,findActiveReview);}
findActiveReview(ledgerAst);
const activeContext={paymentReviews:[{row:{id:'A02'}},{row:{id:'A10'}}],paymentReviewId:'A02',visibleRow:{id:'A10'},hotClientId:null,roundFinished:false};
const activeExpression=ts.transpile('const result = '+activeReviewNode.getText(ledgerAst)+'; result;', {target:9});
assert.equal(vm.runInNewContext(activeExpression,{...activeContext}),undefined,'A restored queued payment must not replace the saved unit');
assert.equal(vm.runInNewContext(activeExpression,{...activeContext,paymentReviewId:'A10'}).row.id,'A10');
assert.equal(vm.runInNewContext(activeExpression,{...activeContext,paymentReviewId:'A10',hotClientId:'A41'}),undefined,'Payment review must not displace a due promise');
console.log('PASS restored payment review stays tied to the current unit and never displaces a due follow-up.');

const b10Promise={contactOutcomes:[{collector:'collector-2',date:'2026-11-20',at:'2026-11-20T14:54:33.921Z',result:'promise',promiseDate:'2026-11-20',promiseTime:'14:00',promiseAmount:68}]};
const b10Review=paymentReview(b10Promise,'collector-2',[{id:'b10',amountReceived:25.10,centavosAhorro:0.10,createdAt:'2026-11-20T17:28:55.895Z'}],new Date('2026-11-20T19:04:00Z'));
assert.equal(b10Review.agreement.paid,25);assert.equal(b10Review.agreement.remaining,43);
assert.equal(b10Review.total,25.10,'Receipt total remains unchanged');
const precise=paymentReview(b10Promise,'collector-2',[{id:'b10',amountReceived:25.50,centavosAhorro:0,createdAt:'2026-11-20T17:28:55.895Z'}],new Date('2026-11-20T19:04:00Z'));
assert.equal(precise.agreement.remaining,42.50,'Valid non-savings cents must not be discarded');
console.log('PASS B10 savings cents excluded from promise progress; receipt total and actual cent-valued payments preserved.');
{
const b10Promise={...promise,date:'2026-11-20',at:'2026-11-20T14:54:33.921Z',promiseDate:'2026-11-20',promiseTime:'14:00',promiseAmount:68};
const b10NoAnswer={date:'2026-11-20',at:'2026-11-20T21:03:14.453Z',collector:'collector-1',result:'no_answer',followupOf:b10Promise.at,nextContactAt:'2026-11-20T17:00:00-05:00'};
const b10History={...record,contactOutcomes:[b10Promise,b10NoAnswer]};
const b10Receipt={id:'b10-paid',amountReceived:25.1,centavosAhorro:.1,createdAt:'2026-11-20T17:28:55Z'};
for(const hour of [22,23]){
 const state=paymentReview(b10History,'collector-1',[b10Receipt],new Date(`2026-11-20T${hour}:02:00Z`));
 assert.equal(state.agreement.overdue,false);
 assert.equal(state.agreement.remaining,43);
}
assert.equal(b10History.contactOutcomes.length,2);
console.log('PASS B10 no-answer stops hourly promise alerts, including legacy scheduled attempts; $43 and history retained.');

}
{
 const futureAgreement={...record,contactOutcomes:[{...promise,date:'2026-11-19',at:'2026-11-19T15:04:38.949Z',promiseDate:'2026-11-22',promiseTime:'06:00',promiseAmount:180}]};
 assert.equal(hasReviewedPaymentPromise(futureAgreement,'collector-1','2026-11-21'),true);
 assert.equal(hasReviewedPaymentPromise(futureAgreement,'collector-1','2026-11-22'),true);
 assert.equal(hasReviewedPaymentPromise(futureAgreement,'collector-1','2026-11-23'),false);
 assert.equal(hasReviewedPaymentPromise(futureAgreement,'collector-2','2026-11-21'),false);
 assert.equal(futureAgreement.contactOutcomes.length,1);
 console.log('PASS A02 future promise recorded on previous day stays out of normal round until its due-day follow-up; history unchanged.');
}
{
 const original={...promise,promiseAmount:100};
 const edited={...original,at:'2026-11-18T16:00:00Z',followupOf:original.at,promisePaymentSince:original.at,promiseAmount:120,promiseTime:'18:00',note:'Promesa editada'};
 const history={...record,contactOutcomes:[original,edited]};
 const restored=parseCollectionStatusMapFromStorage(JSON.stringify({client:history})).client;
 const state=paymentReview(restored,'collector-1',[payment],new Date('2026-11-18T17:00:00Z'));
 assert.equal(restored.contactOutcomes.length,2);
 assert.equal(restored.contactOutcomes[0].promiseAmount,100);
 assert.equal(state.agreement.paid,40);
 assert.equal(state.agreement.remaining,80);
 const secondEdit={...edited,at:'2026-11-18T17:01:00Z',promiseAmount:50,followupOf:edited.at};
 const again=paymentReview({...history,contactOutcomes:[original,edited,secondEdit]},'collector-1',[payment],new Date('2026-11-18T18:00:00Z'));
 assert.equal(again.agreement.remaining,10);
 console.log('PASS promise edits preserve original history and payment baseline across reload and repeated edits.');
}
