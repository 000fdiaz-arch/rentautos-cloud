// @ts-check
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const BASE_URL = "http://127.0.0.1:5174";
const OUT_DIR = path.join(__dirname, "validation-output");
const SCREEN_DIR = path.join(OUT_DIR, "screenshots");
const REPORT_PATH = path.join(OUT_DIR, "validation-report.txt");

fs.mkdirSync(SCREEN_DIR, { recursive: true });

/** @type {string[]} */
const reportLines = [];
let passed = 0;
let failed = 0;

function note(message) {
  console.log(message);
  reportLines.push(message);
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(SCREEN_DIR, `${name}.png`), fullPage: true });
}

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    note(`[PASS] ${name}`);
  } catch (error) {
    failed += 1;
    const detail = error instanceof Error ? error.message : String(error);
    note(`[FAIL] ${name} -> ${detail}`);
  }
}

function randomSuffix() {
  return String(Date.now()).slice(-6);
}

async function run() {
  const suffix = randomSuffix();
  const unitId = `QA-${suffix}`;
  const clientName = `QA CLIENTE ${suffix}`;
  const cedula = "8-123-456";
  const rentAmount = "100";
  const initialBalance = "300";
  const paymentAmount = "150";

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();

  page.on("pageerror", (err) => {
    note(`[PAGEERROR] ${err.message}`);
  });

  // Keep test deterministic: start with a clean local storage snapshot.
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("cobrapp.module1.clients.v1", "[]");
    localStorage.setItem("cobrapp.module2.payments.v1", "[]");
    localStorage.setItem("cobrapp.module2.cash_closings.v1", "[]");
  });

  await page.goto(BASE_URL, { waitUntil: "networkidle" });

  await test("Carga inicial de app y navegacion principal", async () => {
    await expectVisible(page, "button:has-text('Clientes')");
    await expectVisible(page, "button:has-text('Pagos')");
    await expectVisible(page, "button:has-text('Configuraciones')");
  });
  await shot(page, "01-home");

  await test("Crear cliente nuevo", async () => {
    await page.getByRole("button", { name: "Clientes", exact: true }).click();
    const openFormButton = page.getByRole("button", { name: "+ Nuevo cliente" });
    if (await openFormButton.isVisible()) {
      await openFormButton.click();
    }

    await page.getByLabel("UNIDAD/ID").fill(unitId);
    await page.getByLabel("Cedula").fill(cedula);
    await page.getByLabel("Nombre").fill(clientName);
    await page.getByLabel("Renta (USD)").fill(rentAmount);
    await page.getByLabel("Cuotas pactadas").fill("3");
    await page.getByLabel("Cuotas restantes").fill("3");
    await page.getByLabel("MONTO A COBRAR (USD)").fill(initialBalance);
    await page.getByRole("button", { name: "Guardar cliente" }).click();

    await expectTextOnPage(page, unitId);
    await expectTextOnPage(page, clientName);
  });
  await shot(page, "02-client-created");

  await test("Validacion evita unidad duplicada", async () => {
    const openFormButton = page.getByRole("button", { name: "+ Nuevo cliente" });
    if (await openFormButton.isVisible()) {
      await openFormButton.click();
    }

    await page.getByLabel("UNIDAD/ID").fill(unitId);
    await page.getByLabel("Cedula").fill("8-654-321");
    await page.getByLabel("Nombre").fill("CLIENTE DUPLICADO");
    await page.getByLabel("Renta (USD)").fill("50");
    await page.getByLabel("Cuotas pactadas").fill("2");
    await page.getByLabel("Cuotas restantes").fill("2");
    await page.getByLabel("MONTO A COBRAR (USD)").fill("100");
    await page.getByRole("button", { name: "Guardar cliente" }).click();

    await expectTextOnPage(page, "UNIDAD/ID ya existe. No se permiten duplicados.");

    const closeBtn = page.getByRole("button", { name: "Cerrar" }).first();
    if (await closeBtn.isVisible()) await closeBtn.click();
  });
  await shot(page, "03-duplicate-validation");

  await test("Registrar pago y actualizar saldo", async () => {
    await page.getByRole("button", { name: "Pagos", exact: true }).click();
    await openPaymentsQuickAction(page, "Registrar pago");

    const clientSearch = page.getByPlaceholder("Buscar por unidad, nombre o cedula...");
    await clientSearch.waitFor({ state: "visible", timeout: 10000 });
    await clientSearch.fill(unitId);
    await page.locator(".client-dropdown-item").first().click();

    const registerPanel = page.locator("section.panel").filter({
      has: page.getByRole("heading", { name: "Registrar pago" })
    }).first();
    await registerPanel.locator("input.payment-input--amount").first().fill(paymentAmount);
    await expectTextOnPage(page, "Vista previa del pago");
    await registerPanel.getByRole("button", { name: "Confirmar pago y generar recibo" }).click();

    await expectTextOnPage(page, "Recibo generado correctamente.");
    await expectTextOnPage(page, clientName);
    await page.getByRole("button", { name: "Registrar otro pago" }).click();
  });
  await shot(page, "04-payment-registered");

  await test("Historial de pagos muestra controles y filas", async () => {
    await page.getByRole("button", { name: "Pagos", exact: true }).click();
    await openPaymentsQuickAction(page, "Historial pagos");

    await expectVisible(page, "input[title='Filtrar desde fecha']");
    await expectVisible(page, "input[title='Filtrar hasta fecha']");
    await expectVisible(page, "button:has-text('Descargar seleccionados')");
    await expectVisible(page, "button:has-text('Descargar filtrados')");

    const rows = page.locator("table tbody tr");
    const count = await rows.count();
    assert.ok(count >= 1, "Se esperaba al menos 1 fila en historial.");
  });
  await shot(page, "05-history");

  await test("Persistencia en localStorage con cliente y pago nuevos", async () => {
    const snapshot = await page.evaluate(() => {
      const rawClients = localStorage.getItem("cobrapp.module1.clients.v1") ?? "[]";
      const rawPayments = localStorage.getItem("cobrapp.module2.payments.v1") ?? "[]";
      return {
        clients: JSON.parse(rawClients),
        payments: JSON.parse(rawPayments)
      };
    });

    const createdClient = snapshot.clients.find((c) => c.unitId === unitId);
    assert.ok(createdClient, "No se encontro cliente creado en localStorage.");
    const createdPayment = snapshot.payments.find((p) => p.clientUnit === unitId);
    assert.ok(createdPayment, "No se encontro pago creado en localStorage.");
    assert.equal(createdClient.balance, 150, "El saldo esperado del cliente despues del pago es 150.");
  });

  await browser.close();

  const total = passed + failed;
  const summary = [
    "COBRAPP VALIDATION E2E",
    `Fecha: ${new Date().toLocaleString("es-PA")}`,
    `Base URL: ${BASE_URL}`,
    "",
    ...reportLines,
    "",
    `TOTAL: ${passed} pasadas, ${failed} fallidas, ${total} ejecutadas.`,
    `Screenshots: ${SCREEN_DIR}`
  ].join("\n");
  fs.writeFileSync(REPORT_PATH, summary, "utf8");

  console.log("\n========================================");
  console.log(summary);
  console.log("========================================\n");

  process.exit(failed > 0 ? 1 : 0);
}

/**
 * @param {import('playwright').Page} page
 * @param {string} selector
 */
async function expectVisible(page, selector) {
  await page.locator(selector).first().waitFor({ state: "visible", timeout: 7000 });
}

/**
 * @param {import('playwright').Page} page
 * @param {string} text
 */
async function expectTextOnPage(page, text) {
  await page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout: 7000 });
}

/**
 * @param {import('playwright').Page} page
 * @param {string} label
 */
async function openPaymentsQuickAction(page, label) {
  const button = page.locator(".payment-quick-actions-panel .payment-quick-action", { hasText: label }).first();
  await button.waitFor({ state: "visible", timeout: 7000 });
  await button.click();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
