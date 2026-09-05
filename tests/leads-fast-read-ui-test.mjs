import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const base = "http://127.0.0.1:4194";
const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const server = spawn(process.execPath,["node_modules/vite/bin/vite.js","--host","127.0.0.1","--port","4194","--strictPort"],{
  stdio:"pipe",windowsHide:true,env:{...process.env,VITE_SUPABASE_URL:"https://leads-tests.invalid",VITE_SUPABASE_ANON_KEY:"synthetic-test-key"}
});
let browser;
let cases=0;
const check=name=>{cases++;console.log("OK",name);};
const png="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jC2kAAAAASUVORK5CYII=";
const timestamp="2026-09-02T12:00:00.000Z";
const record=(id,cedula)=>({id,cedula,birthDate:"1990-01-01",age:36,attachmentName:"test.png",noCases:true,
  hasGpsTamperingReport:false,hasLegalCases:false,hasViolenceReports:false,hasDuiReports:false,hasPiracyReports:false,
  collisionReports:0,pendingDailyReports:0,decision:"aplica",extraDeposit:0,blockers:[],extraDepositReasons:[],createdAt:timestamp,updatedAt:timestamp});
const records=Array.from({length:55},(_,i)=>record(String(i).padStart(4,"0"),`8-100-${100+i}`));
const sellerRecords=Array.from({length:25},(_,i)=>({id:`seller-${String(i).padStart(3,"0")}`,user_id:owner,
  status:i===0?"pending_review":"reviewed",cedula:`7-100-${100+i}`,birth_date:"1990-01-01",attachment_name:"seller.png",
  evaluation_id:null,expires_at:timestamp,submitted_at:timestamp,created_at:timestamp,updated_at:timestamp}));
