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
const wc = makeItem("wc", "WC-01", "WC", "delta2");
const custom = makeItem("custom", "CUSTOM-01", "CHORRERA", "delta1");

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
      return route.fulfill({ json: [pty, wc, custom].map(item => ({ client_id: item.clientId, data: item, in_custody: false })) });
    }
    if (url.pathname.endsWith("/route_payment_reports") || url.pathname.endsWith("/route_capture_events") || url.pathname.endsWith("/route_runs") || url.pathname.endsWith("/notified_payments_cloud")) {
      return route.fulfill({ json: [] });
    }
    return route.fulfill({ json: [] });
  });

  await page.goto(`${base}/__route-pty-filter-test`);
  await page.getByRole("button", { name: "Trabajo (2)", exact: true }).waitFor();
  assert.equal(await page.getByText("Vista: Delta 1", { exact: true }).count(), 1, "Delta 1 debe quedar identificado claramente.");
  const routeTotals = page.getByRole("region", { name: "Carros por ruta" });
  assert.equal(await routeTotals.getByRole("button", { name: /Ruta PTY.*1/ }).count(), 1);
  assert.equal(await routeTotals.getByRole("button", { name: /Ruta WC/ }).count(), 0, "Delta 1 no debe ver el resumen de WC.");
  assert.equal(await routeTotals.getByRole("button", { name: /Ruta CHORRERA.*1/ }).count(), 1, "Delta 1 debe ver cualquier ruta que tenga carros asignados a su Delta.");
  assert.equal(await page.getByRole("region", { name: "Resumen del equipo" }).count(), 0, "Los Deltas no deben ver el resumen del equipo.");
  assert.equal(await page.getByText("PTY-01", { exact: false }).count() > 0, true);
  assert.equal(await page.getByText("CUSTOM-01", { exact: false }).count() > 0, true, "Un carro de otra ruta asignado a Delta 1 debe aparecer.");
  assert.equal(await page.getByText("WC-01", { exact: false }).count(), 0);

  assert.equal(await page.getByLabel("Filtrar por Delta asignado").count(), 0, "Una sesión Delta no debe poder saltar a otro Delta.");
  await page.getByText("Filtrar por ruta y zona", { exact: false }).click();
  assert.equal(await page.getByLabel("Filtrar por ruta").count(), 1, "El Delta puede organizar sus propios carros por ruta.");
  await routeTotals.getByRole("button", { name: /Ruta PTY.*1/ }).click();
  assert.equal(await page.getByRole("button", { name: /^Todas \(/ }).count(), 1, "El filtro de zona debe seguir disponible.");

  await page.goto(`${base}/__route-pty-filter-test?delta2`);
  await page.getByRole("button", { name: "Trabajo (1)", exact: true }).waitFor();
  assert.equal(await page.getByText("Vista: Delta 2", { exact: true }).count(), 1, "Delta 2 debe quedar identificado claramente.");
  assert.equal(await page.getByText("WC-01", { exact: false }).count() > 0, true, "Delta 2 debe ver su carro WC.");
  assert.equal(await page.getByText("PTY-01", { exact: false }).count(), 0, "Delta 2 no debe ver carros PTY.");
  const delta2Totals = page.getByRole("region", { name: "Carros por ruta" });
  assert.equal(await delta2Totals.getByRole("button", { name: /Ruta WC.*1/ }).count(), 1);
  assert.equal(await delta2Totals.getByRole("button", { name: /Ruta PTY/ }).count(), 0);
  assert.equal(await page.getByRole("region", { name: "Resumen del equipo" }).count(), 0, "Delta 2 tampoco debe ver el resumen del equipo.");
  await page.getByText("Efectivo pendiente de entrega", { exact: true }).click();
  const cashTeams = page.locator(".route-pending-cash-team > summary");
  assert.equal(await cashTeams.count(), 1, "Delta 2 debe ver un solo equipo de efectivo.");
  assert.match(await cashTeams.first().innerText(), /WC/, "Delta 2 debe ver solamente el efectivo de WC.");

  await page.goto(`${base}/__route-pty-filter-test?admin`);
  await page.getByRole("button", { name: "Trabajo (3)", exact: true }).waitFor();
  assert.equal(await page.getByLabel("Filtrar por Delta asignado").count(), 1, "Administración debe conservar el filtro por Delta.");
  await page.getByText("Filtrar por ruta y zona", { exact: false }).click();
  assert.equal(await page.getByLabel("Filtrar por ruta").count(), 1, "Administración debe conservar la vista de todas las rutas.");

  await page.goto(`${base}/__route-pty-filter-test?admin&delta=delta2`);
  await page.getByText("Vista filtrada: Delta 2", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Trabajo (1)", exact: true }).waitFor();
  assert.equal(await page.getByText("WC-01", { exact: false }).count() > 0, true);
  assert.equal(await page.getByText("PTY-01", { exact: false }).count(), 0);
  assert.equal(await page.getByRole("region", { name: "Resumen del equipo" }).count(), 0, "El enlace de vista Delta debe reproducir el mismo aislamiento.");
  assert.equal(await page.getByLabel("Filtrar por Delta asignado").count(), 0, "La vista Delta enlazada no debe permitir cambiar a otro Delta.");

  console.log("OK alcance Delta: cada operador conserva solo sus carros en todas sus rutas y puede organizarlos por ruta y zona.");
} finally {
  if (browser) await browser.close();
  server.kill();
}
