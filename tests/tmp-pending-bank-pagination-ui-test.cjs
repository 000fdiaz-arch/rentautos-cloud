const assert = require("node:assert/strict");
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const baseUrl = process.env.RENTAUTOS_WORKFLOWS_BASE_URL ?? "http://127.0.0.1:5174/";
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });

  const now = new Date().toISOString();
  const clients = Array.from({ length: 421 }, (_, index) => ({
    id: `pending-client-${index}`,
    unitId: index === 0 ? "T10" : `T${1000 + index}`,
    name: `CLIENTE PENDIENTE ${index}`,
    cedula: `8-${String(index).padStart(4, "0")}`,
    rentAmount: 20,
    frequency: "daily",
    balance: 100,
    advanceBalance: 0,
    savings: 0,
    installmentsAgreed: 100,
    installmentsRemaining: 50,
    installmentsPaid: 50,
    otherCharges: [],
    createdAt: now,
    status: "active"
  }));
  const pending = Array.from({ length: 120 }, (_, index) => ({
    folio: `PERF-${index}`,
    dateApplied: "2026-09-10",
    amountReceived: 20.37,
    capitalPart: 20,
    centsPart: 0.37,
    description: `PAGO DE PRUEBA ${index}`,
    importedAt: now,
    accountNumber: "3380008048",
    mappedGroup: "T",
    suggestedClientId: index % 2 === 0 ? `pending-client-${index}` : undefined,
    suggestedClientName: index % 2 === 0 ? `CLIENTE PENDIENTE ${index}` : undefined
  }));

  await page.evaluate(({ clients, pending }) => {
    localStorage.setItem("cobrapp.module1.clients.v1", JSON.stringify(clients));
    localStorage.setItem("cobrapp.module2.payments.v1", JSON.stringify([]));
    localStorage.setItem("cobrapp.module2.pending_bank.v1", JSON.stringify(pending));
    localStorage.setItem("cobrapp.module2.pending_card.v1", JSON.stringify([]));
  }, { clients, pending });

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("link", { name: /^Pagos$/i }).click();
  const startedAt = Date.now();
  await page.getByRole("tab", { name: "Ver pendientes" }).click();
  await page.getByText("Página 1 de 3 · 120 pendientes").waitFor();
  const openElapsed = Date.now() - startedAt;

  const panel = page.getByRole("tabpanel", { name: "Ver pendientes" });
  assert.equal(await panel.locator("tbody > tr").count(), 50, "Solo deben renderizarse 50 pendientes por página.");
  assert.equal(await panel.locator("select.pending-unit-select option").count(), 0, "No deben cargarse opciones de clientes antes de abrir el buscador.");

  const firstUnassignedRow = panel.locator("tbody > tr").filter({ has: page.getByText("PERF-1", { exact: true }) });
  await firstUnassignedRow.getByRole("button", { name: "Asignar cliente" }).click();
  await firstUnassignedRow.getByRole("searchbox", { name: "Buscar cliente para folio PERF-1" }).pressSequentially("  t1040 ", { delay: 25 });
  await firstUnassignedRow.getByText("T1040 - CLIENTE PENDIENTE 40").waitFor();
  assert.equal(await firstUnassignedRow.getByRole("searchbox", { name: "Buscar cliente para folio PERF-1" }).count(), 0,
    "Una unidad exacta y única debe asignarse inmediatamente y cerrar la búsqueda.");

  const ambiguousRow = panel.locator("tbody > tr").filter({ has: page.getByText("PERF-3", { exact: true }) });
  await ambiguousRow.getByRole("button", { name: "Asignar cliente" }).click();
  await ambiguousRow.getByRole("searchbox", { name: "Buscar cliente para folio PERF-3" }).fill("T10");
  const resultSelect = ambiguousRow.getByRole("combobox", { name: "Resultados de cliente para folio PERF-3" });
  assert.ok(await resultSelect.locator("option").count() <= 21, "El buscador no debe renderizar más de 20 coincidencias y su encabezado.");
  await resultSelect.selectOption("pending-client-4");
  await ambiguousRow.getByText("T1004 - CLIENTE PENDIENTE 4").waitFor();

  await panel.getByRole("button", { name: "Siguiente" }).click();
  await page.getByText("Página 2 de 3 · 120 pendientes").waitFor();
  await panel.getByText("PERF-50", { exact: true }).waitFor();
  assert.equal(await panel.getByText("PERF-0", { exact: true }).count(), 0);
  assert.ok(openElapsed < 3000, `Abrir 120 pendientes tardó ${openElapsed}ms; se esperaba menos de 3000ms.`);

  await panel.getByRole("button", { name: "Anterior" }).click();
  const applicableRow = panel.locator("tbody > tr").filter({ has: page.getByText("PERF-0", { exact: true }) });
  await applicableRow.getByRole("button", { name: /^Aplicar$/ }).click();
  await applicableRow.waitFor({ state: "detached" });
  await page.waitForFunction(() => {
    const payments = JSON.parse(localStorage.getItem("cobrapp.module2.payments.v1") || "[]");
    return payments.some((payment) => String(payment.reference || "").includes("FOLIO:PERF-0"));
  });

  console.log(`OK pendientes UI: asignación inmediata por unidad exacta, resultados ambiguos bajo demanda, 120 registros paginados y apertura en ${openElapsed}ms.`);
  await browser.close();
})().catch((error) => {
  console.error("FALLO PENDIENTES UI:", error?.message ?? error);
  process.exit(1);
});
