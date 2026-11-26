import assert from 'node:assert/strict';
import fs from 'node:fs';
import { build } from 'esbuild';
import { chromium } from 'playwright';

// Exercise the production gate, sorting and components with local fixture data.
// No Supabase connection or real customer writes.
const source = fs.readFileSync('src/pages/ReceivablesV2Page.tsx', 'utf8');
const gate = source.match(/const mustAttendOverduePromises = ([^;]+);/)[1];
const order = source.match(/const essentialRows = useMemo\(\(\) => \(\s*([^\n]+)\s*\), \[baseRows\]\);/)[1];
const compiled = await build({
  stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
import React,{useState,useRef} from 'react';
import {createRoot} from 'react-dom/client';
import {ReceivablesLedgerTable} from './src/pages/receivablesV2/ReceivablesLedgerTable';
import {PendingPromises,orderedPendingPromises} from './src/pages/receivablesV2/PendingPromises';
import {firstContactSummary} from './src/pages/receivablesV2/FirstContactSummary';
import {promiseFollowup} from './src/pages/receivablesV2/promiseFollowup';
import {createMockReceivableRows} from './src/receivablesV2';
const collector=new URLSearchParams(location.search).get('collector') || 'collector-1';
const [group,other]=collector==='collector-1'?['C','E']:['D','T'];
const today='2026-11-26',scope='priority-order-'+collector;
const baseRows=[other+'01',group+'07',group+'02',group+'01'].map(id=>({
  ...createMockReceivableRows(new Date(today+'T15:00:00Z'))[0],id,unitId:id,name:id,
  operationalStatus:'activo',hasActiveClient:true,totalPending:20,overdueBalance:20,
  rentAmount:20,totalOtherCharges:0,recentPayments:[],lastPaymentDate:null
}));
const rows=${order};
const originalDate=collector==='collector-1'?today:'2026-11-25';
const initial={[group+'07']:{status:'pending',comment:'',updatedAt:originalDate+'T14:00:00Z',
  contactOutcomes:[{collector,date:originalDate,at:originalDate+'T14:00:00Z',result:'promise',
    promiseDate:today,promiseTime:'10:00',promiseAmount:20}]}};
const read=(key,fallback)=>JSON.parse(localStorage.getItem(key)||JSON.stringify(fallback));
function App(){
  const [now,setNow]=useState(()=>new Date(read('fixture-time',today+'T14:59:59Z')));
  const [records,setRecords]=useState(()=>read('fixture-records',initial));
  const [payments,setPayments]=useState(()=>read('fixture-payments',[]));
  const scroll=useRef(null);
  const entries=firstContactSummary({rows,records,collector,today,reviews:{}}).entries;
  const firstContactEntries=entries;
  const pendingPromiseItems=orderedPendingPromises(rows.map(row=>({row,followup:promiseFollowup(records[row.id],collector,payments.filter(p=>p.clientId===row.id),now)})),now);
  const mustAttendOverduePromises=${gate};
  const noop=()=>{};
  async function save(id,result,followup,promise){
    if(localStorage.getItem('fixture-fail'))throw Error('Fallo de guardado de prueba');
    const agreement=promise || (result==='promise' && followup?{date:followup.nextDate,time:followup.nextTime,amount:followup.amount}:null);
    const entry={date:today,at:now.toISOString(),collector,result,followupOf:followup?.promiseAt,
      promiseDate:agreement?.date,promiseTime:agreement?.time,promiseAmount:agreement?.amount};
    const next={...records,[id]:{...records[id],status:'pending',comment:'',updatedAt:entry.at,
      ...(agreement?{paymentPromiseDate:agreement.date,paymentPromiseTime:agreement.time,paymentPromiseAmount:agreement.amount}:{}),
      contactOutcomes:[...(records[id]?.contactOutcomes||[]),entry]}};
    localStorage.setItem('fixture-records',JSON.stringify(next));setRecords(next);
  }
  const props={rows,progressScope:scope,tableScrollRef:scroll,viewMode:'cartera',workflowTab:'management',
    selectedHistoryDate:today,selectedHistoryRows:[],collectionStatusByClient:records,
    dailyContactCloudAttemptsByClient:{},dailyContactSaveStatesByClient:{},clientStatusById:new Map(),
    tenureByClient:new Map(rows.map(row=>[row.id,{label:'2 años',days:730}])),
    todayDateKey:today,now,isTodayCollectionClosed:false,todayCollectionCuts:{},visibleCollectionCut:'all',
    firstContactManagedIds:new Set(entries.filter(e=>e.category!=='pending').map(e=>e.row.id)),
    buildWhatsAppReceivableMessage:()=>'',getWhatsAppGroupRows:()=>undefined,getStatementGroupRows:()=>undefined,
    onSelectDetail:noop,onCollectionCutStatusChange:noop,onCollectionCutCommentChange:noop,onRouteTagChange:()=>false,
    onRouteManagementTypeChange:noop,onRouteManagementCommentChange:noop,onRouteAssignmentChange:noop,
    onRouteUrgencyChange:noop,onRouteReleaseAmountChange:noop,onRemoveFromRoute:noop,onWhatsAppMessageSent:noop,
    onSupportNoteChange:noop,onContactTimeChange:noop,onPaymentPromiseDateChange:noop,onPaymentPromiseTimeChange:noop,
    onPaymentPromiseAmountChange:noop,onGpsLocationReview:async()=>{},onContactOutcome:save,collectorKey:collector,payments,
    onPersistPendingChanges:noop,onDailyContactAttemptChange:noop,onOperationalReviewChange:noop,
    onOpenRoutePreparation:noop,onOpenRoute:noop,onClearFilters:noop};
  return <>
    <button id="expire" onClick={()=>{localStorage.setItem('fixture-time',JSON.stringify(today+'T15:00:00Z'));setNow(new Date(today+'T15:00:00Z'));}}>Vencer promesa</button>
    <button id="partial" onClick={()=>{const next=[{id:'partial',clientId:group+'07',amountReceived:5,createdAt:today+'T14:00:00Z'}];localStorage.setItem('fixture-payments',JSON.stringify(next));setPayments(next);}}>Abonar cinco</button>
    <p id="managed">{entries.filter(e=>e.category!=='pending').length}</p>
    <PendingPromises required={mustAttendOverduePromises} items={pendingPromiseItems} now={now} today={today} scope={scope} disabled={false} onSave={save}/>
    <ReceivablesLedgerTable {...props}/>
  </>;
}
createRoot(document.getElementById('root')).render(<App/>);
` },
  bundle: true, write: false, format: 'iife', jsx: 'automatic',
  loader: { '.css': 'empty' }, define: { 'import.meta.env': '{}' }
});

const browser = await chromium.launch({ headless: true });
try {
  for (const [collector, group, other] of [['collector-1', 'C', 'E'], ['collector-2', 'D', 'T']]) {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.route('https://fixture.invalid/**', route => route.fulfill({
      contentType: 'text/html', body: '<html><body><div id="root"></div><script>' + compiled.outputFiles[0].text + '</script></body></html>'
    }));
    await page.goto('https://fixture.invalid/?collector=' + collector);
    const current = page.locator('.ar-ledger-pagination--top .ar-ledger-pagination-status > strong');
    const amount = page.locator('.ar-deposit-promise-field input[type=number]');
    await current.waitFor();
    assert.equal(await current.textContent(), group + '01');
    assert.equal(await page.locator('dialog').count(), 0, 'Future promise must not block');
    await page.getByPlaceholder('Información de este contacto…').fill('Borrador de ' + group + '01');
    await amount.fill('37.50');
    await page.locator('#expire').click();
    const dialog = page.locator('dialog');
    await dialog.waitFor();
    assert.equal(await page.locator('#managed').textContent(), collector === 'collector-1' ? '1' : '0', 'Priority lock applies while the first round is still pending');
    assert.equal(await dialog.evaluate(element => element.matches(':modal')), true);
    await page.keyboard.press('Escape');
    assert.equal(await dialog.evaluate(element => element.matches(':modal')), true);
    await dialog.getByRole('button', { name: 'Ver', exact: true }).click();
    // Realtime partial payments update the lock without moving the portfolio cursor.
    await page.evaluate(() => document.querySelector('#partial').click());
    await dialog.getByText('$15.00', { exact: true }).waitFor();
    assert.equal(await current.textContent(), group + '01');
    await dialog.getByRole('textbox', { name: 'Fecha (día/mes/año)' }).fill('27/11/2026');
    await dialog.getByRole('textbox', { name: 'Hora del depósito, del 1 al 12' }).fill('6');
    await dialog.getByRole('button', { name: 'PM', exact: true }).click();
    await dialog.getByRole('spinbutton', { name: 'Monto acordado' }).fill('15');
    await page.evaluate(() => localStorage.setItem('fixture-fail', 'yes'));
    await dialog.getByRole('button', { name: 'Guardar seguimiento y continuar' }).click();
    await dialog.getByText('Fallo de guardado de prueba').waitFor();
    assert.equal(await dialog.evaluate(element => element.matches(':modal')), true);
    await page.evaluate(() => localStorage.removeItem('fixture-fail'));
    await dialog.getByRole('button', { name: 'Guardar seguimiento y continuar' }).click();
    await dialog.waitFor({ state: 'detached' });
    assert.equal(await current.textContent(), group + '01');
    assert.equal(await page.getByPlaceholder('Información de este contacto…').inputValue(), 'Borrador de ' + group + '01');
    assert.equal(await amount.inputValue(), '37.50');

    const saveCurrent = async () => {
      await page.getByRole('checkbox', { name: 'No contestó, se dejó mensaje' }).check();
      await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    };
    await saveCurrent();
    await current.filter({ hasText: group + '02' }).waitFor();
    await page.reload();
    await current.filter({ hasText: group + '02' }).waitFor();
    await saveCurrent();
    await current.filter({ hasText: group + '07' }).waitFor();
    const agreement = page.getByRole('region', { name: 'Acuerdo pactado' });
    await agreement.waitFor();
    await agreement.getByText('$15.00', { exact: true }).first().waitFor();
    await agreement.getByText('27/11/2026 · 18:00 (hora de Panamá)', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Guardar', exact: true }).count(), 0, 'Show the saved agreement without requiring another promise');
    await page.reload();
    await agreement.waitFor();
    assert.equal(await current.textContent(), group + '07');
    await page.locator('.ar-ledger-pagination--top').getByRole('button', { name: 'Siguiente' }).click();
    await current.filter({ hasText: other + '01' }).waitFor();
    await page.reload();
    await current.filter({ hasText: other + '01' }).waitFor();
    const history = await page.evaluate(id => JSON.parse(localStorage.getItem('fixture-records'))[id].contactOutcomes, group + '07');
    assert.equal(history.length, 2, 'Reading the saved agreement must not duplicate contact history');
    assert.equal(history[1].followupOf, history[0].at);
    assert.equal(history[1].promiseAmount, 15);
    assert.deepEqual(pageErrors, []);
    await page.close();
  }
  console.log('PASS both collectors: overdue priority before first contacts, exact deadline, partial payment and failed save keep lock, drafts/cursor preserved, 01 → 02 → 07 (saved agreement) → next group, reload stable, no duplicate history. Offline fixture.');
} finally {
  await browser.close();
}
