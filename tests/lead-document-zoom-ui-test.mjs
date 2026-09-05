import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const base = "http://127.0.0.1:4193";
const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "4193", "--strictPort"], {
  stdio: "pipe", windowsHide: true,
  env: {...process.env, VITE_PERSISTENCE_MODE:"LOCAL_ONLY", VITE_RENTAUTOS_TEST_BYPASS_AUTH:"1"}
});
let browser;
let cases = 0;
const check = name => { cases++; console.log("OK", name); };
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Local test server did not start")), 15000);
    server.stdout.on("data", chunk => { if (chunk.toString().includes("4193")) { clearTimeout(timer); resolve(); } });
    server.on("error", reject);
    server.on("exit", code => { if (code) reject(new Error("Server exited: " + code)); });
  });
  browser = await chromium.launch({headless:true});
  const page = await browser.newPage({viewport:{width:1280,height:900}});
  page.setDefaultTimeout(12000);
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.route("**/*", route => route.request().url().startsWith(base) ? route.continue() : route.abort());
  await page.goto(base + "/leads");
  await page.getByLabel("Cedula", {exact:true}).fill("8-888-888");
  await page.getByRole("button", {name:"Consultar",exact:true}).click();

  // Synthetic document generated for testing, never a real person's document.
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width=1600; canvas.height=1000;
    const ctx=canvas.getContext("2d");
    ctx.fillStyle="#fff";ctx.fillRect(0,0,1600,1000);
    ctx.strokeStyle="#0f766e";ctx.lineWidth=20;ctx.strokeRect(30,30,1540,940);
    ctx.fillStyle="#0f172a";ctx.font="bold 70px sans-serif";
    ctx.fillText("DOCUMENTO DE PRUEBA",90,150);
    ctx.font="40px sans-serif";ctx.fillText("Datos ficticios para verificar el zoom",90,240);
    ctx.fillStyle="#ccfbf1";ctx.fillRect(90,310,350,500);
    ctx.fillStyle="#334155";ctx.font="32px sans-serif";
    for(let i=0;i<7;i++) ctx.fillText("Detalle de prueba " + (i+1),510,380+i*65);
    return canvas.toDataURL("image/png");
  });
  await page.locator("input[type=file]").setInputFiles({name:"documento-prueba.png",mimeType:"image/png",buffer:Buffer.from(dataUrl.split(",")[1],"base64")});
  const open = page.getByRole("button",{name:"Ampliar documento adjunto",exact:true});
  await open.click();
  const dialog = page.getByRole("dialog",{name:"Verificar documento"});
  await dialog.waitFor();
  const image = dialog.getByRole("img");
  await image.evaluate(img => img.decode());
  await page.waitForFunction(() => document.querySelector(".lead-document-canvas img")?.getBoundingClientRect().width > 0);
  assert.equal(await dialog.getByRole("button",{name:"Reducir imagen",exact:true}).isDisabled(),true);
  const initialWidth = (await image.boundingBox()).width;
  assert.equal(await page.locator("body").evaluate(el=>el.style.overflow),"hidden");
  check("photo opens in a modal fitted to screen, background scrolling locked");

  const zoomIn = dialog.getByRole("button",{name:"Ampliar imagen",exact:true});
  await zoomIn.click();
  await zoomIn.click();
  assert.equal(await dialog.locator("output").innerText(),"150%");
  assert.ok((await image.boundingBox()).width > initialWidth*1.4);
  check("zoom increases displayed dimensions using the original image");

  for(let i=0;i<10;i++) await zoomIn.click();
  assert.equal(await dialog.locator("output").innerText(),"400%");
  assert.equal(await zoomIn.isDisabled(),true);
  const viewport=dialog.getByLabel("Imagen del documento ampliada",{exact:true});
  const scrollBefore=await viewport.evaluate(el=>({left:el.scrollLeft,top:el.scrollTop}));
  const bounds=await viewport.boundingBox();
  await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);
  await page.mouse.down();
  await page.mouse.move(bounds.x+bounds.width/2-110,bounds.y+bounds.height/2-80,{steps:5});
  await page.mouse.up();
  const scrollAfter=await viewport.evaluate(el=>({left:el.scrollLeft,top:el.scrollTop}));
  assert.ok(scrollAfter.left>scrollBefore.left || scrollAfter.top>scrollBefore.top);
  check("400 percent cap and dragging to inspect offscreen details");

  await dialog.getByRole("button",{name:"Ajustar a pantalla",exact:true}).click();
  assert.equal(await dialog.locator("output").innerText(),"100%");
  assert.ok(Math.abs((await image.boundingBox()).width-initialWidth)<3);
  check("fit-to-screen restores initial size");

  await page.keyboard.press("Escape");
  await dialog.waitFor({state:"detached"});
  assert.equal(await open.evaluate(el=>document.activeElement===el),true);
  assert.equal(await page.locator("body").evaluate(el=>el.style.overflow),"");
  await open.press("Enter");
  await dialog.waitFor();
  assert.equal(await dialog.locator("output").innerText(),"100%");
  await dialog.getByRole("button",{name:"Cerrar",exact:true}).click();
  await dialog.waitFor({state:"detached"});
  check("Escape, keyboard activation, close button and focus restoration");

  await page.setViewportSize({width:390,height:844});
  await open.click();
  await dialog.waitFor();
  await page.waitForFunction(()=>document.querySelector(".lead-document-canvas img")?.getBoundingClientRect().width>0);
  const mobileDialog=await dialog.boundingBox();
  assert.ok(mobileDialog.x>=0 && mobileDialog.x+mobileDialog.width<=390);
  assert.ok(mobileDialog.y>=0 && mobileDialog.y+mobileDialog.height<=844);
  await dialog.getByRole("button",{name:"Ampliar imagen",exact:true}).click();
  assert.equal(await dialog.locator("output").innerText(),"125%");
  mkdirSync(".tmp/lead-document-zoom",{recursive:true});
  await page.screenshot({path:".tmp/lead-document-zoom/mobile.png"});
  await dialog.getByRole("button",{name:"Cerrar",exact:true}).click();
  check("mobile modal and zoom controls stay within the screen");

  await page.setViewportSize({width:1280,height:900});
  await open.click();
  await page.screenshot({path:".tmp/lead-document-zoom/desktop.png"});
  // Click native backdrop, outside the dialog rectangle.
  await page.mouse.click(2,2);
  await dialog.waitFor({state:"detached"});
  assert.deepEqual(errors,[]);
  check("backdrop closes viewer; no uncaught browser errors");
  console.log(`PASS: ${cases} document zoom browser scenarios.`);
} finally {
  if(browser) await browser.close();
  server.kill();
}
