const fs = require("fs"), vm = require("vm"), ts = require("typescript"), assert = require("assert/strict");
const source=fs.readFileSync("src/pages/receivablesV2/ReceivablesLedgerTable.tsx","utf8");
const start=source.indexOf("onSave={async (result, input) => {")+"onSave={async (result, input) => {".length;
const body=source.slice(start,source.indexOf("}}/> : undefined}",start));
const code=ts.transpile("(async()=>{"+body+"})()",{target:9});
function state(){const x={paymentReviews:[],setPaymentReviewId(){},setPaymentResumeAdvance(){},result:"no_answer",input:{},row:{id:"A03"},visibleRow:{id:"A10"},dueFollowups:[],shownPromises:[],pendingIds:[],readyPendingIds:[],automaticFollowup:true,currentRowIndex:9,nextRowIndex:10,scheduledIds:[],roundRows:Array(20),retryIds:null,hotClientId:"A03",saving:false,Set,
 setOutcomeSaving(v){x.saving=v},setHotClientId(v){x.hotClientId=v},setAutomaticFollowup(v){x.automaticFollowup=v},changeSelectedRow(v){x.currentRowIndex=v},setShownPromises(){},setDeferredIds(){},setSelectedRowId(){},setRetryIds(){},setSelectedRowIndex(){},setRoundFinished(){},onContactOutcome:async()=>{}};return x;}
(async()=>{
 const x=state();let confirm;x.onContactOutcome=()=>new Promise(resolve=>confirm=resolve);
 const pending=vm.runInNewContext(code,x);assert.equal(x.hotClientId,"A03");assert.equal(x.currentRowIndex,9);assert.equal(x.saving,true);
 confirm();await pending;assert.equal(x.hotClientId,null);assert.equal(x.currentRowIndex,10);assert.equal(x.saving,false);
 const fail=state();fail.onContactOutcome=async()=>{throw Error("database rejected")};await assert.rejects(()=>vm.runInNewContext(code,fail));assert.equal(fail.hotClientId,"A03");assert.equal(fail.currentRowIndex,9);assert.equal(fail.saving,false);
 const queue=state();queue.dueFollowups=[{row:{id:"A04"},followup:{alertKey:"next"}}];await vm.runInNewContext(code,queue);assert.equal(queue.hotClientId,"A04");assert.equal(queue.currentRowIndex,9);
 console.log("PASS confirmed save resumes position; pending/failure stays on unit; next overdue first.");
})().catch(e=>{console.error(e);process.exitCode=1});