let releaseInitial;
const initialGate=new Promise(resolve=>releaseInitial=resolve);
let releaseCore;
const coreGate=new Promise(resolve=>releaseCore=resolve);
let corePending=0;
let initial=true, failList=false, failSearch=false, failDocument=false, holdSearch=null, holdList=null;
let documentReads=0,sellerDocumentReads=0;
const reads=[],writes=[],deletes=[];
try {
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error("Server startup timeout")),15000);
    server.stdout.on("data",chunk=>{if(chunk.toString().includes("4194")){clearTimeout(timer);resolve();}});
    server.on("error",reject);
  });
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  page.setDefaultTimeout(12000);
  const errors=[];
  page.on("pageerror",error=>{errors.push(error.message);console.error("Browser:",error.message);});
  await page.route("**/*",async route=>{
    const request=route.request();
    const url=new URL(request.url());
    if(url.origin===base){
      if(url.pathname==="/__lead-test" || url.pathname==="/leads") return route.fulfill({contentType:"text/html",body:`<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div><script type="module">
        import RefreshRuntime from '/@react-refresh';
        RefreshRuntime.injectIntoGlobalHook(window);
        window.$RefreshReg$ = () => {};
        window.$RefreshSig$ = () => type => type;
        window.__vite_plugin_react_preamble_installed__ = true;
        </script><script type="module" src="/tests/fixtures/${url.pathname==="/leads"?"leads-shell":"leads-performance"}.tsx"></script>`});
      return route.continue();
    }
    if(url.hostname!=="leads-tests.invalid") return route.abort();
    if(url.pathname.endsWith("/clients_cloud") || url.pathname.endsWith("/payments_cloud")) {
      corePending++;await coreGate;corePending--;return route.fulfill({json:[]});
    }
    if(url.pathname.endsWith("/rpc/read_lead_evaluations_page")){
      const input=request.postDataJSON();reads.push(input);
      if(initial && !input.p_cedula){initial=false;await initialGate;}
      if((input.p_cedula && failSearch)||(!input.p_cedula && failList)) return route.fulfill({status:500,json:{code:"57014",message:"timeout"}});
      if(input.p_cedula && holdSearch) await holdSearch;
      if(input.p_user_id===other)return route.fulfill({json:[]});
      let selected=[...records].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||b.id.localeCompare(a.id));
      if(input.p_cedula) selected=selected.filter(row=>row.cedula.replace(/-/g,"")===input.p_cedula.replace(/-/g,"")).slice(0,1);
      else selected=selected.filter(row=>!input.p_before_id||row.id<input.p_before_id).slice(0,21);
      const snapshot=selected.map(row=>({id:row.id,summary:row,updated_at:row.updatedAt}));
      if(!input.p_cedula && holdList) await holdList;
      return route.fulfill({json:snapshot});
    }
    if(url.pathname.endsWith("/lead_evaluations_cloud")){
      if(request.method()==="POST"){
        const body=request.postDataJSON();writes.push(body);const row=body.data;
        const index=records.findIndex(item=>item.id===row.id);
        const {attachmentDataUrl,...summary}=row;
        if(index>=0)records[index]=summary;else records.push(summary);
        return route.fulfill({status:201,json:null});
      }
      const id=url.searchParams.get("id")?.slice(3);
      if(request.method()==="DELETE"){deletes.push(id);records.splice(records.findIndex(row=>row.id===id),1);return route.fulfill({status:204});}
      assert.equal(url.searchParams.get("select"),"data");documentReads++;
      if(failDocument)return route.fulfill({status:500,json:{message:"timeout",code:"57014"}});
      return route.fulfill({json:{data:{...records.find(row=>row.id===id),attachmentDataUrl:png}}});
    }
    if(url.pathname.endsWith("/seller_lead_requests")){
      if(request.method()==="HEAD") {
        assert.equal(url.searchParams.get("status"),"eq.pending_review");
        return route.fulfill({status:200,headers:{"content-range":"*/1","access-control-expose-headers":"content-range"}});
      }
      const select=url.searchParams.get("select");
      if(url.searchParams.has("id")){
        sellerDocumentReads++;
        return route.fulfill({json:{...sellerRecords[0],attachment_data_url:png,token:"synthetic"}});
      }
      assert.ok(!select.includes("attachment_data_url"));assert.ok(!select.split(",").includes("token"));
      const start=Number(url.searchParams.get("offset")||0);
      assert.equal(Number(url.searchParams.get("limit")),21);
      return route.fulfill({json:url.searchParams.get("user_id")===`eq.${other}`?[]:sellerRecords.slice(start,start+21)});
    }
    return route.abort();
  });
  await page.goto(base+"/__lead-test");
  const query=page.getByLabel("Cedula",{exact:true});
  const consult=()=>page.getByRole("button",{name:"Consultar",exact:true});
  await query.waitFor();
  const sellersTab=page.getByRole("tab",{name:"Zona de vendedores",exact:true});
  const recentTab=page.getByRole("tab",{name:"Dictámenes recientes",exact:true});
  assert.equal(await sellersTab.getAttribute("aria-selected"),"true");
  assert.equal(await page.getByRole("tabpanel",{name:"Zona de vendedores"}).isVisible(),true);
  assert.equal(await page.locator("#lead-panel-recent").isVisible(),false);
  await sellersTab.press("ArrowRight");
  assert.equal(await recentTab.getAttribute("aria-selected"),"true");
  assert.equal(await recentTab.evaluate(element=>document.activeElement===element),true);
  assert.equal(await page.locator("#lead-panel-sellers").isVisible(),false);
  check("seller and recent tabs show one list at a time and support keyboard navigation");
  assert.equal(await query.isEnabled(),true);
  assert.equal(await consult().isEnabled(),true);
  assert.equal(await page.getByText("Aun no hay dictamenes guardados.").count(),0);
  assert.equal(documentReads,0);assert.equal(sellerDocumentReads,0);
  releaseInitial();
  await page.getByRole("button",{name:"Ver más dictámenes",exact:true}).waitFor();
  assert.equal(await page.locator(".lead-table tbody tr").count(),20);
  assert.equal(reads.filter(row=>!row.p_cedula).length,1);
  check("screen and search are usable before data arrives; first load is one bounded request with no documents");

  await page.getByRole("button",{name:"Ver más dictámenes",exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll(".lead-table tbody tr").length===40);
  assert.equal(reads[1].p_before_id,"0035");
  assert.equal(new Set(await page.locator(".lead-table tbody tr td:first-child").allTextContents()).size,40);
  await query.fill("8100100");await consult().click();
  await page.getByText("Esta registrado. Se cargo el dictamen anterior.").waitFor();
  assert.equal(documentReads,0);
  assert.equal(reads.at(-1).p_cedula,"8100100");
  check("load-more uses a cursor, and normalized server search finds a Lead beyond loaded history");

  failDocument=true;
  await page.getByRole("button",{name:"Ver documento",exact:true}).click();
  await page.getByText("No se pudo cargar el documento. Intenta nuevamente.").waitFor();
  failDocument=false;
  await page.getByRole("button",{name:"Ver documento",exact:true}).click();
  await page.getByRole("button",{name:"Ampliar documento adjunto",exact:true}).waitFor();
  assert.equal(documentReads,2);
  check("documents load only on demand, and a failed document read can be retried");

  await page.getByRole("button",{name:"Nuevo",exact:true}).click();
  await sellersTab.click();
  await page.getByRole("button",{name:"Ver más solicitudes",exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll(".lead-request-item").length===25);
  await page.getByRole("button",{name:"Revisar",exact:true}).click();
  await page.getByText("Informacion del vendedor cargada. Completa la revision interna.").waitFor();
  assert.equal(sellerDocumentReads,1);
  await page.getByRole("button",{name:"Ampliar documento adjunto",exact:true}).waitFor();
  check("seller list is paginated without attachments; reviewing loads only the selected document");
  await recentTab.click();
  assert.equal(await page.getByLabel("Fecha de nacimiento",{exact:true}).inputValue(),"1990-01-01");
  assert.equal(await page.getByRole("button",{name:"Ampliar documento adjunto",exact:true}).isVisible(),true);
  check("switching list tabs preserves the review and loaded document");

  await page.getByRole("button",{name:"Nuevo",exact:true}).click();
  failSearch=true;await query.fill("8999999");await consult().click();
  await page.getByText("No se pudo consultar la cédula. Intenta nuevamente antes de crear un Lead.").waitFor();
  assert.equal(await page.getByLabel("Fecha de nacimiento",{exact:true}).count(),0);
  failSearch=false;await consult().click();
  await page.getByText("No esta registrado. Completa la informacion para crear el Lead.").waitFor();
  // Another operator saved the same cedula between our search and our save.
  records.push(record("existing-concurrent","8-999-999"));
  await page.getByLabel("Fecha de nacimiento",{exact:true}).fill("1990-01-01");
  await page.locator("input[type=file]").setInputFiles({name:"test.png",mimeType:"image/png",buffer:Buffer.from(png.split(",")[1],"base64")});
  await page.getByLabel("Sin casos",{exact:true}).check();
  await page.getByText(/Dictamen cerrado automaticamente/).waitFor();
  assert.equal(writes.length,1);assert.equal(writes[0].id,"existing-concurrent");
  assert.equal(writes[0].data.attachmentDataUrl,png);assert.deepEqual(deletes,[]);
  assert.equal(records.filter(row=>row.cedula.replace(/-/g,"")==="8999999").length,1);
  check("failed search never becomes a new Lead; save rechecks cedula and changes only that record, preserving its document");

  page.once("dialog",dialog=>dialog.accept());
  await page.getByRole("button",{name:"Borrar",exact:true}).click();
  await page.getByText("Dictamen borrado.").waitFor();
  assert.deepEqual(deletes,["existing-concurrent"]);assert.equal(records.length,55);
  check("deleting a visible Lead leaves every unloaded historical record intact");

  failList=true;await page.getByRole("button",{name:"Actualizar dictámenes",exact:true}).click();
  await page.getByText(/No se pudieron cargar los dictámenes recientes/).waitFor();
  assert.equal(await consult().isEnabled(),true);
  await query.fill("8100101");await consult().click();
  await page.getByText("Esta registrado. Se cargo el dictamen anterior.").waitFor();
  failList=false;
  await page.getByRole("button",{name:"Nuevo",exact:true}).click();
  await page.getByRole("button",{name:"Actualizar dictámenes",exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll(".lead-table tbody tr").length===20);
  check("list timeout leaves search available and refresh recovers");

  let releaseList;holdList=new Promise(resolve=>releaseList=resolve);
  const listRequest=page.waitForRequest(request=>request.url().endsWith("/rpc/read_lead_evaluations_page")&&!request.postDataJSON().p_cedula);
  await page.getByRole("button",{name:"Actualizar dictámenes",exact:true}).click();await listRequest;
  const deletedCedula=await page.locator(".lead-table tbody tr").first().locator("td").first().innerText();
  page.once("dialog",dialog=>dialog.accept());
  await page.getByRole("button",{name:"Borrar",exact:true}).first().click();
  await page.getByText("Dictamen borrado.").waitFor();
  releaseList();holdList=null;
  await page.waitForFunction(()=>[...document.querySelectorAll("button")].find(button=>button.textContent==="Actualizar dictámenes")?.disabled===false);
  assert.equal(await page.locator(".lead-table tbody tr").filter({hasText:deletedCedula}).count(),0);
  check("a delayed list response cannot resurrect a Lead deleted while it was loading");

  let releaseSearch;holdSearch=new Promise(resolve=>releaseSearch=resolve);
  await query.fill("8100100");await consult().click();
  await page.getByRole("button",{name:"Consultando...",exact:true}).waitFor();
  await query.fill("8100102");releaseSearch();holdSearch=null;
  await consult().click();
  await page.getByText("Esta registrado. Se cargo el dictamen anterior.").waitFor();
  assert.equal(await query.inputValue(),"8-100-102");
  check("editing the cedula discards an older lookup response");

  await page.getByRole("button",{name:"Nuevo",exact:true}).click();
  mkdirSync(".tmp/leads-fast-read",{recursive:true});
  await page.screenshot({path:".tmp/leads-fast-read/desktop.png",fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:".tmp/leads-fast-read/mobile.png",fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  holdSearch=new Promise(resolve=>releaseSearch=resolve);
  await query.fill("8100100");await consult().click();
  await page.getByRole("button",{name:"Consultando...",exact:true}).waitFor();
  await page.getByRole("button",{name:"Cambiar dataset de prueba",exact:true}).click();
  releaseSearch();holdSearch=null;
  await page.getByText("Aun no hay dictamenes guardados.").waitFor();
  assert.equal(await page.locator(".lead-request-item").count(),0);
  assert.deepEqual(errors,[]);
  check("mobile layout fits and switching datasets clears cached Leads, seller requests and documents");

  await page.setViewportSize({width:1280,height:900});
  await page.goto(base+"/leads");
  await page.getByRole("heading",{name:"Leads",exact:true}).waitFor({timeout:4000});
  await page.getByRole("button",{name:"Consultar",exact:true}).waitFor();
  assert.ok(corePending>0,"Core data requests should still be pending");
  assert.equal(await page.getByText("Cargando data de nube...").count(),0);
  await page.screenshot({path:".tmp/leads-fast-read/app-sellers-tab.png",fullPage:true});
  await page.getByRole("tab",{name:"Dictámenes recientes",exact:true}).click();
  await page.getByRole("button",{name:"Ver más dictámenes",exact:true}).waitFor();
  await page.screenshot({path:".tmp/leads-fast-read/app-desktop.png",fullPage:true});
  assert.deepEqual(errors,[]);
  check("real AppShell displays Leads while client/payment bootstrap remains blocked");
  console.log(`PASS: ${cases} browser scenarios; no production requests or uncaught errors.`);
} finally { releaseInitial();if(browser)await browser.close();server.kill(); }
