const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync('src/pages/ReceivablesV2Page.tsx', 'utf8');
const end = source.indexOf('  const enqueueStreetManagementPersist');
const start = source.lastIndexOf('  useEffect(() => {', end);
const effect = source.slice(start, end);
let cleanup, interval, pending, calls = 0, removed = false;
let fleet = [{unit_id:'A11',operational_status:'libre'}];
const events = new Map(), subscriptions = [];
const channel = {on(type, filter, callback){subscriptions.push({filter,callback});return this;},subscribe(){return this;}};
const context = {
 dataOwnerUserId:'owner',
 useEffect:fn=>{cleanup=fn();},
 setFleetUnits:value=>{fleet=typeof value==='function'?value(fleet):value;},
 loadControlUnits:()=>{calls++;return new Promise((resolve,reject)=>{pending={resolve,reject};});},
 measureReceivablesAsync:(_,fn)=>fn(),
 console:{error(){}},
 window:{setInterval:fn=>{interval=fn;return 1;},clearInterval(){interval=null;},addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:name=>events.delete(name)},
 document:{visibilityState:'visible',addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:name=>events.delete(name)},
 supabase:{channel:()=>channel,removeChannel:()=>{removed=true;}}
};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
 vm.runInNewContext(ts.transpile(effect,{target:9}),context);
 assert.equal(calls,1);
 pending.resolve(fleet);await tick();
 assert.ok(subscriptions.every(s=>s.filter.filter==='user_id=eq.owner'));
 subscriptions[0].callback();
 pending.resolve([{unit_id:'A11',operational_status:'activo'}]);await tick();
 assert.equal(fleet[0].operational_status,'activo');
 interval();pending.reject(new Error('offline'));await tick();
 assert.equal(fleet[0].operational_status,'activo');
 events.get('focus')();subscriptions[1].callback();
 const before=calls;
 pending.resolve(fleet);await tick();
 assert.equal(calls,before+1,'changes during a load trigger a fresh read');
 cleanup();pending.resolve([{unit_id:'A11',operational_status:'libre'}]);await tick();
 assert.equal(fleet[0].operational_status,'activo');
 assert.equal(events.size,0);assert.equal(interval,null);assert.ok(removed);
 console.log('PASS actual fleet effect: A11 updates without reload, scoped realtime, polling, focus, queued refresh, failure retention and cleanup. No management/storage writes.');
})().catch(error=>{console.error(error);process.exitCode=1;});
