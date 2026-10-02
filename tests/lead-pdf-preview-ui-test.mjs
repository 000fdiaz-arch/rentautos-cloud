import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const base = "http://127.0.0.1:4195";
const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "4195", "--strictPort"], {
  stdio: "pipe", windowsHide: true,
  env: { ...process.env, VITE_PERSISTENCE_MODE: "LOCAL_ONLY", VITE_RENTAUTOS_TEST_BYPASS_AUTH: "1" }
});
let browser;
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Local test server did not start")), 15000);
    server.stdout.on("data", (chunk) => { if (chunk.toString().includes("4195")) { clearTimeout(timer); resolve(); } });
    server.on("error", reject);
    server.on("exit", (code) => { if (code) reject(new Error("Server exited: " + code)); });
  });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(12000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => route.request().url().startsWith(base) ? route.continue() : route.abort());
  await page.goto(base + "/leads", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.getByLabel("Cedula", { exact: true }).fill("8-888-889");
  await page.getByRole("button", { name: "Consultar", exact: true }).click();

  const pdf = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF");
  await page.locator("input[type=file]").setInputFiles({ name: "documento-prueba.pdf", mimeType: "application/pdf", buffer: pdf });
  const open = page.getByRole("button", { name: "Ver PDF adjunto", exact: true });
  await open.waitFor();
  assert.match(await open.innerText(), /documento-prueba\.pdf/);
  assert.match(await open.innerText(), /Ver PDF/);

  await open.click();
  const dialog = page.getByRole("dialog", { name: "Verificar documento PDF" });
  await dialog.waitFor();
  const frame = dialog.locator("iframe");
  await frame.waitFor();
  assert.match(await frame.getAttribute("src"), /^blob:/);
  assert.equal(await frame.getAttribute("title"), "Documento PDF para verificar: documento-prueba.pdf");
  assert.equal(await dialog.getByRole("link", { name: "Descargar PDF", exact: true }).getAttribute("download"), "documento-prueba.pdf");
  assert.equal(await page.locator("body").evaluate((element) => element.style.overflow), "hidden");

  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  assert.equal(await open.evaluate((element) => document.activeElement === element), true);
  assert.equal(await page.locator("body").evaluate((element) => element.style.overflow), "");
  assert.deepEqual(errors, []);
  console.log("PASS: PDF attachment can be opened, viewed and downloaded.");
} finally {
  if (browser) await browser.close();
  server.kill();
}
