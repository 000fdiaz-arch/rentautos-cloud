const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:5174/", { waitUntil: "domcontentloaded" });

  const client = {
    id: "non-dt-pending-1",
    unitId: "C71",
    name: "CLIENTE C71",
    cedula: "8-333-333",
    rentAmount: 35,
    frequency: "daily",
    chargeFirstSunday: false,
    balance: 140,
    advanceBalance: 0,
    savings: 0,
    installmentsAgreed: 100,
    installmentsRemaining: 20,
    installmentsPaid: 80,
    otherCharges: [{ label: "ABONO", amount: 120 }],
    createdAt: new Date().toISOString(),
    lastChargeDate: "2026-04-21",
    status: "active"
  };

  const pending = {
    folio: "FOLIO-NONDT-001",
    dateApplied: "2026-04-21",
    amountReceived: 30,
    capitalPart: 30,
    centsPart: 0,
    transactionCode: "253-215",
    referenceId: "C71",
    extractedName: "CLIENTE C71",
    description: "PRUEBA NO DT",
    importedAt: new Date().toISOString(),
    accountNumber: "3380008048",
    mappedGroup: "C",
    suggestedClientId: "non-dt-pending-1",
    suggestedClientName: "CLIENTE C71"
  };

  await page.evaluate(({ client, pending }) => {
    localStorage.setItem("cobrapp.module1.clients.v1", JSON.stringify([client]));
    localStorage.setItem("cobrapp.module2.payments.v1", JSON.stringify([]));
    localStorage.setItem("cobrapp.module2.pending_bank.v1", JSON.stringify([pending]));
    localStorage.setItem("cobrapp.payments.seq.v1", "0");
    localStorage.setItem("cobrapp.module2.cash_closings.v1", JSON.stringify([]));
  }, { client, pending });

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /^Pagos$/i }).click();
  await page.locator("button:has-text('Ver pendientes')").first().click();
  await page.locator("button:has-text('Revisar cargos')").first().click();
  await page.locator("button:has-text('Aplicar pago')").first().click();

  const state = await page.evaluate(() => {
    const clients = JSON.parse(localStorage.getItem("cobrapp.module1.clients.v1") || "[]");
    const payments = JSON.parse(localStorage.getItem("cobrapp.module2.payments.v1") || "[]");
    return { client: clients[0], payment: payments[0] };
  });

  if (!state.payment) throw new Error("No se registro pago");
  if (state.payment.appliedToRent !== 25) throw new Error(`appliedToRent esperado 25, recibido ${state.payment.appliedToRent}`);
  if (!state.payment.otherChargesApplied || state.payment.otherChargesApplied[0]?.amount !== 5) {
    throw new Error(`otros cargos aplicados esperados 5, recibido ${JSON.stringify(state.payment.otherChargesApplied)}`);
  }
  if (state.client.balance !== 115) throw new Error(`balance esperado 115, recibido ${state.client.balance}`);
  if (!state.client.otherCharges || state.client.otherCharges[0]?.amount !== 115) {
    throw new Error(`otros cargos pendientes esperados 115, recibido ${JSON.stringify(state.client.otherCharges)}`);
  }

  console.log("OK pendiente no D/T: aplica retencion automatica configurable por unidad.");
  await browser.close();
})().catch((err) => {
  console.error("FALLO TEST PENDIENTE NO D/T (RETENCION CONFIGURABLE):", err && err.message ? err.message : err);
  process.exit(1);
});
