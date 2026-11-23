import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const base=process.env.ROUTE_TEST_BASE??'http://127.0.0.1:5174';
const browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
  for(const mode of ['']) {
    await page.goto(`${base}/tests/fixtures/outside-route-cash.html?zones${mode}`);
    await page.getByRole('button',{name:'Trabajo (5)',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:/^Declarar /}).count(),0);
    assert.equal(await page.locator('.route-search-workflow-tabs > button').count(),4);
    const views=page.getByRole('group',{name:'Ver vista de Delta'});
    await views.getByRole('button',{name:'Delta 1',exact:true}).click();
    await page.getByRole('button',{name:'Trabajo (4)',exact:true}).waitFor();
    assert.equal(await page.locator('.route-search-workflow-tabs > button').count(),2);
    assert.equal(await page.getByRole('button',{name:/Cambiar acción de/}).count(),0);
    assert.equal(await page.getByRole('button',{name:/^Declarar /}).count(),0);
    await page.getByLabel('Filtrar por ruta',{exact:true}).selectOption('WC');
    assert.equal(await page.locator('.route-collection-card').count(),1);
    assert.match(await page.locator('.route-collection-card').innerText(),/A11/);
    assert.equal(await views.getByRole('button',{name:'Delta 1',exact:true}).getAttribute('aria-pressed'),'true');
    await views.getByRole('button',{name:'Delta 3',exact:true}).click();
    assert.equal(await page.locator('.route-collection-card').count(),1);
    assert.match(await page.locator('.route-collection-card').innerText(),/B20/);
    await views.getByRole('button',{name:'Delta 2',exact:true}).click();
    await page.getByRole('button',{name:'Trabajo (0)',exact:true}).waitFor();
    assert.equal(await page.locator('.route-collection-card').count(),0);
    await views.getByRole('button',{name:'Admin',exact:true}).click();
    await page.getByRole('button',{name:'Trabajo (5)',exact:true}).waitFor();
    const action=page.getByRole('button',{name:'Cambiar acción de A10',exact:true});
    await action.click();
    const choices=page.getByRole('group',{name:'Acción solicitada para A10',exact:true});
    await page.evaluate(()=>{window.__failManagement=true;});
    await choices.getByRole('button',{name:'Desiste',exact:true}).click();
    await page.getByRole('alert').filter({hasText:/otro dispositivo/}).waitFor();
    assert.match(await action.innerText(),/Cobrar o quitar/);
    await page.evaluate(()=>{window.__failManagement=false;});
    await action.click();
    await choices.getByRole('button',{name:'Desiste',exact:true}).click();
    await page.waitForFunction(()=>window.__managementEdits.length===1);
    assert.match(await action.innerText(),/Desiste/);
    const request=await page.evaluate(()=>window.__managementEdits[0]);
    assert.equal(request.p_previous_type,'cobrar_o_quitar');
    assert.equal(request.p_management_type,'desiste');
    assert.equal(request.p_version,mode.includes('v2')?'v2':'legacy');
    for(const viewport of [{width:360,height:800},{width:390,height:844},{width:768,height:1024},{width:1024,height:768},{width:1366,height:768}]) {
      await page.setViewportSize(viewport);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`Admin fits ${viewport.width}px`);
      for(const control of [views,page.getByLabel('Buscar',{exact:true}),page.getByLabel('Filtrar por ruta',{exact:true})]) {
        const box=await control.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=viewport.width+1,`Filter fits ${viewport.width}px`);
      }
    }
    await page.setViewportSize({width:1280,height:900});
    await page.goto(`${base}/tests/fixtures/outside-route-cash.html?operator=delta1${mode}`);
    await page.getByRole('button',{name:'Trabajo (1)',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:/^Declarar /}).count(),3);
    assert.equal(await page.getByRole('group',{name:'Ver vista de Delta'}).count(),0);
    assert.equal(await page.getByRole('button',{name:/Cambiar acción de/}).count(),0);
    for(const viewport of [{width:360,height:800},{width:768,height:1024},{width:1366,height:768}]) {
      await page.setViewportSize(viewport);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`Delta fits ${viewport.width}px`);
      await page.getByRole('button',{name:'Declarar transferencia · SOLO UNIDADES EN RUTA',exact:true}).click();
      const dialog=page.getByRole('dialog',{name:'Declarar transferencia',exact:true});
      const box=await dialog.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=viewport.width+1);
      await dialog.getByRole('button',{name:'Cerrar',exact:true}).click();
    }
    await page.setViewportSize({width:1280,height:900});
  }
  assert.deepEqual(errors,[]);
  console.log('Admin controls: simple view buttons, route scope, empty Delta, action edit/failure, declarations only for operators and mobile OK');
} finally {await browser.close();}
