const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:5174/", { waitUntil: "domcontentloaded" });

  const client = {
    id: "ret-custom-1",
    unitId: "Q12",
    name: "CLIENTE Q12",
    cedula: "8-444-444",
    rentAmount: 40,
    frequency: "monthly",
    balance: 200,
    advanceBalance: 0,
    savings: 0,
    installmentsAgreed: 100,
    installmentsRemaining: 20,
    installmentsPaid: 80,
    otherCharges: [{ label: "REPARACION", amount: 25 }],
    createdAt: new Date().toISOString(),
    status: "active"
  };

  const pending = {
    folio: "FOLIO-RET-CUSTOM-001",
    dateApplied: "2026-04-21",
    amountReceived: 30,
    capitalPart: 30,
    centsPart: 0,
    transactionCode: "253-215",
    referenceId: "Q12",
    extractedName: "CLIENTE Q12",
    description: "PRUEBA RETENCION CUSTOM",
    importedAt: new Date().toISOString(),
    accountNumber: "3380008048",
    mappedGroup: "Q",
    suggestedClientId: "ret-custom-1",
    suggestedClientName: "CLIENTE Q12"
  };

  await page.evaluate(({ client, pending }) => {
    localStorage.setItem("cobrapp.module1.clients.v1", JSON.stringify([client]));
    localStorage.setItem("cobrapp.module2.payments.v1", JSON.stringify([]));
    localStorage.setItem("cobrapp.module2.pending_bank.v1", JSON.stringify([pending]));
    localStorage.setItem("cobrapp.settings.other_charges_retention.v1", JSON.stringify({ "ret-custom-1": 8 }));
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
  if (state.payment.appliedToRent !== 22) throw new Error(`appliedToRent esperado 22, recibido ${state.payment.appliedToRent}`);
  if (!state.payment.otherChargesApplied || state.payment.otherChargesApplied[0]?.amount !== 8) {
    throw new Error(`otros cargos aplicados esperados 8, recibido ${JSON.stringify(state.payment.otherChargesApplied)}`);
  }
  if (state.client.balance !== 178) throw new Error(`balance esperado 178, recibido ${state.client.balance}`);
  if (!state.client.otherCharges || state.client.otherCharges[0]?.amount !== 17) {
    throw new Error(`otros cargos pendientes esperados 17, recibido ${JSON.stringify(state.client.otherCharges)}`);
  }

  console.log("OK retencion custom por unidad: aplica 8 a otros cargos.");
  await browser.close();
})().catch((err) => {
  console.error("FALLO TEST RETENCION CUSTOM:", err && err.message ? err.message : err);
  process.exit(1);
});
