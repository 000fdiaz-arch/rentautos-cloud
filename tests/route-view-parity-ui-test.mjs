import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
const base='http://127.0.0.1:4203',pub='2026-09-05T12:00:00Z';
const amounts={A10:40,B79:68,C10:90,D92:204,T18:55};
const active=Object.entries(amounts).map(([unit,amount])=>({client_id:unit,in_custody:unit==='T18',custody_since:pub,data:{clientId:unit,unitId:unit,clientName:unit+' Cliente',releaseAmount:amount,routeAssignment:unit==='A10'?'CL':unit==='C10'?'ROBADO':'PTY',zone:unit==='A10'?'Norte':undefined,publishedAt:pub,routeStartedAt:pub,overdueBalance:200,daysLate:2,rentAmount:34,partialDecisionRentAmount:unit==='A10'?32:undefined}}));
const reports=['A10','B79','C10','D92'].map(unit=>{const confirmed=['A10','B79'].includes(unit),bankDifference=unit==='A10';return {id:unit,client_id:unit,published_at:pub,snapshot:active.find(x=>x.client_id===unit).data,status:confirmed?'confirmed':'review',method:bankDifference?'bank':'cash',amount:amounts[unit],cash_amount:bankDifference?0:amounts[unit],confirmed_cash_amount:confirmed&&!bankDifference?amounts[unit]:0,bank_amount:bankDifference?amounts[unit]:0,confirmed_bank_amount:confirmed&&bankDifference?amounts[unit]:0,confirmed_bank_received_amount:bankDifference?amounts[unit]+0.1:0,confirmed_bank_savings_amount:bankDifference?0.1:0,reported_at:pub,confirmed_at:confirmed?new Date().toISOString():null};});
reports.push({...reports[1],id:'historical',client_id:'OLD',snapshot:{...reports[1].snapshot,clientId:'OLD',unitId:'OLD'},confirmed_at:'2020-01-01T12:00:00Z'});
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4203','--strictPort'],{windowsHide:true,stdio:'pipe',env:{...process.env,VITE_SUPABASE_URL:'https://tests.invalid',VITE_SUPABASE_ANON_KEY:'synthetic'}});
let browser;
try{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Vite timeout')),15000);server.stdout.on('data',data=>{if(data.toString().includes('4203')){clearTimeout(timer);resolve();}});});
  browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1280,height:900}});page.setDefaultTimeout(15000);page.setDefaultNavigationTimeout(60000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{
    const req=route.request(),url=new URL(req.url());
    if(url.origin===base){if(url.pathname==='/test')return route.fulfill({contentType:'text/html',body:`<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script><script type="module" src="/tests/fixtures/route-view-parity.tsx"></script>`});return route.continue();}
    if(url.hostname!=='tests.invalid')return route.abort();
    assert.ok(req.method()==='GET'||url.pathname.includes('/rpc/'),'No writes during comparison');
    if(url.pathname.endsWith('/active_route_items_cloud'))return route.fulfill({json:active});
    if(url.pathname.endsWith('/route_payment_reports'))return route.fulfill({json:reports});
    return route.fulfill({json:[]});
  });
  const snapshots=[];
  for(const mode of ['','?accounts']){
    await page.goto(base+'/test'+mode);
    if(mode)await page.getByRole('tab',{name:'Ruta en calle',exact:true}).click();
    const panel=page.locator('.route-search-page');
    await panel.getByRole('button',{name:'Trabajo (1)',exact:true}).waitFor();
    await panel.getByText('$8.00',{exact:true}).waitFor();
    assert.match(await panel.getByLabel('Rutas extra').innerText(),/CL\s+1/);
    await panel.locator('.route-collection-filters > summary').click();
    await panel.getByLabel('Filtrar por ruta').getByRole('button',{name:'CL',exact:true}).click();
    await panel.getByLabel('Filtrar por zona').getByRole('button',{name:'Norte (1)',exact:true}).click();
    await panel.getByLabel('Buscar').fill('A10');
    await panel.getByRole('button',{name:'En revisión (2)',exact:true}).click();
    assert.equal(await panel.getByLabel('Buscar').inputValue(),'A10');
    assert.equal(await panel.getByLabel('Filtrar por ruta').getByRole('button',{name:'CL',exact:true}).getAttribute('aria-pressed'),'true');
    assert.equal(await panel.getByLabel('Filtrar por zona').getByRole('button',{name:'Norte (0)',exact:true}).getAttribute('aria-pressed'),'true');
    await panel.getByRole('button',{name:'Trabajo (1)',exact:true}).click();
    assert.equal(await panel.getByLabel('Buscar').inputValue(),'A10');
    assert.equal(await panel.getByLabel('Filtrar por zona').getByRole('button',{name:'Norte (1)',exact:true}).getAttribute('aria-pressed'),'true');
    assert.equal(await panel.locator('.route-collection-card').count(),1);
    await panel.getByLabel('Filtrar por ruta').getByRole('button',{name:'Todas',exact:true}).click();
    await panel.getByLabel('Buscar').fill('');
    const snapshot={tabs:await panel.locator('.route-search-workflow-tabs').innerText(),views:{}};
    for(const label of ['Trabajo (1)','En revisión (2)','Pagos parciales a revisar (0)','Pagos confirmados (2)','Vehículo en custodia (1)']){
      await panel.getByRole('button',{name:label,exact:true}).click();
      snapshot.views[label]=await panel.locator('.route-collection-card').allInnerTexts();
    }
    await panel.getByRole('button',{name:'Pagos confirmados (2)',exact:true}).click();
    assert.equal(await panel.locator('.route-collection-card').count(),2);
    const confirmedDifference=panel.getByRole('article',{name:'A10 · A10 Cliente'});
    await confirmedDifference.getByText('Pago confirmado con diferencia',{exact:true}).waitFor();
    await confirmedDifference.getByText('$0.10 aplicado a ahorro',{exact:true}).waitFor();
    await panel.getByRole('button',{name:'Ver anteriores (1)',exact:true}).click();
    assert.equal(await panel.locator('.route-collection-card').count(),1);
    assert.match(await panel.locator('.route-collection-card').innerText(),/OLD/);
    await panel.getByRole('button',{name:'Ver recibo',exact:true}).waitFor();
    await panel.getByRole('button',{name:'Trabajo (1)',exact:true}).click();
    await panel.getByRole('button',{name:'Pagos confirmados (2)',exact:true}).click();
    assert.equal(await panel.locator('.route-collection-card').count(),2);
    snapshots.push(snapshot);
    mkdirSync('.tmp/route-parity',{recursive:true});
    await panel.getByRole('button',{name:'Trabajo (1)',exact:true}).click();
    await page.screenshot({path:'.tmp/route-parity/'+(mode?'accounts':'route')+'.png',fullPage:true});
  }
  assert.deepEqual(snapshots[0],snapshots[1]);
  assert.match(snapshots[0].views['Trabajo (1)'][0],/A10/);
  assert.ok(snapshots[0].views['En revisión (2)'].some(text=>text.includes('D92')));
  assert.equal(snapshots[0].views['Pagos parciales a revisar (0)'].length,0);
  await page.goto(base+'/test?accounts&editor');
  await page.getByRole('tab',{name:'Ruta en calle',exact:true}).click();
  const a10Card=page.getByRole('article',{name:'A10 · A10 Cliente'});
  await a10Card.getByLabel('Mínimo original para liberar',{exact:true}).waitFor();
  assert.equal(await a10Card.getByLabel('Mínimo original para liberar',{exact:true}).inputValue(),'40');
  await page.getByText('$8.00',{exact:true}).waitFor();
  await page.screenshot({path:'.tmp/route-parity/accounts-editor.png',fullPage:true});
  await page.clock.install({time:new Date()});
  await page.clock.setSystemTime(new Date(Date.now()+24*60*60*1000));
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await page.getByRole('button',{name:'Pagos confirmados (0)',exact:true}).click();
  assert.equal(await page.locator('.route-collection-card').count(),0);
  await page.getByRole('button',{name:'Ver anteriores (3)',exact:true}).click();
  assert.equal(await page.locator('.route-collection-card').count(),3);
  assert.deepEqual(errors,[]);console.log('OK: both screens have identical tabs, units, amounts, review precedence and custody; B79 released by two partials, A10 remaining $8');
}finally{await browser?.close();server.kill();}
