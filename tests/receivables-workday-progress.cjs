const assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm'), ts=require('typescript');
const React=require('react'), {renderToString}=require('react-dom/server');
const data=new Map(),storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
const exported={};vm.runInNewContext(ts.transpile(fs.readFileSync('src/pages/receivablesV2/workdayProgress.ts','utf8'),{target:9,module:1}),{exports:exported,require,localStorage:storage});
function read(key,initial){let hook;function Probe(){hook=exported.useWorkdayValue(key,initial);return null;}renderToString(React.createElement(Probe));return hook;}
const scope='cxc.v2.workday.v1:owner:collector-1:2026-11-18';
for(const [field,value] of Object.entries({unit:'A10',retryIds:['A10','A20'],hotClientId:'A03',automaticFollowup:false,shownPromises:['A03|promise'],deferred:['A20'],'draft:A10:amount':'123.45','followup:A03:note':'Llamar luego'})){
 read(scope+':'+field,null)[1](value);assert.equal(JSON.stringify(read(scope+':'+field,null)[0]),JSON.stringify(value));
 assert.equal(read(scope.replace('collector-1','collector-2')+':'+field,null)[0],null);
 assert.equal(read(scope.replace('2026-11-18','2026-11-19')+':'+field,null)[0],null);
}
const items=[{id:'A01'},{id:'A10'}], selectedRowId=read(scope+':unit',null)[0];
const ledger=fs.readFileSync('src/pages/receivablesV2/ReceivablesLedgerTable.tsx','utf8');
const expr=ledger.match(/const currentRowIndex = ([^;]+);/)[1];
assert.equal(vm.runInNewContext(expr,{roundRows:items,rows:items,selectedRowId,restoredRoundIndex:exported.restoredRoundIndex}),1);
assert.equal(vm.runInNewContext(expr,{roundRows:[...items].reverse(),rows:items,selectedRowId,restoredRoundIndex:exported.restoredRoundIndex}),0);
assert.equal(read(scope+':unit',null)[0],'A10');
const record={contactOutcomes:[{collector:'collector-1',date:'2026-11-18',at:'2026-11-18T14:00:00Z',result:'no_answer',nextContactAt:'2026-11-18T15:00:00-05:00'}]};
assert.equal(exported.contactIsDue(record,'collector-1','2026-11-18',new Date('2026-11-18T19:59:59Z')),false);
assert.equal(exported.contactIsDue(record,'collector-1','2026-11-18',new Date('2026-11-18T20:00:00Z')),true);
assert.equal(exported.contactIsDue(record,'collector-2','2026-11-18',new Date('2026-11-18T20:00:00Z')),false);
record.contactOutcomes.push({collector:'collector-1',date:'2026-11-18',at:'2026-11-18T16:00:00Z',result:'promise'});
assert.equal(exported.contactIsDue(record,'collector-1','2026-11-18',new Date('2026-11-18T20:00:00Z')),false);
console.log('PASS actual React hook: restore cursor, round, followup and drafts; collector/day isolation; stable unit across reordering; exact Panama contact deadline.');

