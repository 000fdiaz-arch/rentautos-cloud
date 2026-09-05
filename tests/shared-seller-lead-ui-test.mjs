import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

// A local browser test with all Supabase calls mocked. No production data is sent.
const base = "http://127.0.0.1:4192";
const portal = "11111111-1111-4111-8111-111111111111";
const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "4192", "--strictPort"], { stdio: "pipe", windowsHide: true });
let browser;
let cases = 0;
const check = (name) => { cases++; console.log("OK", name); };
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Local server did not start")), 15000);
    server.stdout.on("data", chunk => { if (chunk.toString().includes("4192")) { clearTimeout(timer); resolve(); } });
    server.on("error", reject);
    server.on("exit", code => { if (code) reject(new Error("Server exited " + code)); });
  });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  let decision = "aplica";
  let status = "reviewed";
  let rateLimit = false;
  let slow = false;
  let sent = 0;
  await page.route("**/*", async route => {
    const request = route.request();
    if (request.url().startsWith(base)) return route.continue();
    if (request.url().includes("/rest/v1/rpc/")) {
      const name = request.url().split("/").pop();
      if (rateLimit) return route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ message: "PORTAL_RATE_LIMIT" }) });
      if (slow) await new Promise(resolve => setTimeout(resolve, 250));
      if (name === "submit_shared_seller_lead") {
        sent++;
        const input = request.postDataJSON();
        assert.equal(input.p_cedula, "8-888-888");
        assert.equal(input.p_birth_date, "1990-01-01");
        assert.match(input.p_attachment_data_url, /^data:image\/png;base64,/);
        return route.fulfill({ json: {status:"pending_review"} });
      }
      if (name === "get_seller_lead_request") return route.fulfill({ json: {status:"reviewed",decision:"aplica",extraDeposit:0} });
      assert.equal(name, "lookup_seller_lead");
      return route.fulfill({ json: status === "reviewed" ? {status,decision,extraDeposit:decision === "aplica_con_abono" ? 150 : 0} : {status} });
    }
    return route.abort();
  });
  await page.goto(base + "/consulta-vendedores/" + portal);
  const cedula = page.getByLabel("Cédula de la persona");
  const consult = page.getByRole("button", {name:"Consultar",exact:true});
  assert.equal(await page.getByText("Iniciar sesion").count(), 0);
  await cedula.fill("PE-1234");
  assert.equal(await cedula.inputValue(), "");
  await cedula.fill("8-888-888");
  await cedula.press("End");
  await cedula.pressSequentially("a@ ._é");
  assert.equal(await cedula.inputValue(), "8-888-888");
  await cedula.fill("8 888 888");
  assert.equal(await cedula.inputValue(), "8-888-888");
  await cedula.press("End");
  await cedula.press("Backspace");
  assert.equal(await cedula.inputValue(), "8-888-88");
  await cedula.pressSequentially("8");
  check("cedula accepts digits and hyphens, rejects invalid typing/paste, and allows editing");
  await consult.click();
  await page.getByText("¡Listo! Puedes avanzar con el proceso de esta persona.", {exact:true}).waitFor();
  check("anonymous route and gentle positive message");

  decision = "aplica_con_abono";
  await consult.click();
  await page.getByText(/Se requiere un abono adicional/).waitFor();
  assert.match(await page.locator(".seller-lead-result").innerText(), /150/);
  decision = "no_aplica";
  await consult.click();
  await page.getByText(/Por el momento no es posible avanzar/).waitFor();
  assert.equal(await page.getByText(/Se requiere un abono adicional/).count(), 0);
  assert.doesNotMatch(await page.locator("body").innerText(), /SI APLICA|NO APLICA|APLICA CON ABONO/);
  check("extra deposit and gentle negative message without hard verdict labels");

  status = "pending_review";
  await consult.click();
  await page.getByText(/La información de esta persona está en revisión/).waitFor();
  assert.equal(await page.getByLabel("Fecha de nacimiento").count(), 0);
  check("pending result cannot create another request");

  status = "not_found";
  await consult.click();
  await page.getByLabel("Fecha de nacimiento").fill("1990-01-01");
  await page.locator("input[type=file]").setInputFiles({
    name:"sample.png", mimeType:"image/png", buffer:Buffer.from("iVBORw0KGgo=", "base64")
  });
  await page.getByRole("button", {name:"Enviar a verificación",exact:true}).click();
  await page.getByText(/La información de esta persona está en revisión/).waitFor();
  assert.equal(sent, 1);
  check("new person form submits only identity fields and then locks");

  status = "incomplete";
  await consult.click();
  await page.getByText(/Falta completar la verificación/).waitFor();
  assert.equal(await page.getByLabel("Fecha de nacimiento").inputValue(), "");
  assert.doesNotMatch(await page.locator("body").innerText(), /PRIVATE NOTE|SECRET/);
  check("correction asks for fresh documents, does not reveal private data");

  status = "reviewed"; decision = "aplica"; slow = true;
  await consult.click();
  await cedula.fill("9-999-999");
  await page.waitForTimeout(350);
  assert.equal(await page.locator(".seller-lead-result").count(), 0);
  slow = false;
  check("changing cedula discards stale responses and prior personal data");

  rateLimit = true;
  await consult.click();
  await page.getByRole("alert").filter({hasText:/límite de consultas/}).waitFor();
  rateLimit = false;
  await consult.click();
  await page.getByText("¡Listo! Puedes avanzar con el proceso de esta persona.", {exact:true}).waitFor();
  check("rate-limit feedback and successful retry");

  mkdirSync(".tmp/lead-portal-tests/screenshots", {recursive:true});
  await page.screenshot({path:".tmp/lead-portal-tests/screenshots/desktop.png",fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:".tmp/lead-portal-tests/screenshots/mobile.png",fullPage:true});
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  check("mobile layout has no horizontal overflow");

  await page.goto(base + "/consulta-vendedor/" + portal);
  await page.getByText("¡Listo! Puedes avanzar con el proceso de esta persona.", {exact:true}).waitFor();
  check("old private links still work with seller-oriented copy");
  assert.deepEqual(errors, []);
  console.log(`PASS: ${cases} browser scenarios, no uncaught browser errors.`);
} finally {
  if (browser) await browser.close();
  server.kill();
}
