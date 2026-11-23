import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const base=process.env.ROUTE_TEST_BASE??'http://127.0.0.1:5174';
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage({viewport:{width:390,height:844}});
 page.setDefaultNavigationTimeout(60000);
 page.setDefaultTimeout(45000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
 const fixture=base+'/tests/fixtures/outside-route-cash.html';
 for(const mode of ['']) {
  for(const viewport of [{width:360,height:800},{width:768,height:1024},{width:1366,height:768}]) {
   await page.setViewportSize(viewport);
   await page.goto(fixture+'?operator=delta1'+mode);
   await page.evaluate(()=>sessionStorage.clear());await page.reload();
   try { await page.getByRole('button',{name:'Trabajo (1)',exact:true}).waitFor(); }
   catch(error) { console.error({mode,viewport,errors,body:await page.locator('body').innerText()});throw error; }
   const card=page.getByRole('article',{name:'A10 · Pedro González',exact:true});
   const button=card.getByRole('button',{name:'Declarar en custodia Solo si el auto fue despojado del conductor',exact:true});
   await button.waitFor();
   assert.equal(await card.locator('.route-collection-more-actions').count(),0,'Custody is visible without opening More actions');
   const box=await button.boundingBox();assert.ok(box.height>=44&&box.x>=0&&box.x+box.width<=viewport.width);
   await button.click();
   const dialog=page.getByRole('dialog',{name:'Declarar en custodia',exact:true});
   await dialog.getByText('Confirma solo si el auto fue despojado del conductor y está bajo custodia.',{exact:true}).waitFor();
   await dialog.getByText('Esta acción no registra ningún pago.',{exact:true}).waitFor();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await dialog.getByRole('button',{name:'Cancelar',exact:true}).click();
   assert.equal(await page.evaluate(()=>window.__custodyRequests.length),0);
   await button.click();
   await page.evaluate(()=>{window.__failCustody=true;});
   await dialog.getByRole('button',{name:'Sí, declarar en custodia',exact:true}).click();
   await dialog.getByRole('alert').waitFor();assert.equal(await card.count(),1);
   await page.evaluate(()=>{window.__failCustody=false;});
   await dialog.getByRole('button',{name:'Sí, declarar en custodia',exact:true}).evaluate(button=>{button.click();button.click();});
   await dialog.waitFor({state:'hidden'});
   await page.getByRole('button',{name:'Trabajo (0)',exact:true}).waitFor();
   assert.equal(await page.evaluate(()=>window.__custodyRequests.length),2,'One failed attempt and one successful declaration, without duplicate requests');
   assert.equal(await page.evaluate(()=>window.__declarationRequests.length),0,'Custody does not declare or charge money');
   assert.equal(await page.evaluate(()=>window.__outsideCalls??0),0);
   await page.getByRole('button',{name:'Gestionados hoy (1)',exact:true}).click();
   const result=page.locator('.route-managed-compact-row');assert.match(await result.innerText(),/A10/);assert.match(await result.innerText(),/En custodia/);
  }
  await page.goto(fixture+'?operator=delta1'+mode);
  await page.getByRole('button',{name:/Declarar en custodia Solo/}).click();
  await page.evaluate(()=>{window.__outsideRouteRows.find(r=>r.client_id==='active').data.assignedDelta='delta3';});
  const dialog=page.getByRole('dialog',{name:'Declarar en custodia',exact:true});
  await dialog.getByRole('button',{name:'Sí, declarar en custodia',exact:true}).click();
  await dialog.getByRole('alert').waitFor();
  assert.equal(await page.evaluate(()=>Boolean(window.__outsideRouteRows.find(r=>r.client_id==='active').in_custody)),false);
  for(const params of ['?operator=delta1&readonly','?delta=delta1']) {
   await page.goto(fixture+params+mode);
   await page.getByRole('button',{name:'Trabajo (1)',exact:true}).waitFor();
   assert.equal(await page.getByRole('button',{name:/Declarar en custodia Solo/}).count(),0,'Preview and disabled accounts cannot declare');
  }
 }
 assert.deepEqual(errors,[]);
 console.log('Delta custody UI: visible button, phone/tablet/laptop, clear confirmation, cancel/retry, no duplicate or payment, managed result and reassignment protection OK');
} finally {await browser.close();}