const nextFunction=ledger.slice(ledger.indexOf('  function advanceAfterManagement('),ledger.indexOf('  function renderImportantNote'));
const nextBody=nextFunction+'advanceAfterManagement();';
let deferred=[],retry=null,unit=null,finished=false;
const context={paymentReviews:[],setPaymentReviewId(){},setPaymentResumeAdvance(){},onPersistPendingChanges(){},hotClientId:null,automaticFollowup:false,dueFollowups:[],shownPromises:[],visibleRow:{id:'A99'},setHotClientId(){},setAutomaticFollowup(){},setShownPromises(){},nextRowIndex:-1,currentRowIndex:1,roundRows:[{},{}],retryIds:null,scheduledIds:['A20'],readyPendingIds:['A10'],setDeferredIds(v){deferred=v},setRetryIds(v){retry=v},setSelectedRowId(v){unit=v},setRoundFinished(v){finished=v}};
vm.runInNewContext(ts.transpile('(()=>{'+nextBody+'})()',{target:9}),context);
assert.equal(JSON.stringify(retry),JSON.stringify(['A10']));assert.equal(unit,'A10');assert.equal(JSON.stringify(deferred),JSON.stringify(['A20']));
context.readyPendingIds=[];vm.runInNewContext(ts.transpile('(()=>{'+nextBody+'})()',{target:9}),context);assert.equal(finished,true);assert.equal(retry.length,0);
vm.runInNewContext(ts.transpile(nextFunction+'advanceAfterManagement({clientId:"A99",result:"no_answer"});',{target:9}),context);
assert.equal(JSON.stringify(retry),JSON.stringify(['A99'])); // final answer is included before React's next render
context.readyPendingIds=['A99'];
vm.runInNewContext(ts.transpile(nextFunction+'advanceAfterManagement({clientId:"A99",result:"promise"});',{target:9}),context);
assert.equal(retry.length,0);
const effectStart=ledger.indexOf('    // Never reset a restored position');
const effectBody=ledger.slice(effectStart,ledger.indexOf('  }, [roundFinished',effectStart));
let reopened=false;
const wait={hasReviewedPaymentPromise:()=>false,selectedRowId:'A99',roundRows:[],hotClientId:null,rows:[],roundFinished:true,deferredIds:['A20'],readyPendingIds:[],setSelectedRowId(v){unit=v},setHotClientId(){},setRetryIds(v){retry=v},setDeferredIds(fn){deferred=fn(['A20'])},setRoundFinished(v){reopened=!v}};
vm.runInNewContext("(()=>{"+effectBody+"})()",wait);assert.equal(reopened,false);
wait.readyPendingIds=['A20'];vm.runInNewContext("(()=>{"+effectBody+"})()",wait);assert.equal(reopened,true);assert.equal(unit,'A20');assert.equal(deferred.length,0);
console.log('PASS real navigation: second round excludes future contacts, waits, then resumes when contact becomes due.');

(async () => {
  const start=ledger.indexOf('  const stableOnGpsLocationReview = useStableEvent(');
  const callback=ledger.slice(start+'  const stableOnGpsLocationReview = useStableEvent('.length,ledger.indexOf('\n  const stableOnPersistPendingChanges',start)).trim().replace(/\);$/, '');
  let resolveSave, advances=0, saving=false;
  const state={setOutcomeSaving(v){saving=v},onGpsLocationReview:()=>new Promise(resolve=>{resolveSave=resolve}),advanceAfterManagement(){advances++}};
  const save=vm.runInNewContext(ts.transpile('('+callback+')',{target:9}),state);
  const pending=save('A01','confirmed');
  assert.equal(saving,true);assert.equal(advances,0);
  resolveSave();await pending;
  assert.equal(saving,false);assert.equal(advances,1);
  state.onGpsLocationReview=async()=>{throw Error('Database failure')};
  await assert.rejects(()=>save('A01','confirmed'));
  assert.equal(advances,1);assert.equal(saving,false);
  console.log('PASS GPS confirmation advances only after successful persistence; failed saves retain the unit.');
  const contactStart=ledger.indexOf('  const saveContactOutcome = useStableEvent(');
  const contactCallback=ledger.slice(contactStart+'  const saveContactOutcome = useStableEvent('.length,ledger.indexOf('\n  const [retryIds',contactStart)).trim().replace(/\);$/, '');
  for (const result of ['promise','no_answer']) {
    advances=0;
    state.onContactOutcome=()=>new Promise(resolve=>{resolveSave=resolve});
    const contactSave=vm.runInNewContext(ts.transpile('('+contactCallback+')',{target:9}),state);
    const savingContact=contactSave('A02',result);
    assert.equal(advances,0);assert.equal(saving,true);
    resolveSave();await savingContact;assert.equal(advances,1);assert.equal(saving,false);
    state.onContactOutcome=async()=>{throw Error('Write failed')};
    await assert.rejects(()=>contactSave('A02',result));assert.equal(advances,1);
  }
  const statusMarker='onPendingChange={setOperationalPending} onSave={async status => {';
  const statusStart=ledger.indexOf(statusMarker)+statusMarker.length;
  const statusBody=ledger.slice(statusStart,ledger.indexOf('}}/>',statusStart));
  for(const status of ['taller','libre','activo']) {
    advances=0;state.status=status;state.row={id:'A02'};
    state.onValidateUnitStatus=()=>new Promise(resolve=>{resolveSave=resolve});
    state.advanceAfterManagement=()=>{advances++};state.setOperationalPending=()=>{};
    const statusSave=vm.runInNewContext(ts.transpile('(async()=>{'+statusBody+'})()',{target:9}),state);
    assert.equal(advances,0);resolveSave();await statusSave;assert.equal(advances,1);
    state.onValidateUnitStatus=async()=>{throw Error('Write failed')};
    await assert.rejects(()=>vm.runInNewContext(ts.transpile('(async()=>{'+statusBody+'})()',{target:9}),state));assert.equal(advances,1);
  }
  console.log('PASS promises, no-answer and all status confirmations advance after save only; last no-answer enters second round.');
})().catch(error=>{console.error(error);process.exitCode=1});

