const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const {renderToString} = require('react-dom/server');
const data = new Map([['original-management', 'unchanged']]);
const storage = {getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
const events = new Map(), timers = new Map();
let clock = Date.parse('2026-11-19T04:59:59.500Z'), serial = 0;
class FakeDate extends Date { constructor(...args) { super(...(args.length ? args : [clock])); } }
const window = {localStorage:storage, setTimeout(fn,delay){const id=++serial;timers.set(id,{fn,at:clock+delay});return id;},clearTimeout(id){timers.delete(id);},addEventListener(k,f){events.set(k,f);},removeEventListener(k){events.delete(k);}};
const document = {addEventListener(k,f){events.set(k,f);},removeEventListener(k){events.delete(k);}};
function load(path) { const exports={}; vm.runInNewContext(ts.transpile(fs.readFileSync(path,'utf8'),{target:9,module:1}),{exports,require,Date:FakeDate,window,document,localStorage:storage}); return exports; }
const access=load('src/receivablesV2CollectorAccess.ts');
const progress=load('src/pages/receivablesV2/workdayProgress.ts');
const {startWorkdayClock}=load('src/pages/receivablesV2/workdayClock.ts');
const billing=fs.readFileSync('src/billing.ts','utf8');
const dateCode=billing.slice(billing.indexOf('export const BUSINESS_TIME_ZONE'),billing.indexOf('export function toDateKey'));
const dates={};vm.runInNewContext(ts.transpile(dateCode,{target:9,module:1}),{exports:dates,Date:FakeDate,Intl});
function read(key,initial){let result;function Probe(){result=progress.useWorkdayValue(key,initial);return null;}renderToString(React.createElement(Probe));return result;}
const previous='2026-11-18',next='2026-11-19';
const history={contactOutcomes:[{collector:'collector-1',date:previous,at:'2026-11-19T04:00:00Z',result:'no_answer'},{collector:'collector-2',date:previous,at:'2026-11-19T04:30:00Z',result:'promise'}]};
const historyBefore=JSON.stringify(history);
for(const [collector,unit,amount] of [['collector-1','A05','37'],['collector-2','B01','62']]){
  const prefix=`cxc.v2.workday.v1:owner:${collector}:${previous}`;
  for(const [field,value] of Object.entries({unit,retryIds:[unit],roundFinished:true,'draft:amount':amount,'draft:time':'23:00','payment:decision':'promise','followup:note':'Pendiente','operational:answer':'same'}))read(prefix+':'+field,null)[1](value);
  access.saveReceivablesCollectorSession('owner',{collector,dateKey:previous});
  assert.equal(access.loadReceivablesCollectorSession('owner',previous).collector,collector);
  assert.equal(access.loadReceivablesCollectorSession('owner',next),null);
  // Re-entering the new day must not restore yesterday's cursor, round or form.
  access.saveReceivablesCollectorSession('owner',{collector,dateKey:next});
  assert.equal(access.loadReceivablesCollectorSession('owner',next).collector,collector);
  for(const field of ['unit','retryIds','draft:amount','draft:time','payment:decision','followup:note','operational:answer'])assert.equal(read(prefix.replace(previous,next)+':'+field,null)[0],null);
  assert.equal(read(prefix.replace(previous,next)+':roundFinished',false)[0],false);
  assert.equal(read(prefix+':unit',null)[0],unit);
  assert.equal(read(prefix+':draft:amount',null)[0],amount);
  assert.equal(progress.latestContact(history,collector,next),undefined);
}
let day;
const stop=startWorkdayClock(now=>day=dates.getBusinessDateKey(now));
assert.equal(day,previous);
assert.equal([...timers.values()][0].at-clock,500);
clock+=500;[...timers.values()][0].fn();assert.equal(day,next);
clock=Date.parse('2026-11-20T05:30:00Z');events.get('focus')();assert.equal(day,'2026-11-20');
assert.equal(timers.size,1);
stop();assert.equal(timers.size,0);assert.equal(events.size,0);
assert.equal(JSON.stringify(history),historyBefore);
assert.equal(data.get('original-management'),'unchanged');
console.log('PASS Panama 23:59:59.500 → 00:00:00, suspended-tab resume, expired collector access, independent fresh days for both collectors, old drafts/history retained, original storage untouched. No network writes.');
// Regression: yesterday's saved agreement must not seed today's first-round form.
const rowSource=fs.readFileSync('src/pages/receivablesV2/ReceivableTableRow.tsx','utf8');
const promiseExpression=rowSource.match(/const currentPromiseRecord = ([^;]+);/)[1];
const oldRecord={paymentPromiseDate:'2026-11-18',paymentPromiseTime:'21:00',paymentPromiseAmount:34};
assert.equal(vm.runInNewContext(ts.transpile('('+promiseExpression+')'),{statusRecord:oldRecord,todayDateKey:'2026-11-19'}),undefined);
const validRecord={...oldRecord,paymentPromiseDate:'2026-11-20'};
assert.equal(vm.runInNewContext(ts.transpile('('+promiseExpression+')'),{statusRecord:validRecord,todayDateKey:'2026-11-19'}),validRecord);
const repairStart=rowSource.indexOf('    // Older versions copied yesterday');
const repair=rowSource.slice(repairStart,rowSource.indexOf('  }, [promiseDateDraft, todayDateKey]);',repairStart));
let repaired={};
const repairContext={promiseDateDraft:'2026-11-18',todayDateKey:'2026-11-19',now:new Date('2026-11-19T15:52:00Z'),Date,nextFixedDepositHour:()=> '11:00',getBusinessDateKey:dates.getBusinessDateKey,fixedDepositTimeParts:()=>({hour:11}),setPromiseDateDraft:v=>repaired.date=v,setPromiseTimeDraft:v=>repaired.time=v,setPaymentPromiseHourDraft:v=>repaired.hour=v,setPaymentPromiseAmountDraft:v=>repaired.amount=v,setPromiseTimeEdited:v=>repaired.edited=v};
vm.runInNewContext(repair,repairContext);
assert.deepEqual(repaired,{date:'2026-11-19',time:'11:00',hour:'11',amount:'',edited:false});
repaired={};repairContext.promiseDateDraft='2026-11-19';vm.runInNewContext(repair,repairContext);assert.deepEqual(repaired,{});
assert.equal(oldRecord.paymentPromiseAmount,34);
assert.equal(oldRecord.paymentPromiseDate,'2026-11-18');
console.log('PASS old saved promise does not populate new form; contaminated expired draft repaired; valid current/future choices and prior agreement retained.');
