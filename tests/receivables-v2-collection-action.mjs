import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const output = await build({stdin:{contents:'export {PromiseFollowupForm} from "./src/pages/receivablesV2/PromiseFollowupForm"; export {buildReceivableRows} from "./src/receivablesV2"; export {VerifiedPaymentReview} from "./src/pages/receivablesV2/VerifiedPaymentReview"; export {collectionAction} from "./src/pages/receivablesV2/collectionAction"; export {PaymentReviewForm} from "./src/pages/receivablesV2/PaymentReviewForm"; export {ReminderForm} from "./src/pages/receivablesV2/ReminderForm";',resolveDir:process.cwd(),loader:'tsx'},jsx:'automatic',bundle:true,platform:'node',format:'cjs',write:false,external:['react','react/jsx-runtime']});
const module={exports:{}};
const require=createRequire(import.meta.url);
vm.runInNewContext(output.outputFiles[0].text,{module,exports:module.exports,require,Date});
const {collectionAction,ReminderForm}=module.exports;
const row={plan:'weekly',nextDueDate:'2026-11-21',overdueBalance:0,totalPending:0,totalOtherCharges:135,otherChargeAmountDue:0};
assert.equal(collectionAction(row,'2026-11-20'),'reminder_tomorrow','B84: current rent and installment paid, next rent tomorrow');
for(const plan of ['weekly','biweekly','monthly']) assert.equal(collectionAction({...row,plan},'2026-11-20'),'reminder_tomorrow');
assert.equal(collectionAction({...row,plan:'daily'},'2026-11-20'),'gps');
assert.equal(collectionAction({...row,nextDueDate:'2026-11-22'},'2026-11-20'),'gps');
assert.equal(collectionAction({...row,nextDueDate:'2027-01-01'},'2026-12-31'),'reminder_tomorrow');
assert.equal(collectionAction({...row,totalPending:204,nextDueDate:'2026-11-20'},'2026-11-20'),'reminder_today');
assert.equal(collectionAction({...row,totalPending:204,overdueBalance:14},'2026-11-20'),'call','Overdue rent takes precedence over reminders');
const React=require('react');const {renderToStaticMarkup}=require('react-dom/server');
for(const tomorrow of [true,false]){
 const html=renderToStaticMarkup(React.createElement(ReminderForm,{tomorrow,disabled:false,confirmed:false,onSave:async()=>{}}));
 assert.match(html,/Mensaje enviado y continuar/);
 assert.match(html,tomorrow?/is-tomorrow/:/is-today/);
 assert.doesNotMatch(html,/<input/,'Reminder does not require a fictitious payment promise');
}
console.log('PASS action priority, B84 upcoming rent, weekly/biweekly/monthly reminders, year rollover and reminder form.');

const paymentHtml=renderToStaticMarkup(React.createElement(module.exports.PaymentReviewForm,{
 draftKey:'test:B84',unit:'B84',name:'Cliente',row,today:'2026-11-20',
 review:{key:'receipt',total:14.84,received:[{id:'receipt'}],agreement:null},onSave:async()=>{}
}));
assert.match(paymentHtml,/Pago recibido/);
assert.match(paymentHtml,/Paga mañana · Envía un recordatorio/);
assert.match(paymentHtml,/Mensaje enviado y continuar/);
assert.doesNotMatch(paymentHtml,/Selecciona una decisión/);
console.log('PASS B84 payment-review screen displays tomorrow reminder directly.');

// B22's confirmed receipt leaves $0 rent and $16 toward the next $34 quota.
const b22={id:'B22',unitId:'B22',name:'B22',cedula:'',frequency:'daily',rentAmount:34,balance:0,advanceBalance:16,
 status:'activo',firstChargeDate:'2026-11-14',lastChargeDate:'2026-11-16',createdAt:'2026-07-05T03:18:50Z',
 installmentsAgreed:1040,installmentsIssued:175,installmentsPaid:171,installmentsRemaining:869,otherCharges:[],fines:[],tickets:[],savings:18.7};
