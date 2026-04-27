const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:5174/", { waitUntil: "domcontentloaded" });

  const client = {
    id: "ret-zero-1",
    unitId: "M09",
    name: "CLIENTE M09",
    cedula: "8-555-555",
    rentAmount: 35,
    frequency: "weekly",
    weeklyChargeDay: "monday",
    balance: 150,
    advanceBalance: 0,
    savings: 0,
    installmentsAgreed: 100,
    installmentsRemaining: 20,
    installmentsPaid: 80,
    otherCharges: [{ label: "ABONO", amount: 45 }],
    createdAt: new Date().toISOString(),
    status: "active"
  };

  const pending = {
    folio: "FOLIO-RET-ZERO-001",
    dateApplied: "2026-04-21",
    amountReceived: 30,
    capitalPart: 30,
    centsPart: 0,
    transactionCode: "253-215",
    referenceId: "M09",
    extractedName: "CLIENTE M09",
    description: "PRUEBA RETENCION CERO",
    importedAt: new Date().toISOString(),
    accountNumber: "3380008048",
    mappedGroup: "M",
    suggestedClientId: "ret-zero-1",
    suggestedClientName: "CLIENTE M09"
  };

  await page.evaluate(({ client, pending }) => {
    localStorage.setItem("cobrapp.module1.clients.v1", JSON.stringify([client]));
    localStorage.setItem("cobrapp.module2.payments.v1", JSON.stringify([]));
    localStorage.setItem("cobrapp.module2.pending_bank.v1", JSON.stringify([pending]));
    localStorage.setItem("cobrapp.settings.other_charges_retention.v1", JSON.stringify({ "ret-zero-1": 0 }));
    localStorage.setItem("cobrapp.payments.seq.v1", "0");
    localStorage.setItem("cobrapp.module2.cash_closings.v1", JSON.stringify([]));
  }, { client, pending });

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /^Pagos$/i }).click();
  await page.locator("button:has-text('Revisar cargos')").first().click();
  await page.locator("button:has-text('Confirmar y registrar pago')").first().click();

  const state = await page.evaluate(() => {
    const clients = JSON.parse(localStorage.getItem("cobrapp.module1.clients.v1") || "[]");
    const payments = JSON.parse(localStorage.getItem("cobrapp.module2.payments.v1") || "[]");
    return { client: clients[0], payment: payments[0] };
  });

  if (!state.payment) throw new Error("No se registro pago");
  if (state.payment.appliedToRent !== 30) throw new Error(`appliedToRent esperado 30, recibido ${state.payment.appliedToRent}`);
  if (state.payment.otherChargesApplied) {
    throw new Error(`no se esperaban otros cargos automaticos con retencion 0, recibido ${JSON.stringify(state.payment.otherChargesApplied)}`);
  }
  if (state.client.balance !== 120) throw new Error(`balance esperado 120, recibido ${state.client.balance}`);
  if (!state.client.otherCharges || state.client.otherCharges[0]?.amount !== 45) {
    throw new Error(`otros cargos pendientes esperados 45, recibido ${JSON.stringify(state.client.otherCharges)}`);
  }

  console.log("OK retencion 0 por unidad: no aplica descuento automatico a otros cargos.");
  await browser.close();
})().catch((err) => {
  console.error("FALLO TEST RETENCION CERO:", err && err.message ? err.message : err);
  process.exit(1);
});
