import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
const base='http://127.0.0.1:4201';
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4201','--strictPort'],{windowsHide:true,stdio:'pipe',env:{...process.env,VITE_SUPABASE_URL:'https://tests.invalid',VITE_SUPABASE_ANON_KEY:'synthetic'}});
let browser,page;let sent=[],active=[],fail=false;
let records={c1:{status:'pending',comment:'',isRouteTagged:true,updatedAt:'2026-09-05T12:00:00Z',routeReleaseAmount:40,managementAmount:40,routeAssignment:'PTY',managementType:'solo_cobrar'},c2:{status:'pending',comment:'',isRouteTagged:true,updatedAt:'2026-09-05T12:00:00Z'}};
try {
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Vite timeout')),15000);server.stdout.on('data',data=>{if(data.toString().includes('4201')){clearTimeout(timer);resolve();}});});
  browser=await chromium.launch({headless:true});page=await browser.newPage({viewport:{width:1280,height:900}});page.setDefaultTimeout(15000);page.setDefaultNavigationTimeout(60000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url());
    if(url.origin===base){
      if(url.pathname==='/test')return route.fulfill({contentType:'text/html',body:`<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script><script type="module" src="/tests/fixtures/route-auto-publish.tsx"></script>`});
      return route.continue();
    }
    if(url.hostname!=='tests.invalid')return route.abort();
    if(url.pathname.endsWith('/rpc/publish_prepared_route_item')){
      const input=req.postDataJSON();sent.push(input);
      if(fail)return route.fulfill({status:500,json:{message:'Test network failure'}});
      assert.equal(input.p_expected_updated_at,records[input.p_item.clientId].updatedAt,'Must use saved record');
      let item=active.find(item=>item.client_id===input.p_item.clientId);
      if(!item){item={client_id:input.p_item.clientId,data:{...input.p_item,publishedAt:new Date().toISOString()}};active.push(item);}
      return route.fulfill({json:item.data});
    }
    if(url.pathname.endsWith('/street_management_items_cloud')){
      if(req.method()==='POST'){for(const row of req.postDataJSON())records[row.client_id]=row.data;return route.fulfill({status:201});}
      return route.fulfill({json:Object.entries(records).map(([client_id,data])=>({client_id,data}))});
    }
    if(url.pathname.endsWith('/active_route_items_cloud')){assert.equal(req.method(),'GET','No direct republish');return route.fulfill({json:active});}
    if(req.method()==='GET'||url.pathname.includes('/rpc/'))return route.fulfill({json:[]});
    throw Error('Unexpected mutation '+url.pathname);
  });
  await page.goto(base+'/test?readonly');await page.getByRole('heading',{name:'Cuentas por cobrar',exact:true}).waitFor();await page.waitForTimeout(1100);assert.equal(sent.length,0);
  await page.goto(base+'/test');await page.getByRole('status').filter({hasText:'T01 · Enviada a ruta.'}).waitFor();
  assert.equal(sent.length,1);assert.equal(active.length,1,'Incomplete unit remains unpublished');
  assert.equal(await page.getByRole('button',{name:/Publicar ruta/}).count(),0);
  await page.getByRole('button',{name:/Descargar ruta/}).waitFor();
  const publishedAt=active[0].data.publishedAt;
  await page.reload();await page.waitForTimeout(1100);assert.equal(sent.length,1);assert.equal(active[0].data.publishedAt,publishedAt);
  await page.getByRole('button',{name:'Completar ruta',exact:true}).click();
  const modal=page.getByRole('dialog');await modal.getByLabel('Saldo para liberar de T02').fill('55');
  await page.waitForTimeout(1100);assert.equal(sent.length,1);
  fail=true;await modal.getByLabel(/^Ruta/).selectOption('WC');
  await page.getByRole('alert').filter({hasText:'No se pudo confirmar el envío de T02'}).waitFor();
  await page.waitForTimeout(1100);assert.equal(sent.length,2,'No infinite retry loop');
  await modal.getByRole('button',{name:'Cerrar',exact:true}).click();
  fail=false;await page.getByRole('button',{name:'Reintentar envío',exact:true}).click();
  await page.getByRole('status').filter({hasText:'T02 · Enviada a ruta.'}).waitFor();
  assert.equal(active.length,2);assert.equal(active[1].data.releaseAmount,55);assert.equal(active[1].data.routeAssignment,'WC');
  const beforeDownload=sent.length;
  await page.getByRole('combobox',{name:'Formato para descargar cobro en ruta'}).selectOption('excel');
  const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:/Descargar ruta/}).click();await downloaded;
  assert.equal(sent.length,beforeDownload,'Download never publishes');
  mkdirSync('.tmp/route-auto',{recursive:true});await page.screenshot({path:'.tmp/route-auto/desktop.png',fullPage:true});
  assert.deepEqual(errors,[]);console.log('OK: automatic ready-only send, saved fields, read-only guard, reload idempotency, failed send and retry, download only');
}catch(error){console.error((await page?.locator('body').innerText())?.slice(0,3500));throw error;}finally{await browser?.close();server.kill();}
