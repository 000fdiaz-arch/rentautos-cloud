const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const METHODS = [
  "Efectivo",
  "ACH Express",
  "Deposito Bancario",
  "Transferencia Bancaria",
  "Tarjeta"
];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const baseUrl = process.env.RENTAUTOS_WORKFLOWS_BASE_URL ?? "http://127.0.0.1:5174/";

  for (const [index, method] of METHODS.entries()) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });

    const client = {
      id: `manual-client-${index}`,
      unitId: `M${index + 1}`,
      name: `CLIENTE ${method}`,
      cedula: `8-100-${index}`,
      rentAmount: 20,
      frequency: "daily",
      balance: 100,
      advanceBalance: 0,
      savings: 0,
      installmentsAgreed: 10,
      installmentsRemaining: 5,
      installmentsPaid: 5,
      otherCharges: [],
      createdAt: new Date().toISOString(),
      status: "active"
    };

    await page.evaluate(({ client }) => {
      localStorage.setItem("cobrapp.module1.clients.v1", JSON.stringify([client]));
      localStorage.setItem("cobrapp.module2.payments.v1", JSON.stringify([]));
      localStorage.setItem("cobrapp.module2.pending_bank.v1", JSON.stringify([]));
      localStorage.setItem("cobrapp.module2.pending_card.v1", JSON.stringify([]));
      localStorage.setItem("cobrapp.module2.cash_closings.v1", JSON.stringify([]));
      localStorage.setItem("cobrapp.payments.seq.v1", "0");
    }, { client });

    await page.goto(new URL("/pagos", baseUrl).href, { waitUntil: "domcontentloaded" });
    const registerPanel = page.getByRole("tabpanel", { name: "Registrar pago" });
    const search = registerPanel.locator("input.client-search-input");
    await search.fill(client.unitId);
    await registerPanel.locator(".client-dropdown-item").first().click();

    if (method !== "Efectivo") {
      await registerPanel.getByRole("button", { name: method, exact: true }).click();
    } else {
      await registerPanel.getByRole("radiogroup", { name: "Estado de entrega del efectivo" })
        .getByRole("button", { name: "Entregado", exact: true }).click();
    }
    if (method === "ACH Express" || method === "Deposito Bancario" || method === "Transferencia Bancaria") {
      await registerPanel.locator('input[placeholder="Obligatorio para pago bancario"]').fill(`FOLIO:${method.replace(/\s+/g, "-")}-${index}`);
    }
    await registerPanel.locator("input.payment-input--amount").fill("20");
    await registerPanel.getByRole("button", { name: "Confirmar pago y generar recibo" }).click();

    const historyPanel = page.getByRole("tabpanel", { name: "Historial pagos" });
    await historyPanel.waitFor({ state: "visible" });
    await historyPanel.getByText(client.name, { exact: true }).waitFor();
    assert.equal(await registerPanel.isVisible(), false,
      `${method} debe salir de Registrar pago despues de guardar.`);
    assert.equal(await page.getByText("Pago guardado correctamente.").count(), 0,
      "No debe mostrarse la tarjeta intermedia del pago registrado.");

    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("cobrapp.module2.payments.v1") || "[]"));
    assert.equal(saved.length, 1, `${method} debe guardar exactamente un pago.`);
    assert.ok(saved[0].receiptNumber, `${method} debe conservar su recibo.`);

    await context.close();
  }

  console.log("OK registro manual: cinco metodos guardan y abren el historial directamente, sin tarjeta intermedia.");
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
