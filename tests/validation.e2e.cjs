// @ts-check
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const BASE_URL = process.env.RENTAUTOS_TEST_BASE_URL ?? "http://127.0.0.1:4173";
const TEST_ID = process.env.RENTAUTOS_TEST_ID ?? "";
const TEST_PASSWORD = process.env.RENTAUTOS_TEST_PASSWORD ?? "";
const OUT_DIR = path.join(os.tmpdir(), "rentautos-validation-output");
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
  if (!TEST_ID || !TEST_PASSWORD) {
    throw new Error(
      "Faltan credenciales de prueba. Define RENTAUTOS_TEST_ID y RENTAUTOS_TEST_PASSWORD antes de ejecutar el test."
    );
  }

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

  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await login(page, TEST_ID, TEST_PASSWORD);

  await test("Carga inicial de app y navegacion principal", async () => {
    await ensureLoggedIn(page, TEST_ID, TEST_PASSWORD);
    await expectVisible(page, "button:has-text('Clientes')");
    await expectVisible(page, "button:has-text('Pagos')");
    await expectVisible(page, "button:has-text('Configuraciones')");
  });
  await shot(page, "01-home");

  await test("Crear cliente nuevo", async () => {
    await ensureLoggedIn(page, TEST_ID, TEST_PASSWORD);
    await page.getByRole("button", { name: "Clientes", exact: true }).click({ force: true });
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

    await ensureClientVisibleInClientsTable(page, unitId, clientName);
  });
  await shot(page, "02-client-created");

  await test("Validacion evita unidad duplicada", async () => {
    await ensureLoggedIn(page, TEST_ID, TEST_PASSWORD);
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

    // Cierra solo el formulario de "Nuevo cliente" para evitar confundirlo con "Cerrar sesion".
    const newClientPanel = page
      .locator("section.panel")
      .filter({ has: page.getByRole("heading", { name: "Nuevo cliente" }) })
      .first();
    const closeFormButton = newClientPanel.getByRole("button", { name: "Cerrar", exact: true }).first();
    if (await closeFormButton.isVisible().catch(() => false)) {
      await closeFormButton.click({ force: true });
    }
  });
  await shot(page, "03-duplicate-validation");

  await test("Registrar pago y actualizar saldo", async () => {
    await openPaymentsPanel(page, TEST_ID, TEST_PASSWORD, "Registrar pago");
    await pickClientFromSearch(page, unitId);

    const registerPanel = page.locator("section.panel").filter({
      has: page.getByRole("heading", { name: "Registrar pago" })
    }).first();
    await registerPanel.locator("input.payment-input--amount").first().fill(paymentAmount);
    await expectTextOnPage(page, "Vista previa del pago");
    await registerPanel.getByRole("button", { name: "Confirmar pago y generar recibo" }).click();
    const backToRegister = page.getByRole("button", { name: /Registrar otro pago/i }).first();
    await backToRegister.waitFor({ state: "visible", timeout: 15000 });
    await backToRegister.click({ force: true });
    await page.locator(".payment-quick-actions-panel").first().waitFor({ state: "visible", timeout: 15000 });
  });
  await shot(page, "04-payment-registered");

  await test("Historial de pagos muestra controles y filas", async () => {
    // Desacopla este caso del estado previo (por ejemplo, pantalla de recibo u otro panel abierto).
    await page.reload({ waitUntil: "networkidle" });
    await ensureLoggedIn(page, TEST_ID, TEST_PASSWORD);
    await openPaymentsPanel(page, TEST_ID, TEST_PASSWORD, "Historial pagos");
    const historySection = page
      .locator("section.panel")
      .filter({ has: page.getByRole("heading", { name: /Historial( de)? pagos/i }) })
      .first();

    await historySection.getByRole("button", { name: /Descargar seleccionados/i }).first().waitFor({ state: "visible", timeout: 15000 });
    await historySection.getByRole("button", { name: /Descargar filtrados/i }).first().waitFor({ state: "visible", timeout: 15000 });
    await historySection.locator("table thead th", { hasText: "Recibo" }).first().waitFor({ state: "visible", timeout: 15000 });
    await historySection.locator("table thead th", { hasText: "Fecha" }).first().waitFor({ state: "visible", timeout: 15000 });

    const rows = historySection.locator("table tbody tr");
    const count = await rows.count();
    assert.ok(count >= 1, "Se esperaba al menos 1 fila en historial.");
  });
  await shot(page, "05-history");

  await test("Persistencia en nube tras recargar app", async () => {
    await page.reload({ waitUntil: "networkidle" });
    await ensureLoggedIn(page, TEST_ID, TEST_PASSWORD);
    await ensureClientVisibleInClientsTable(page, unitId, clientName);

    await openPaymentsPanel(page, TEST_ID, TEST_PASSWORD, "Historial pagos");
    const historySection = page
      .locator("section.panel")
      .filter({ has: page.getByRole("heading", { name: /Historial( de)? pagos/i }) })
      .first();
    const rows = historySection.locator("table tbody tr");
    const count = await rows.count();
    assert.ok(count >= 1, "Se esperaba al menos 1 fila en historial despues de recargar.");
  });

  await browser.close();

  const total = passed + failed;
  const summary = [
    "RENTAUTOS VALIDATION E2E",
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
  await page.locator(selector).first().waitFor({ state: "visible", timeout: 15000 });
}

/**
 * @param {import('playwright').Page} page
 * @param {string} text
 */
async function expectTextOnPage(page, text) {
  await page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout: 15000 });
}

/**
 * @param {import('playwright').Page} page
 * @param {string} label
 */
