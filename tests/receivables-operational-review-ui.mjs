import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const compiled=await build({stdin:{contents:'export {ReceivablesLedgerTable} from "./src/pages/receivablesV2/ReceivablesLedgerTable"; export {createMockReceivableRows} from "./src/receivables";',resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'cjs',write:false,loader:{'.css':'empty'},external:['react','react-dom'],define:{'import.meta.env.DEV':'false'},plugins:[{name:'offline',setup(b){b.onResolve({filter:/lib\/supabase$/},()=>({path:'test-client',external:true}));}}]});
const require=createRequire(import.meta.url);const module={exports:{}};const storage=new Map();
vm.runInNewContext(compiled.outputFiles[0].text,{React,module,exports:module.exports,require:n=>n==='test-client'?{supabase:null}:require(n),console,Date,Intl,URL,TextEncoder,TextDecoder,localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)}});
const {ReceivablesLedgerTable,createMockReceivableRows}=module.exports;
const now=new Date('2026-11-18T15:00:00Z');
const row={...createMockReceivableRows(now)[0],id:'test',unitId:'A01',operationalStatus:'taller',hasActiveClient:true,totalPending:100};
const props={progressScope:'test',tableScrollRef:{current:null},viewMode:'ledger',workflowTab:'management',selectedHistoryDate:'',selectedHistoryRows:[],rows:[row],collectionStatusByClient:{},dailyContactCloudAttemptsByClient:{},dailyContactSaveStatesByClient:{},clientStatusById:new Map(),tenureByClient:new Map(),todayDateKey:'2026-11-18',now,isTodayCollectionClosed:false,todayCollectionCuts:{},visibleCollectionCut:'all',collectorKey:'collector-1',payments:[],isUnitStatusConfirmed:()=>false};
function render(extra={}) {return renderToStaticMarkup(React.createElement(ReceivablesLedgerTable,{...props,viewMode:'cartera',buildWhatsAppReceivableMessage:()=>'',getWhatsAppGroupRows:()=>[],getStatementGroupRows:()=>[],...extra}));}
let html=render();
assert.match(html,/VALIDACIÓN DEL ESTADO/);
assert.doesNotMatch(html,/¿Cuándo, a qué hora/);
assert.doesNotMatch(html,/Verifica esta unidad en el GPS/);
assert.doesNotMatch(html,/<button[^>]*disabled=""[^>]*title="Valida y guarda el estado real/);
html=render({isUnitStatusConfirmed:()=>true});
assert.match(html,/Estado validado y guardado/);
assert.doesNotMatch(html,/<button[^>]*disabled=""[^>]*title="Valida y guarda/);
for(const operationalStatus of ['libre','chapisteria','custodia','archivado','provisional_rental','otro']) {
  html=render({rows:[{...row,operationalStatus,totalPending:0}]});assert.match(html,/VALIDACIÓN DEL ESTADO/);
}
html=render({rows:[{...row,operationalStatus:'activo'}]});
assert.doesNotMatch(html,/VALIDACIÓN DEL ESTADO/);assert.match(html,/depositar/i);
html=render({rows:[{...row,operationalStatus:'activo',totalPending:0,totalOtherCharges:0,outstandingFineAmount:0,outstandingTicketAmount:0}]});
assert.match(html,/Verifica esta unidad en el GPS/);
console.log('PASS: real ledger rendering prioritizes every non-active state over debt/GPS; temporary navigation without validation allowed; active flow preserved.');

const timeKey='cxc.v2.workday.v1:test:collector-1:2026-11-18:draft:test';
storage.set(timeKey+':hour',JSON.stringify('10'));
storage.set(timeKey+':time',JSON.stringify('10:00'));
function hourAt(time, records={}) {
  const markup=render({now:new Date(time),rows:[{...row,operationalStatus:'activo'}],collectionStatusByClient:records});
  return markup.match(/id="deposit-hour-test"[^>]*value="([^"]*)"/)[1];
}
assert.equal(hourAt('2026-11-18T16:24:00Z'),'12'); // 11:24 AM Panama -> noon
assert.equal(hourAt('2026-11-18T17:01:00Z'),'1');
const noonMarkup=render({now:new Date('2026-11-18T16:24:00Z'),rows:[{...row,operationalStatus:'activo'}]});
assert.match(noonMarkup,/aria-pressed="true">p\. m\./);
const midnightMarkup=render({now:new Date('2026-11-19T04:24:00Z'),rows:[{...row,operationalStatus:'activo'}]});
assert.match(midnightMarkup,/id="payment-promise-date-test"[^>]*value="2026-11-19"/);
assert.match(midnightMarkup,/aria-pressed="true">a\. m\./);
storage.set(timeKey+':time-edited','true');
assert.equal(hourAt('2026-11-18T16:21:00Z'),'10'); // explicit user draft is preserved
storage.clear();
assert.equal(hourAt('2026-11-18T16:21:00Z',{test:{status:'pending',comment:'',paymentPromiseDate:'2026-11-18',paymentPromiseTime:'10:00',paymentPromiseAmount:20}}),'10');
console.log('PASS: next full Panama hour, noon and next-day midnight; manual time and saved promises stay unchanged.');

storage.clear();
const secondProps = {rows:[{...row,operationalStatus:'activo'}],initialProgress:{selectedRowId:'test',retryIds:['test']},collectionStatusByClient:{test:{status:'pending',comment:'',contactOutcomes:[{date:'2026-11-18',at:'2026-11-18T14:15:00Z',collector:'collector-1',result:'no_answer'}]}}};
html=render(secondProps);
assert.match(html,/Segunda vuelta · Segundo intento de contacto/);
assert.match(html,/En el primer intento no contestó y se dejó mensaje a las/);
assert.match(html,/9:15/);
assert.match(html,/Prometió pagar/);
assert.match(html,/Sigue sin contestar/);
assert.match(html,/<button[^>]*disabled=""[^>]*>Guardar segundo intento y continuar/);
assert.doesNotMatch(html,/id="payment-promise-date-test"/);
storage.set(timeKey+':second:second-outcome',JSON.stringify('promise'));
storage.set(timeKey+':second:no-answer','false');
html=render(secondProps);
assert.match(html,/id="payment-promise-date-test"/);
storage.set(timeKey+':second:second-outcome',JSON.stringify('no_answer'));
storage.set(timeKey+':second:no-answer','true');
html=render(secondProps);
assert.doesNotMatch(html,/id="payment-promise-date-test"/);
assert.match(html,/<button[^>]*class="ar-deposit-promise-save"[^>]*>Guardar segundo intento y continuar/);
assert.doesNotMatch(html,/<button[^>]*class="ar-deposit-promise-save"[^>]*disabled/);
console.log('PASS: second round shows previous contact time, explicit result, restored draft and conditional promise fields.');
storage.clear();
for(const result of ['promise','no_answer']) {
  const record={...secondProps.collectionStatusByClient.test,contactOutcomes:[...secondProps.collectionStatusByClient.test.contactOutcomes,{date:'2026-11-18',at:'2026-11-18T15:00:00Z',collector:'collector-1',result}],paymentPromiseDate:'2026-11-18',paymentPromiseTime:'12:00',paymentPromiseAmount:50};
  html=render({...secondProps,collectionStatusByClient:{test:record}});
  assert.match(html,new RegExp(`<option value="${result}" selected="">`));
  assert.equal(html.includes('id="payment-promise-date-test"'),result==='promise');
}
console.log('PASS: reopening second-round results restores both saved outcomes without a local draft.');
storage.clear();
const receipt={id:'receipt',clientId:'test',amountReceived:40,createdAt:'2026-11-18T14:30:00Z'};
const paidProps={rows:[{...row,operationalStatus:'activo'}],payments:[receipt]};
html=render(paidProps);
assert.doesNotMatch(html,/clientes con pagos por revisar/);
assert.doesNotMatch(html,/Ver pagos recibidos|Ver promesas pendientes/);
assert.doesNotMatch(html,/Guardar decisión y continuar/);
storage.set('cxc.v2.workday.v1:test:collector-1:2026-11-18:payment-review',JSON.stringify('test'));
html=render(paidProps);
assert.match(html,/Pago recibido · A01/);
assert.match(html,/Cerrar gestión por hoy/);
assert.match(html,/Continuar con una nueva promesa/);
assert.match(html,/\$40\.00/);
assert.doesNotMatch(html,/¿Cuándo, a qué hora/);
storage.clear();
html=render({...paidProps,collectionStatusByClient:{test:{status:'pending',comment:'',contactOutcomes:[{date:'2026-11-18',at:now.toISOString(),collector:'collector-1',result:'closed_today'}]}}});
assert.doesNotMatch(html,/clientes con pagos por revisar/);
assert.doesNotMatch(html,/Información de cuenta de A01/);
console.log('PASS: payment alert preserves current form, review offers both decisions, closed client disappears for today.');