// Switching collectors unmounts the ledger at the PIN gate. Mount each collector
// repeatedly with distinct units and drafts, using the production storage hook.
const collectorStates = [
  {collector:'collector-1',unit:'A05',amount:'37',time:'18:00'},
  {collector:'collector-2',unit:'B03',amount:'62',time:'19:00'}
];
for (const state of collectorStates) {
  const prefix=`cxc.v2.workday.v1:account-switch:${state.collector}:2026-11-18`;
  read(prefix+':unit',null)[1](state.unit);
  read(prefix+':draft:amount','')[1](state.amount);
  read(prefix+':draft:time','')[1](state.time);
}
for (const index of [0,1,0,1,0]) {
  const state=collectorStates[index],prefix=`cxc.v2.workday.v1:account-switch:${state.collector}:2026-11-18`;
  assert.equal(read(prefix+':unit',null)[0],state.unit);
  assert.equal(read(prefix+':draft:amount','')[0],state.amount);
  assert.equal(read(prefix+':draft:time','')[0],state.time);
  assert.equal(read(prefix.replace('account-switch','different-owner')+':unit',null)[0],null);
}
Object.defineProperty(storage,'length',{get:()=>data.size});
storage.key=index=>[...data.keys()][index]??null;
const old='cxc.v2.workday.v1:preview:collector-1:2026-11-18';
storage.setItem(old+':unit',JSON.stringify('client-a'));
storage.setItem(old+':draft:client-a:amount',JSON.stringify('19'));
exported.migrateLegacyWorkdayProgress('wrong-owner','collector-1','2026-11-18',['client-b']);
assert.equal(storage.getItem(old+':migrated-owner'),null);
exported.migrateLegacyWorkdayProgress('correct-owner','collector-1','2026-11-18',['client-a']);
assert.equal(read(old.replace(':preview:',':correct-owner:')+':unit',null)[0],'client-a');
assert.equal(read(old.replace(':preview:',':correct-owner:')+':draft:client-a:amount','')[0],'19');
exported.migrateLegacyWorkdayProgress('second-owner','collector-1','2026-11-18',['client-a']);
assert.equal(read(old.replace(':preview:',':second-owner:')+':unit',null)[0],null);
const page=fs.readFileSync('src/pages/ReceivablesV2Page.tsx','utf8');
assert(page.includes('progressScope={dataOwnerUserId ?? "local"}'));
assert(page.includes('key={`${dataOwnerUserId ?? "local"}:${activeCollector}:${todayDateKey}:${Boolean(baseRows.length)}`}'));
assert(page.includes('clearReceivablesCollectorSession(dataOwnerUserId);\n                setCollectorSession(null);'));
console.log('PASS Cobrador 1 → 2 → 1: independent units, amounts and hours; different-owner isolation; safe adoption of existing local drafts; PIN gate remounts ledger.');
const previousUnitRows=[{id:'A05'},{id:'A06'},{id:'A07'}];
const remainingRows=[{id:'A05'},{id:'A07'}];
assert.equal(exported.restoredRoundIndex(remainingRows,previousUnitRows,'A06'),1,'Restored A06 moves forward to A07, not A05');
assert.equal(exported.restoredRoundIndex(remainingRows,previousUnitRows,'A07'),1);
assert.equal(exported.restoredRoundIndex([{id:'A05'}],previousUnitRows,'A06'),1,'No following unit finishes round');
console.log('PASS restored reviewed unit skips forward; filtered backward navigation cannot return it; end of round does not restart.');

