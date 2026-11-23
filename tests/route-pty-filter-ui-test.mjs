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
let managedReports = [], managedCaptures = [];
const summaryOwner = "11111111-1111-4111-8111-111111111111";
const deltaProfiles = [1, 2, 3].map(number => ({ id: `delta${number}-profile`, email: `delta${number}@auth.rentautos.local`, is_active: true, data_owner_user_id: summaryOwner }));
deltaProfiles.push({ id: "other-owner-delta1", email: "delta1@auth.rentautos.local", is_active: false, data_owner_user_id: "another-owner" });
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
  page.setDefaultNavigationTimeout(60000);
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
    if (url.pathname.endsWith("/user_profiles")) return route.fulfill({ json: deltaProfiles });
    if (url.pathname.endsWith("/active_route_items_cloud")) {
      return route.fulfill({ json: [pty, wc, custom].map(item => ({ client_id: item.clientId, data: item, in_custody: false })) });
    }
    if (url.pathname.endsWith("/route_payment_reports")) return route.fulfill({ json: managedReports });
    if (url.pathname.endsWith("/route_capture_events")) return route.fulfill({ json: managedCaptures });
    if (url.pathname.endsWith("/route_runs") || url.pathname.endsWith("/notified_payments_cloud")) {
      return route.fulfill({ json: [] });
    }
    return route.fulfill({ json: [] });
  });

  await page.goto(`${base}/__route-pty-filter-test`);
  await page.getByRole("button", { name: "Trabajo (2)", exact: true }).waitFor();
  assert.equal(await page.getByText("Vista: Delta 1", { exact: true }).count(), 1, "Delta 1 debe quedar identificado claramente.");
  assert.equal(await page.locator(".route-search-workflow-tabs > button").count(), 2);
  assert.equal(await page.getByRole("button", { name: /^Pagos por revisar|^En custodia/ }).count(), 0, "Los Deltas solo ven Trabajo y Gestionados hoy.");
  await page.locator(".route-collection-filters > summary").click();
  const routeTotals = page.getByLabel("Filtrar por ruta", { exact: true });
  assert.equal(await routeTotals.getByRole("button", { name: "PTY", exact: true }).count(), 1);
  assert.equal(await routeTotals.getByRole("button", { name: "WC", exact: true }).count(), 0, "Delta 1 no debe ver el resumen de WC.");
  assert.equal(await routeTotals.getByRole("button", { name: "CHORRERA", exact: true }).count(), 1, "Delta 1 debe ver cualquier ruta que tenga carros asignados a su Delta.");
  assert.equal(await page.getByRole("region", { name: "Resumen del equipo" }).count(), 0, "Los Deltas no deben ver el resumen del equipo.");
  assert.equal(await page.getByText("PTY-01", { exact: false }).count() > 0, true);
  assert.equal(await page.getByText("CUSTOM-01", { exact: false }).count() > 0, true, "Un carro de otra ruta asignado a Delta 1 debe aparecer.");
  assert.equal(await page.getByText("WC-01", { exact: false }).count(), 0);

  assert.equal(await page.getByLabel("Filtrar por Delta asignado").count(), 0, "Una sesión Delta no debe poder saltar a otro Delta.");
  assert.equal(await page.getByLabel("Filtrar por ruta").count(), 1, "El Delta puede organizar sus propios carros por ruta.");
  await routeTotals.getByRole("button", { name: "PTY", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: /^Todas \(/ }).count(), 1, "El filtro de zona debe seguir disponible.");

  await page.goto(`${base}/__route-pty-filter-test?delta2`);
  await page.getByRole("button", { name: "Trabajo (1)", exact: true }).waitFor();
  assert.equal(await page.getByText("Vista: Delta 2", { exact: true }).count(), 1, "Delta 2 debe quedar identificado claramente.");
  assert.equal(await page.getByText("WC-01", { exact: false }).count() > 0, true, "Delta 2 debe ver su carro WC.");
  assert.equal(await page.getByText("PTY-01", { exact: false }).count(), 0, "Delta 2 no debe ver carros PTY.");
  await page.locator(".route-collection-filters > summary").click();
  const delta2Totals = page.getByLabel("Filtrar por ruta", { exact: true });
  assert.equal(await delta2Totals.getByRole("button", { name: "WC", exact: true }).count(), 1);
  assert.equal(await delta2Totals.getByRole("button", { name: "PTY", exact: true }).count(), 0);
  assert.equal(await page.getByRole("region", { name: "Resumen del equipo" }).count(), 0, "Delta 2 tampoco debe ver el resumen del equipo.");
  const cashDisclosure = page.locator(".route-pending-cash-disclosure > summary");
  assert.equal(await cashDisclosure.locator("strong").innerText(), "$45.25", "El efectivo del Delta aparece como monto destacado.");
  assert.equal(await cashDisclosure.getByText("Efectivo por entregar", { exact: true }).count(), 1, "El monto indica qué representa.");
  await cashDisclosure.click();
  const cashReceipts = page.getByRole("region", { name: "Efectivo pendiente de entrega", exact: true }).getByRole("list");
  assert.equal(await cashReceipts.getByRole("listitem").count(), 1, "El monto abre directamente los recibos del Delta.");
  assert.match(await cashReceipts.innerText(), /\$45\.25/);
  assert.equal(await page.locator(".route-pending-cash-team > summary").count(), 0, "No se repiten el equipo y el monto en una segunda franja.");

  await page.goto(`${base}/__route-pty-filter-test?admin`);
  await page.getByRole("button", { name: "Trabajo (3)", exact: true }).waitFor();
  assert.equal(await page.getByLabel("Filtrar por Delta asignado").count(), 1, "Administración debe conservar el filtro por Delta.");
  assert.equal(await page.locator(".route-search-workflow-tabs > button").count(), 4, "Administración conserva las cuatro pestañas.");
  await page.locator(".route-collection-filters > summary").click();
  assert.equal(await page.getByLabel("Filtrar por ruta").count(), 1, "Administración debe conservar la vista de todas las rutas.");

  await page.goto(`${base}/__route-pty-filter-test?admin&delta=delta2`);
  await page.getByText("Vista previa: Delta 2", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Trabajo (1)", exact: true }).waitFor();
  assert.equal(await page.getByText("WC-01", { exact: false }).count() > 0, true);
  assert.equal(await page.getByText("PTY-01", { exact: false }).count(), 0);
  assert.equal(await page.getByRole("region", { name: "Resumen del equipo" }).count(), 0, "El enlace de vista Delta debe reproducir el mismo aislamiento.");
  assert.equal(await page.getByLabel("Filtrar por Delta asignado").count(), 0, "La vista Delta enlazada no debe permitir cambiar a otro Delta.");
  assert.equal(await page.getByRole("button", { name: /Editar monto por cobrar/ }).count(), 0, "La vista previa oculta la edición administrativa de montos.");
  assert.equal(await page.getByLabel("Buscador asignado a WC-01").count(), 0, "La vista previa oculta la reasignación administrativa.");
  assert.equal(await page.locator(".route-search-workflow-tabs > button").count(), 2, "La vista previa reproduce las dos pestañas del Delta.");

  const reportedAt = new Date().toISOString();
  const report = (id, unit, cash, bank, outcome, delta = "delta1") => ({
    id, user_id: "11111111-1111-4111-8111-111111111111", client_id: id, published_at: publishedAt,
    snapshot: makeItem(id, unit, delta === "delta2" ? "WC" : "PTY", delta),
    amount: cash + bank, cash_amount: cash, bank_amount: bank, management_outcome: outcome,
    confirmed_cash_amount: cash, confirmed_bank_amount: bank, status: "confirmed",
    method: cash && bank ? "mixed" : bank ? "bank" : "cash", reported_by: delta + "-id",
    reporter_name: delta + "@auth.rentautos.local", reported_at: reportedAt, confirmed_at: reportedAt
  });
  managedReports = [report("cash-report", "A12", 60, 0, "collected"), report("bank-report", "E15", 0, 50, "collected"),
    report("mixed-report", "F16", 20, 30, "collected"), report("remote-report", "B38", 0, 85, "remote"),
    report("peer-report", "PEER-2", 999, 0, "collected", "delta2")];
  managedCaptures = [{ id: "capture", user_id: "11111111-1111-4111-8111-111111111111", client_id: "capture-client", unit_id: "D21",
    client_name: "Cliente D21", published_at: publishedAt, route_assignment: "PTY", reported_by: "delta1-id",
    reporter_name: "delta1@auth.rentautos.local", reported_at: reportedAt, status: "pending", released_at: null }];
  await page.goto(`${base}/__route-pty-filter-test`);
  await page.getByRole("button", { name: "Gestionados hoy (5)", exact: true }).click();
  const compact = page.getByRole("region", { name: "Lista compacta de gestionados hoy" });
  const results = compact.getByRole("group", { name: "Filtrar gestionados por resultado", exact: true });
  const rows = compact.locator(".route-managed-compact-row");
  assert.equal(await rows.count(), 5);
  assert.equal(await compact.getByText("$245.00", { exact: true }).count(), 1);
  assert.equal(await compact.getByText("PEER-2", { exact: true }).count(), 0, "Los resultados y totales no incluyen a otro Delta.");
  await results.getByRole("button", { name: "Cobrado (3)", exact: true }).click();
  assert.equal(await rows.count(), 3);
  const methods = compact.getByRole("group", { name: "Filtrar cobrados por método", exact: true });
  for (const [label, unit, mixedAmount] of [["Efectivo (2)", "A12", "$20.00"], ["Transferencia (2)", "E15", "$30.00"]]) {
    await methods.getByRole("button", { name: label, exact: true }).click();
    assert.equal(await rows.count(), 2);
    assert.equal(await rows.filter({ hasText: unit }).count(), 1);
    assert.match(await rows.filter({ hasText: "F16" }).innerText(), new RegExp(mixedAmount.replace(/[$.]/g, "\\$&")), "El pago con ambos métodos aparece en ambos filtros por su parte correspondiente.");
  }
  assert.equal(await methods.getByRole("button", { name: /Mixto/ }).count(), 0);
  await results.getByRole("button", { name: "Gestión remota (1)", exact: true }).click();
  assert.equal(await rows.count(), 1);
  assert.match(await rows.innerText(), /B38/);
  assert.equal(await compact.getByRole("group", { name: "Filtrar cobrados por método" }).count(), 0);
  await results.getByRole("button", { name: "En custodia (1)", exact: true }).click();
  assert.match(await rows.innerText(), /D21/);
  await page.getByLabel("Buscar", { exact: true }).fill("A12");
  assert.equal(await rows.count(), 0);
  await compact.getByText("No hay gestiones con este resultado. Selecciona otro resultado para continuar.").waitFor();
  await results.getByRole("button", { name: "Cobrado (1)", exact: true }).click();
  assert.equal(await rows.count(), 1, "El filtro de resultados se combina con la búsqueda.");
  await page.getByLabel("Buscar", { exact: true }).fill("");
  await results.getByRole("button", { name: "Todos (5)", exact: true }).click();
  assert.equal(await rows.count(), 5);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "La lista y sus filtros deben caber en móvil.");
  await page.goto(`${base}/__route-pty-filter-test?admin&delta=delta2`);
  await page.getByRole("button", { name: "Gestionados hoy (1)", exact: true }).click();
  assert.match(await page.locator(".route-managed-compact-row").innerText(), /PEER-2/);
  assert.equal(await page.getByText("$245.00", { exact: true }).count(), 0);
  await page.goto(`${base}/__route-pty-filter-test?admin`);
  await page.getByRole("button", { name: "Gestionados hoy (6)", exact: true }).click();
  assert.equal(await page.locator(".route-managed-compact").count(), 0, "La lista compacta queda reservada para Deltas y sus vistas previas.");
  assert.equal(await page.locator(".route-managed-row").count(), 6);
  await page.locator(".route-team-overview > summary").click();
  const teamSummary = page.getByRole("region", { name: "Resumen del equipo", exact: true });
  const delta3Row = teamSummary.getByRole("button", { name: /^Delta 3\b/ });
  await delta3Row.waitFor();
  deltaProfiles[2].is_active = false;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await delta3Row.waitFor({ state: "hidden" });
  assert.equal(await teamSummary.getByRole("button", { name: /^Delta 1\b/ }).count(), 1, "El estado de otra cartera no oculta el Delta de esta cartera.");
  deltaProfiles[2].is_active = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await delta3Row.waitFor();

  console.log("OK Delta: alcance, lista compacta, filtros, efectivo, móvil y resumen con desactivación/reactivación por cartera.");
} finally {
  if (browser) await browser.close();
  server.kill();
}