async function openPaymentsQuickAction(page, label) {
  const button = page
    .locator(".payment-quick-actions-panel .payment-quick-action")
    .filter({ has: page.locator(".payment-quick-action-title", { hasText: label }) })
    .first();
  if (!(await button.isVisible().catch(() => false))) return false;
  await button.scrollIntoViewIfNeeded();
  const state = button.locator(".payment-quick-action-state").first();
  const stateText = ((await state.textContent().catch(() => "")) ?? "").trim().toLowerCase();
  if (stateText.includes("ocultar")) return true;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await button.click({ force: true, timeout: 15000 });
      await page.waitForTimeout(250);
      const nextState = ((await state.textContent().catch(() => "")) ?? "").trim().toLowerCase();
      if (nextState.includes("ocultar")) return true;
      continue;
    } catch {
      await page.waitForTimeout(700);
    }
  }

  try {
    await button.evaluate((node) => node.click());
    await page.waitForTimeout(250);
    const afterEvalState = ((await state.textContent().catch(() => "")) ?? "").trim().toLowerCase();
    return afterEvalState.includes("ocultar");
  } catch {
    return false;
  }
}

/**
 * @param {import('playwright').Page} page
 * @param {string} query
 */
async function pickClientFromSearch(page, query) {
  const registerSection = page
    .locator("section.panel")
    .filter({ has: page.getByRole("heading", { name: "Registrar pago" }) })
    .first();
  const input = registerSection.getByPlaceholder("Buscar por unidad, nombre o cedula...");
  const firstItem = registerSection.locator(".client-dropdown-item").first();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await input.waitFor({ state: "visible", timeout: 15000 });
    await input.fill(query);
    await page.waitForTimeout(200);

    if (await firstItem.isVisible().catch(() => false)) {
      await firstItem.click({ force: true });
      return;
    }
  }

  await firstItem.waitFor({ state: "visible", timeout: 15000 });
  await firstItem.click({ force: true });
}

/**
 * @param {import('playwright').Page} page
 * @param {string} id
 * @param {string} password
 * @param {string} quickActionLabel
 */
async function openPaymentsPanel(page, id, password, quickActionLabel) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await ensureLoggedIn(page, id, password);
    const returnFromReceipt = page.getByRole("button", { name: /Registrar otro pago/i }).first();
    if (await returnFromReceipt.isVisible().catch(() => false)) {
      await returnFromReceipt.click({ force: true });
      await page.waitForTimeout(400);
    }
    await page.locator(".app-nav-tabs .nav-tab", { hasText: "Pagos" }).first().click({ force: true });
    await page.locator(".payment-quick-actions-panel").first().waitFor({ state: "visible", timeout: 15000 });

    if (quickActionLabel === "Registrar pago") {
      const registerSection = page
        .locator("section.panel")
        .filter({ has: page.getByRole("heading", { name: "Registrar pago" }) })
        .first();
      const input = registerSection.getByPlaceholder("Buscar por unidad, nombre o cedula...");

      if (await registerSection.isVisible().catch(() => false) && await input.isVisible().catch(() => false)) return;

      await openPaymentsQuickAction(page, quickActionLabel);
      try {
        await registerSection.waitFor({ state: "visible", timeout: 5000 });
        await input.waitFor({ state: "visible", timeout: 5000 });
        return;
      } catch {
        // retry
      }
    } else {
      const historySection = page
        .locator("section.panel")
        .filter({ has: page.getByRole("heading", { name: /Historial( de)? pagos/i }) })
        .first();
      if (await historySection.isVisible().catch(() => false)) return;

      await openPaymentsQuickAction(page, quickActionLabel);
      try {
        await historySection.waitFor({ state: "visible", timeout: 5000 });
        return;
      } catch {
        // retry
      }
    }
  }

  if (quickActionLabel === "Registrar pago") {
    const registerSection = page
      .locator("section.panel")
      .filter({ has: page.getByRole("heading", { name: "Registrar pago" }) })
      .first();
    await registerSection.waitFor({ state: "visible", timeout: 30000 });
    await registerSection.getByPlaceholder("Buscar por unidad, nombre o cedula...").waitFor({ state: "visible", timeout: 30000 });
  } else {
    const historySection = page
      .locator("section.panel")
      .filter({ has: page.getByRole("heading", { name: /Historial( de)? pagos/i }) })
      .first();
    await historySection.waitFor({ state: "visible", timeout: 15000 });
  }
}

/**
 * @param {import('playwright').Page} page
 * @param {string} unitId
 * @param {string} clientName
 */
async function ensureClientVisibleInClientsTable(page, unitId, clientName) {
  await page.getByRole("button", { name: "Clientes", exact: true }).click({ force: true });

  const filterSelects = page.locator(".filters-bar select");
  const count = await filterSelects.count();
  if (count >= 4) {
    await filterSelects.nth(0).selectOption("all"); // frecuencia
    await filterSelects.nth(1).selectOption("all"); // grupo
    await filterSelects.nth(2).selectOption("all"); // deuda
    await filterSelects.nth(3).selectOption("all"); // estado
  }

  const searchInput = page.getByPlaceholder("Buscar por unidad, cliente o cedula");
  await searchInput.fill(unitId);

  await expectVisible(page, `table tbody tr:has-text("${unitId}")`);
  await expectTextOnPage(page, clientName);
}

/**
 * @param {import('playwright').Page} page
 * @param {string} id
 * @param {string} password
 */
async function login(page, id, password) {
  await page.getByLabel("Usuario").fill(id);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: "Iniciar sesion" }).click();
  await expectVisible(page, "button:has-text('Clientes')");
}

/**
 * @param {import('playwright').Page} page
 * @param {string} id
 * @param {string} password
 */
async function ensureLoggedIn(page, id, password) {
  const loginButton = page.getByRole("button", { name: "Iniciar sesion" });
  if (await loginButton.isVisible().catch(() => false)) {
    await login(page, id, password);
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
