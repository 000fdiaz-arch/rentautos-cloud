import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
const base='http://127.0.0.1:4197';
const owner='11111111-1111-4111-8111-111111111111';
const seeker='22222222-2222-4222-8222-222222222222';
const item={clientId:'c1',unitId:'RA-042',clientName:'Carlos',routeAssignment:'PTY',zone:'Centro',releaseAmount:60,pendingAmount:120,overdueBalance:120,rentAmount:30,daysLate:4,publishedAt:'2026-09-04T12:00:00Z',routeStartedAt:'2026-09-04T12:00:00Z'};
let reports=[],fail=false,writes=[],routeChanges=[],inactiveChanges=[];
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4197','--strictPort'],{windowsHide:true,stdio:'pipe',env:{...process.env,VITE_SUPABASE_URL:'https://route-tests.invalid',VITE_SUPABASE_ANON_KEY:'synthetic-test-key'}});
let browser;
try {
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Vite timeout')),15000);server.stdout.on('data',x=>{if(x.toString().includes('4197')){clearTimeout(timer);resolve();}});server.on('error',reject);});
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:390,height:844}});page.setDefaultTimeout(30000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url());
    if(url.origin===base){
      if(url.pathname==='/__route-test')return route.fulfill({contentType:'text/html',body:`<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script><script type="module" src="/tests/fixtures/route-reports.tsx"></script>`});
      return route.continue();
    }
    if(url.hostname!=='route-tests.invalid')return route.abort();
    if(url.pathname.endsWith('/payments_cloud') || url.pathname.endsWith('/rpc/read_route_pending_cash_page')) throw Error('El resumen debe reutilizar los pagos compartidos, sin consultas adicionales.');
    if(url.pathname.endsWith('/active_route_items_cloud'))return route.fulfill({json:[{client_id:'c1',data:item}]});
    if(url.pathname.endsWith('/notified_payments_cloud'))return route.fulfill({json:[]});
    if(url.pathname.endsWith('/route_payment_reports'))return route.fulfill({json:reports});
    if(url.pathname.endsWith('/rpc/change_active_route_assignment')){
      const input=req.postDataJSON();routeChanges.push(input);
      if(fail)return route.fulfill({status:400,json:{message:'La ruta cambió. Actualiza.'}});
      item.routeAssignment=input.p_route;return route.fulfill({status:204});
    }
    if(url.pathname.endsWith('/rpc/set_active_route_inactive_status')){
      const input=req.postDataJSON();inactiveChanges.push(input);
      if(fail)return route.fulfill({status:400,json:{message:'La unidad cambió. Actualiza.'}});
      const declared=input.p_inactive?'2026-09-06T15:30:00Z':null;
      if(declared)item.routeInactiveAt=declared;else delete item.routeInactiveAt;
      return route.fulfill({json:declared});
    }
    if(url.pathname.endsWith('/rpc/report_route_payment_split')){
      const input=req.postDataJSON();writes.push(input);
      if(fail)return route.fulfill({status:400,json:{message:'La unidad cambió. Actualiza la ruta.'}});
      reports=[{id:'r1',user_id:owner,client_id:'c1',published_at:item.publishedAt,snapshot:item,amount:input.p_cash_amount+input.p_bank_amount,
        method:input.p_cash_amount>0&&input.p_bank_amount>0?'mixed':input.p_cash_amount>0?'cash':'bank',cash_amount:input.p_cash_amount,bank_amount:input.p_bank_amount,confirmed_cash_amount:0,confirmed_bank_amount:0,
        status:'review',reported_by:seeker,reporter_name:'Ana',reported_at:new Date().toISOString(),confirmed_at:null}];
      return route.fulfill({status:204});
    }
    if(url.pathname.endsWith('/rpc/cancel_route_payment_report')){reports=[];return route.fulfill({status:204});}
    throw Error('Unexpected request: '+req.method()+' '+url.pathname);
  });
  await page.goto(base+'/__route-test');
  const picker=page.getByRole('combobox',{name:'Ruta de RA-042'});
  await picker.selectOption('WC');await page.getByRole('status').filter({hasText:'RA-042 cambió a WC.'}).waitFor();
  assert.equal(routeChanges.at(-1).p_previous_route,'PTY');assert.equal(await picker.inputValue(),'WC');
  await page.getByRole('button',{name:'Deshacer'}).click();await page.getByRole('status').filter({hasText:'RA-042 volvió a PTY.'}).waitFor();
  assert.equal(routeChanges.at(-1).p_previous_route,'WC');assert.equal(await picker.inputValue(),'PTY');
  fail=true;await picker.selectOption('WC');await page.getByRole('alert').filter({hasText:'No se pudo cambiar la ruta.'}).waitFor();
  assert.equal(await picker.inputValue(),'PTY');fail=false;
  await page.getByRole('button',{name:'Marcar Inactivo'}).click();
  await page.getByText('Inactivo · no está encendido',{exact:true}).waitFor();
  await page.getByText(/Declarado 06 sept 2026/).waitFor();
  await page.getByText(/^Hace /).waitFor();
  assert.equal(await page.getByRole('alert').count(),0);
  assert.equal(inactiveChanges.at(-1).p_inactive,true);
  const teamSummary=page.getByRole('region',{name:'Resumen del equipo'});
  assert.match(await teamSummary.innerText(),/PTY[\s\S]*0[\s\S]*Por visitar[\s\S]*1[\s\S]*Inactivos/);
  mkdirSync('.tmp/route-reports',{recursive:true});await page.screenshot({path:'.tmp/route-reports/mobile-inactive-summary.png',fullPage:true});
  await page.getByRole('button',{name:'Marcar como disponible'}).click();
  await page.getByRole('status').filter({hasText:'RA-042 volvió a estar disponible.'}).waitFor();
  assert.equal(inactiveChanges.at(-1).p_inactive,false);
  const cashPanel=page.getByRole('region',{name:'Efectivo pendiente de entrega'});
  await cashPanel.locator('summary').getByText('$45.25',{exact:true}).waitFor();
  await cashPanel.locator('summary').getByText('$30.00',{exact:true}).waitFor();
  await cashPanel.locator('summary').filter({hasText:'WC'}).click();
  await cashPanel.getByText('REC-old · 01/01/2020',{exact:true}).waitFor();
  assert.equal(await cashPanel.getByRole('button').count(),0);
  await page.evaluate(() => window.dispatchEvent(new Event('test:deliver-cash')));
  await cashPanel.getByText('$0.00',{exact:true}).waitFor();
  assert.equal(await cashPanel.getByText('REC-old · 01/01/2020',{exact:true}).count(),0);
  await cashPanel.locator('summary').getByText('$30.00',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Reportar que pagó',exact:true}).click();
  const modal=page.getByRole('dialog');await modal.waitFor();
  await modal.getByRole('button',{name:'Enviar a revisión'}).click();assert.equal(writes.length,0);
  await modal.getByLabel('Cuánto pagó ($)').fill('75.25');await modal.getByLabel('Cómo pagó').selectOption('bank');
  fail=true;await modal.getByRole('button',{name:'Enviar a revisión'}).click();await modal.getByRole('alert').waitFor();assert.equal(reports.length,0);
  fail=false;await modal.getByRole('button',{name:'Enviar a revisión'}).click();await modal.waitFor({state:'hidden'});
  assert.equal(writes.at(-1).p_bank_amount,75.25);assert.equal(writes.at(-1).p_cash_amount,0);
  await page.getByRole('button',{name:'Trabajo (0)',exact:true}).waitFor();
  await page.getByRole('button',{name:'En revisión (1)',exact:true}).click();
  await page.getByText('Pago reportado · Pendiente de confirmar',{exact:true}).waitFor();
  assert.match(await page.locator('.route-search-report-status').innerText(),/75.25.*Banca/);
  assert.equal(await page.getByRole('button',{name:'Registrar pago',exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:'Sacar de ruta',exact:true}).count(),0);
  await page.screenshot({path:'.tmp/route-reports/mobile-review.png',fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.getByRole('button',{name:'Devolver a Trabajo',exact:true}).click();
  await page.getByRole('button',{name:'Trabajo (1)',exact:true}).click();
  await page.getByRole('button',{name:'Reportar que pagó',exact:true}).click();
  await modal.getByLabel('Cuánto pagó ($)').fill('60');await modal.getByLabel('Cómo pagó').selectOption('cash');
  await modal.getByRole('button',{name:'Enviar a revisión'}).click();await modal.waitFor({state:'hidden'});
  reports[0].status='confirmed';reports[0].confirmed_at=new Date().toISOString();
  item.removedAt=new Date().toISOString();
  await page.getByRole('button',{name:'Actualizar',exact:true}).click();
  await page.getByRole('button',{name:'Pagos confirmados (1)',exact:true}).click();
  await page.getByText('Pago confirmado',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Devolver a Trabajo',exact:true}).count(),0);
  await page.setViewportSize({width:1280,height:900});await page.screenshot({path:'.tmp/route-reports/desktop-confirmed.png',fullPage:true});
  reports=[];delete item.removedAt;
  await page.goto(base+'/__route-test');
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:'Reportar que pagó',exact:true}).click();
  await modal.getByLabel('Cómo pagó').selectOption('mixed');
  await modal.getByLabel('Cuánto en efectivo ($)').fill('40');
  const beforeMixed=writes.length;
  await modal.getByRole('button',{name:'Enviar a revisión'}).click();assert.equal(writes.length,beforeMixed);
  await modal.getByLabel('Cuánto por banca ($)').fill('60');
  await modal.getByText('Total reportado: $100.00',{exact:true}).waitFor();
  await page.screenshot({path:'.tmp/route-reports/mobile-mixed-form.png',fullPage:true});
  await modal.getByRole('button',{name:'Enviar a revisión'}).click();await modal.waitFor({state:'hidden'});
  assert.equal(writes.at(-1).p_cash_amount,40);assert.equal(writes.at(-1).p_bank_amount,60);
  await page.getByRole('button',{name:'En revisión (1)',exact:true}).click();
  await page.getByText('Efectivo: $40.00 · Pendiente',{exact:true}).waitFor();
  reports[0].confirmed_cash_amount=40;
  await page.getByRole('button',{name:'Actualizar',exact:true}).click();
  await page.getByText('Efectivo: $40.00 · Confirmado',{exact:true}).waitFor();
  await page.getByText('Banca: $60.00 · Pendiente',{exact:true}).waitFor();
  await page.getByRole('button',{name:'En revisión (1)',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:'.tmp/route-reports/mobile-mixed-review.png',fullPage:true});
  reports=[];
  await page.goto(base+'/__route-test?readonly');
  await page.getByRole('button',{name:'Trabajo (1)',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Reportar que pagó',exact:true}).count(),0);
  assert.equal(await page.getByRole('combobox',{name:'Ruta de RA-042'}).count(),0);
  assert.equal(await page.getByRole('button',{name:'Marcar Inactivo'}).count(),0);
  assert.deepEqual(errors,[]);console.log('OK: WC/PTY from shared payments, zero extra queries, historical receipts, live delivered removal, read-only; report form, mixed split and confirmation');
} finally {await browser?.close();server.kill();}
