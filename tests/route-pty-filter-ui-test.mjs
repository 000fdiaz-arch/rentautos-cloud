import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const base = "http://127.0.0.1:4203";
const publishedAt = "2026-10-14T12:00:00.000Z";
const makeItem = (clientId, unitId, routeAssignment, assignedDelta) => ({
  clientId,
  unitId,
  clientName: `Cliente ${unitId}`,
  routeAssignment,
  assignedDelta,
  releaseAmount: 30,
  pendingAmount: 60,
  overdueBalance: 60,
  rentAmount: 30,
  daysLate: 2,
  publishedAt,
  routeStartedAt: publishedAt
});
const pty = makeItem("pty", "PTY-01", "PTY", "delta1");
const wc = makeItem("wc", "WC-01", "WC");

const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "4203", "--strictPort"], {
  windowsHide: true,
  stdio: "pipe",
  env: { ...process.env, VITE_SUPABASE_URL: "https://route-pty-filter.invalid", VITE_SUPABASE_ANON_KEY: "synthetic-test-key" }
});
let browser;
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Vite timeout")), 15000);
    server.stdout.on("data", chunk => {
      if (chunk.toString().includes("4203")) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.on("error", reject);
  });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(30000);
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin === base) {
      if (url.pathname === "/__route-pty-filter-test") {
        return route.fulfill({
          contentType: "text/html",
          body: `<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script><script type="module" src="/tests/fixtures/route-reports.tsx"></script>`
        });
      }
      return route.continue();
    }
    if (url.hostname !== "route-pty-filter.invalid") return route.abort();
    if (url.pathname.endsWith("/active_route_items_cloud")) {
      return route.fulfill({ json: [pty, wc].map(item => ({ client_id: item.clientId, data: item, in_custody: false })) });
    }
    if (url.pathname.endsWith("/route_payment_reports") || url.pathname.endsWith("/route_capture_events") || url.pathname.endsWith("/route_runs") || url.pathname.endsWith("/notified_payments_cloud")) {
      return route.fulfill({ json: [] });
    }
    return route.fulfill({ json: [] });
  });

  await page.goto(`${base}/__route-pty-filter-test`);
  await page.getByRole("button", { name: /Mis carros \(1\)/ }).waitFor();
  assert.equal(await page.getByText("PTY-01", { exact: false }).count() > 0, true);
  assert.equal(await page.getByText("WC-01", { exact: false }).count(), 0);

  assert.equal(await page.getByRole("button", { name: /Todos PTY/ }).count(), 0);
  await page.getByText("Filtrar por ruta y zona", { exact: false }).click();
  await page.getByRole("button", { name: "PTY", exact: true }).click();
  assert.equal(await page.getByText("PTY-01", { exact: false }).count() > 0, true);
  assert.equal(await page.getByText("WC-01", { exact: false }).count(), 0, "El filtro de ruta PTY nunca debe incluir unidades WC.");

  console.log("OK filtro PTY: Mis carros y el filtro de ruta PTY excluyen unidades WC.");
} finally {
  if (browser) await browser.close();
  server.kill();
}