const b22Before=JSON.stringify(b22);
const freshRow=module.exports.buildReceivableRows([b22],[],new Date(2026,10,20,12))[0];
assert.equal(freshRow.totalPending,0);assert.equal(freshRow.overdueBalance,0);
assert.equal(freshRow.nextDueDate,'2026-11-21');assert.equal(b22.advanceBalance,16);
assert.equal(JSON.stringify(b22),b22Before);
const staleRow={...freshRow,totalPending:52,overdueBalance:18};
const pending=renderToStaticMarkup(React.createElement(module.exports.VerifiedPaymentReview,{
 draftKey:'B22',unit:'B22',name:'B22',row:staleRow,today:'2026-11-20',
 review:{key:'new',total:150,received:[{id:'new'}],agreement:null},onSave:async()=>{},loadRow:async()=>freshRow
}));
assert.match(pending,/Verificando saldo actual/);
assert.doesNotMatch(pending,/Llamar al cliente|Renta vencida|52.00|18.00/);
const verifiedHtml=renderToStaticMarkup(React.createElement(module.exports.PaymentReviewForm,{
 draftKey:'B22',unit:'B22',name:'B22',row:freshRow,today:'2026-11-20',
 review:{key:'new',total:150,received:[{id:'new'}],agreement:null},onSave:async()=>{}
}));
assert.doesNotMatch(verifiedHtml,/Llamar al cliente|52.00|18.00/);
console.log('PASS B22: verified rent $0, $16 advance preserved, no stale balances during readback.');

for(const paid of [25,0]) {
 const followupHtml=renderToStaticMarkup(React.createElement(module.exports.PromiseFollowupForm,{today:'2026-11-20',onSave:async()=>{},followup:{promise:{at:'2026-11-20T14:54:33Z',promiseDate:'2026-11-20',promiseTime:'14:00',promiseAmount:68},paid,remaining:68-paid,overdue:true,alertKey:'test'}}));
 assert.match(followupHtml,/PROMETIÓ/); assert.match(followupHtml,/Pagó/);
 assert.match(followupHtml,/2:00 PM/);assert.match(followupHtml,/Falta/);
 assert.doesNotMatch(followupHtml,/PROMESA VENCIDA/);
}
console.log('PASS clear partial/unpaid follow-up labels and AM/PM deadline.');
const newClientDue={...row,unitId:'A30',totalPending:174,overdueBalance:0,nextDueDate:'2026-11-21'};
for(const age of [0,7,89]) assert.equal(collectionAction(newClientDue,'2026-11-21',age),'new_client_followup');
for(const age of [90,91,null,undefined]) assert.equal(collectionAction(newClientDue,'2026-11-21',age),'reminder_today');
assert.equal(collectionAction({...newClientDue,overdueBalance:10},'2026-11-21',7),'call');
assert.equal(collectionAction({...newClientDue,totalPending:0,nextDueDate:'2026-11-22'},'2026-11-21',7),'reminder_tomorrow','No collection required for future rent');
assert.equal(collectionAction({...newClientDue,totalPending:0,nextDueDate:'2026-11-28'},'2026-11-21',7),'gps','No promise required when up to date');
const newClientHtml=renderToStaticMarkup(React.createElement(module.exports.PaymentReviewForm,{
 draftKey:'test:A30',unit:'A30',name:'Cliente',row:newClientDue,tenureDays:7,today:'2026-11-21',
 review:{key:'receipt',total:10,received:[{id:'receipt'}],agreement:null},onSave:async()=>{}
}));
assert.match(newClientHtml,/Continuar con una nueva promesa/);
assert.match(newClientHtml,/No contestó, se dejó mensaje/);
assert.doesNotMatch(newClientHtml,/Mensaje enviado y continuar/);
console.log('PASS A30 under-90 full follow-up, exact 90-day boundary, unpaid current charges only, future installments do not require promises.');
