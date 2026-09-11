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

    await registerPanel.getByText("Pago guardado correctamente.").waitFor();
    await registerPanel.getByText(`${client.unitId} - ${client.name}`, { exact: false }).waitFor();
    assert.equal(await page.getByRole("tabpanel", { name: "Historial pagos" }).isVisible(), false,
      `${method} no debe abrir el historial automaticamente.`);

    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("cobrapp.module2.payments.v1") || "[]"));
    assert.equal(saved.length, 1, `${method} debe guardar exactamente un pago.`);
    assert.ok(saved[0].receiptNumber, `${method} debe conservar su recibo.`);

    await registerPanel.getByRole("button", { name: "Ver comprobante" }).click();
    const receiptModal = page.locator(".payment-receipt-modal");
    await receiptModal.waitFor();
    await receiptModal.getByRole("button", { name: "Cerrar vista previa" }).click();
    await receiptModal.waitFor({ state: "hidden" });
    assert.equal(await page.getByRole("tabpanel", { name: "Historial pagos" }).isVisible(), false,
      "Ver el comprobante reciente tampoco debe abrir el historial.");

    if (index === METHODS.length - 1) {
      await registerPanel.getByRole("button", { name: "Ir al historial" }).click();
      await page.getByRole("tabpanel", { name: "Historial pagos" }).waitFor({ state: "visible" });
    }

    await context.close();
  }

  console.log("OK registro manual: cinco metodos guardan y muestran recibo sin abrir historial; historial carga solo al pedirlo.");
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