// A normal no-answer belongs to retry, even without a payment review receipt.
const eligibleMatch = ledger.match(/const eligibleRows = openRows\.filter\(row => \{([\s\S]*?)\n  \}\);/);
const eligibility = ts.transpile('(row => {' + eligibleMatch[1] + '\n})', {target:9});
const b08 = {contactOutcomes:[{collector:'collector-2',date:'2026-11-20',at:'2026-11-20T14:39:36Z',result:'no_answer'}]};
const managedSource=ts.createSourceFile("paymentReview.ts",fs.readFileSync("src/pages/receivablesV2/paymentReview.ts","utf8"),ts.ScriptTarget.Latest,true);
const managedFn=managedSource.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==="alreadyManagedToday");
const managedCtx={getBusinessDateKey:d=>new Intl.DateTimeFormat("en-CA",{timeZone:"America/Panama"}).format(d)};
vm.runInNewContext(ts.transpile(managedFn.getText(managedSource).replace("export ",""),{target:9}),managedCtx);
const eligibilityContext = {alreadyManagedToday:managedCtx.alreadyManagedToday,isUnitStatusConfirmed:()=>false,collectionStatusByClient:{B08:b08},collectorKey:'collector-2',todayDateKey:'2026-11-20',now:new Date('2026-11-20T20:19:00Z'),latestContact:exported.latestContact,contactIsDue:exported.contactIsDue,hasReviewedPaymentPromise:()=>false,retryIds:null};
assert.equal(vm.runInNewContext(eligibility,eligibilityContext)({id:'B08'}),false);
eligibilityContext.retryIds=['B08'];
assert.equal(vm.runInNewContext(eligibility,eligibilityContext)({id:'B08'}),true);
eligibilityContext.collectorKey='collector-1';
assert.equal(vm.runInNewContext(eligibility,eligibilityContext)({id:'B08'}),true);
console.log('PASS B08 saved no-answer excluded from first round, available for second round, collector isolation.');
eligibilityContext.retryIds=null;
eligibilityContext.collectorKey='collector-2';
for(const result of ['promise','reminder_today','reminder_tomorrow','closed_today','no_answer']){
 eligibilityContext.collectionStatusByClient.B08={contactOutcomes:[{...b08.contactOutcomes[0],result}]};
 assert.equal(vm.runInNewContext(eligibility,eligibilityContext)({id:'B08'}),false,result);
}
eligibilityContext.collectionStatusByClient.B08={gpsLocationReviewedAt:'2026-11-20T15:00:00Z'};
assert.equal(vm.runInNewContext(eligibility,eligibilityContext)({id:'B08'}),false);
eligibilityContext.collectionStatusByClient.B08={};
eligibilityContext.isUnitStatusConfirmed=()=>true;
assert.equal(vm.runInNewContext(eligibility,eligibilityContext)({id:'B08'}),false);
eligibilityContext.isUnitStatusConfirmed=()=>false;
assert.equal(vm.runInNewContext(eligibility,eligibilityContext)({id:'B08'}),true);
console.log('PASS all saved first-round outcomes, GPS and state validations excluded; unmanaged units retained.');
