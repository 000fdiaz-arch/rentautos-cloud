import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
const base='http://127.0.0.1:4203',pub='2026-09-05T12:00:00Z';
const amounts={A10:40,B79:68,C10:90,D92:204,T18:55};
const active=Object.entries(amounts).map(([unit,amount])=>({client_id:unit,in_custody:unit==='T18',custody_since:pub,data:{clientId:unit,unitId:unit,clientName:unit+' Cliente',releaseAmount:amount,routeAssignment:'PTY',publishedAt:pub,routeStartedAt:pub,overdueBalance:200,daysLate:2,rentAmount:34,partialDecisionRentAmount:unit==='A10'?32:undefined}}));
const reports=['A10','B79','C10','D92'].map(unit=>({id:unit,client_id:unit,published_at:pub,snapshot:active.find(x=>x.client_id===unit).data,status:['A10','B79'].includes(unit)?'confirmed':'review',method:'cash',amount:amounts[unit],cash_amount:amounts[unit],confirmed_cash_amount:['A10','B79'].includes(unit)?amounts[unit]:0,bank_amount:0,confirmed_bank_amount:0,reported_at:pub}));
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
    const snapshot={tabs:await panel.locator('.route-search-workflow-tabs').innerText(),views:{}};
    for(const label of ['Trabajo (1)','En revisión (2)','Pagos parciales a revisar (0)','Pagos confirmados (2)','Vehículo en custodia (1)']){
      await panel.getByRole('button',{name:label,exact:true}).click();
      snapshot.views[label]=await panel.locator('.route-collection-card').allInnerTexts();
    }
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
  await page.getByLabel('Mínimo original para liberar',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('Mínimo original para liberar',{exact:true}).inputValue(),'40');
  await page.getByText('$8.00',{exact:true}).waitFor();
  await page.screenshot({path:'.tmp/route-parity/accounts-editor.png',fullPage:true});
  assert.deepEqual(errors,[]);console.log('OK: both screens have identical tabs, units, amounts, review precedence and custody; B79 released by two partials, A10 remaining $8');
}finally{await browser?.close();server.kill();}
