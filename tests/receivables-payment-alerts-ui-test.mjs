import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const base = "http://127.0.0.1:4202";
const server = spawn(process.execPath, [
  "node_modules/vite/bin/vite.js",
  "--host", "127.0.0.1",
  "--port", "4202",
  "--strictPort"
], {
  windowsHide: true,
  stdio: "pipe",
  env: { ...process.env, VITE_SUPABASE_URL: "https://tests.invalid", VITE_SUPABASE_ANON_KEY: "synthetic" }
});

let browser;
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Vite timeout")), 15_000);
    server.stdout.on("data", (data) => {
      if (!data.toString().includes("4202")) return;
      clearTimeout(timer);
      resolve();
    });
  });

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === base && url.pathname === "/test") {
      return route.fulfill({
        contentType: "text/html",
        body: `<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script><script type="module" src="/tests/fixtures/receivables-payment-alerts.tsx"></script>`
      });
    }
    return route.continue();
  });

  await page.goto(`${base}/test`);
  await page.getByRole("heading", { name: "Pagos esperados no cubiertos" }).waitFor();
  await page.getByRole("heading", { name: "Clientes que requieren atención" }).waitFor();
  assert.equal(await page.getByText("con alerta", { exact: true }).count(), 1);
  assert.equal(await page.locator(".ar-payment-alert").count(), 3);
  assert.equal(await page.locator(".ar-risk-signal").count(), 4);

  await page.getByRole("button", { name: /Clientes nuevos 2/ }).click();
  assert.equal(await page.locator(".ar-essential-card").count(), 2);
  await page.getByText("Primer pago pendiente", { exact: true }).waitFor();
  await page.getByText("Cliente nuevo", { exact: true }).waitFor();
  await page.getByText(/ha cubierto 10 letras/).waitFor();
  await page.getByRole("button", { name: "Ver toda la cartera" }).click();

  await page.getByRole("button", { name: /Abonos bajos repetidos 1/ }).click();
  assert.equal(await page.locator(".ar-essential-card").count(), 1);
  await page.getByText(/2 de sus últimos 2 abonos a renta/).waitFor();
  await page.getByRole("button", { name: "Ver toda la cartera" }).click();

  await page.getByRole("button", { name: /Multas, boletas y recargos 1/ }).click();
  assert.equal(await page.locator(".ar-essential-card").count(), 1);
  await page.getByText(/multas\/Panapass \$40\.00 · boletas \$40\.00 · recargos \$25\.00/).waitFor();
  assert.equal(await page.getByText(/\$999\.00/).count(), 0);
  await page.getByRole("button", { name: "Ver toda la cartera" }).click();

  await page.getByRole("button", { name: /Abono incompleto 1/ }).click();
  assert.equal(await page.locator(".ar-essential-card").count(), 1);
  await page.getByRole("button", { name: "Ver desglose de letras" }).click();
  await page.getByText(/Letra más antigua: pagó \$40\.00 de \$192\.00; faltan \$152\.00/).waitFor();
  await page.getByText("Total vencido", { exact: true }).waitFor();

  await page.getByRole("button", { name: "Ver toda la cartera" }).click();
  assert.equal(await page.locator(".ar-essential-card").count(), 3);
  assert.deepEqual(errors, []);
  console.log("OK: alertas esperadas, señales de riesgo, filtros y cálculo visible.");
} finally {
  await browser?.close();
  server.kill();
}
