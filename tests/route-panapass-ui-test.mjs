import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const base=process.env.ROUTE_TEST_BASE??'http://127.0.0.1:5185';
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage({viewport:{width:1366,height:768}});page.setDefaultTimeout(45000);page.setDefaultNavigationTimeout(60000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
 const fixture=base+'/tests/fixtures/outside-route-cash.html';
 for(const mode of ['']) {
  await page.goto(fixture+'?demo'+mode);await page.evaluate(()=>sessionStorage.clear());await page.reload();
  await page.getByRole('button',{name:'Trabajo (2)',exact:true}).waitFor();
  const card=page.getByRole('article',{name:'A10 · Pedro González',exact:true});
  const logo=card.getByRole('img',{name:'En ruta por deuda de Panapass',exact:true});
  assert.equal(await page.getByRole('img',{name:'En ruta por deuda de Panapass',exact:true}).count(),0);
  await card.getByText('Más acciones',{exact:true}).click();
  await card.getByRole('button',{name:'Marcar deuda de Panapass',exact:true}).click();
  await logo.waitFor();
  assert.equal(await card.locator('.route-collection-more-actions').getAttribute('open'),null);
  assert.equal(await page.getByRole('dialog').count(),0,'The mark requires only two clicks, without an extra confirmation');
  const edits=await page.evaluate(()=>window.__panapassEdits);assert.equal(edits.length,1);assert.equal(edits[0].p_panapass,true);assert.equal(edits[0].p_previous,false);assert.equal(edits[0].p_version,mode.includes('v2')?'v2':'legacy');
  assert.equal(await page.getByRole('article',{name:'B20 · Ana López',exact:true}).getByRole('img').count(),0,'Unmarked units have no logo');
  const image=await logo.evaluate(el=>({loaded:el.complete&&el.naturalWidth>0,width:el.width,height:el.height}));assert.deepEqual(image,{loaded:true,width:72,height:24});
  await page.reload();await logo.waitFor();
  for(const viewport of [{width:360,height:800},{width:768,height:1024},{width:1366,height:768}]) {
   await page.setViewportSize(viewport);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   const b=await logo.boundingBox();assert.ok(b.width<=80&&b.height<=28);
  }
  await page.getByRole('group',{name:'Ver vista de Delta',exact:true}).getByRole('button',{name:'Delta 1',exact:true}).click();
  await logo.waitFor();assert.equal(await card.getByRole('button',{name:/marca Panapass|deuda de Panapass/}).count(),0);
  await page.goto(fixture+'?operator=delta1'+mode);await logo.waitFor();
  assert.equal(await card.getByRole('button',{name:/marca Panapass|deuda de Panapass/}).count(),0,'Deltas see the logo but cannot change the admin reason');
  await page.goto(fixture+'?demo'+mode);await logo.waitFor();
  await card.getByText('Más acciones',{exact:true}).click();
  await page.evaluate(()=>{window.__failPanapass=true;});
  await card.getByRole('button',{name:'Quitar marca Panapass',exact:true}).click();
  await page.getByRole('alert').filter({hasText:/Panapass/}).waitFor();assert.equal(await logo.count(),1);
  await page.evaluate(()=>{window.__failPanapass=false;});
  await card.getByText('Más acciones',{exact:true}).click();await card.getByRole('button',{name:'Quitar marca Panapass',exact:true}).click();
  await logo.waitFor({state:'hidden'});await page.reload();assert.equal(await logo.count(),0);
 }
 assert.deepEqual(errors,[]);console.log('Panapass UI: two-click admin mark/removal, only marked units, exact supplied logo, persistence, Delta/preview read-only visibility, failure retry and phone/tablet/laptop OK');
}finally{await browser.close();}
