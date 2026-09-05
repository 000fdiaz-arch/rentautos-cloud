import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import {chromium} from 'playwright';

const base='http://127.0.0.1:4195';
const owner='11111111-1111-4111-8111-111111111111';
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4195','--strictPort'],{
  stdio:'pipe',windowsHide:true,env:{...process.env,VITE_SUPABASE_URL:'https://badge-tests.invalid',VITE_SUPABASE_ANON_KEY:'synthetic-test-key'}
});
let browser;
let pending=37,failed=false,hold=null,requests=0;
try {
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Server timeout')),15000);
    server.stdout.on('data',data=>{if(data.toString().includes('4195')){clearTimeout(timer);resolve();}});
    server.on('error',reject);
  });
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  page.setDefaultTimeout(10000);
  const errors=[];page.on('pageerror',error=>{errors.push(error.message);console.error(error.message);});
  page.on('console',message=>{if(message.type()==='warning')console.log(message.text());});
  await page.route('**/*',async route=>{
    const req=route.request();const url=new URL(req.url());
    if(url.origin===base){
      if(url.pathname==='/__badge-test')return route.fulfill({contentType:'text/html',body:`<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module">
        import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);
        window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
        </script><script type="module" src="/tests/fixtures/leads-review-badge.tsx"></script>`});
      return route.continue();
    }
    if(url.hostname!=='badge-tests.invalid')return route.abort();
    assert.ok(url.pathname.endsWith('/seller_lead_requests'));
    if(req.method()==='PATCH') {
      assert.ok(['reviewed','incomplete'].includes(req.postDataJSON().status));pending--;
      return route.fulfill({status:204});
    }
    assert.equal(req.method(),'HEAD');
    assert.equal(url.searchParams.get('select'),'id');
    assert.equal(url.searchParams.get('status'),'eq.pending_review');
    assert.equal(url.searchParams.has('limit'),false);
    assert.match(req.headers().prefer,/count=exact/);
    requests++;
    const total=url.searchParams.get('user_id')===`eq.${owner}`?pending:2;
    if(hold)await hold;
    return route.fulfill({status:failed?500:200,headers:failed?{}:{'content-range':`*/${total}`,'access-control-expose-headers':'content-range'}});
  });
  await page.goto(base+'/__badge-test');
  const badge=page.locator('.app-nav-tabs a[href="/leads"] .nav-tab-badge');
  await badge.waitFor();
  assert.equal(await badge.innerText(),'37');
  assert.equal(await badge.getAttribute('aria-label'),'37 licencias pendientes de revisión');
  assert.equal(await page.locator('.app-nav-tabs a[href="/pagos"]').getAttribute('aria-current'),'page');
  console.log('OK total across all pending requests appears in Leads while another page is active; count-only query');
  await page.getByRole('button',{name:'Publicar prueba',exact:true}).click();
  await badge.getByText('36',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Corregir prueba',exact:true}).click();
  await badge.getByText('35',{exact:true}).waitFor();
  console.log('OK publication and correction immediately update the badge');
  failed=true;
  const response=page.waitForResponse(r=>r.request().method()==='HEAD');
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await response;
  assert.equal(await badge.innerText(),'35');
  failed=false;pending=0;
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await badge.waitFor({state:'detached'});
  console.log('OK failed refresh preserves the last count and a successful zero clears the badge');
  pending=105;
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await badge.getByText('99+',{exact:true}).waitFor();
  assert.equal(await badge.getAttribute('title'),'105 licencias pendientes de revisión');
  mkdirSync('.tmp/leads-review-badge',{recursive:true});
  await page.screenshot({path:'.tmp/leads-review-badge/desktop.png'});
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:'Más',exact:false}).click();
  const mobile=page.getByRole('dialog',{name:'Más opciones'}).locator('a[href="/leads"] em');
  assert.equal(await mobile.innerText(),'99+');
  assert.equal(await mobile.getAttribute('aria-label'),'105 licencias pendientes de revisión');
  await page.screenshot({path:'.tmp/leads-review-badge/mobile.png'});
  console.log('OK desktop and mobile badges expose the full pending count accessibly');
  await page.setViewportSize({width:1280,height:900});
  let release;hold=new Promise(resolve=>release=resolve);
  const started=page.waitForRequest(r=>r.method()==='HEAD');
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await started;
  await page.getByRole('button',{name:'Cambiar dataset',exact:true}).click();
  await badge.waitFor({state:'detached'});
  release();hold=null;
  await badge.getByText('2',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Retirar permiso',exact:true}).click();
  assert.equal(await page.locator('.app-nav-tabs a[href="/leads"]').count(),0);
  const countBefore=requests;
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  assert.equal(requests,countBefore);
  assert.deepEqual(errors,[]);
  console.log('OK dataset switch ignores stale results; permission removal stops counting and hides Leads');
  console.log('PASS: 5 badge browser scenarios; all external requests mocked.');
} finally {if(browser)await browser.close();server.kill();}
