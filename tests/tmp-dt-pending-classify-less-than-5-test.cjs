const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:5174/", { waitUntil: "domcontentloaded" });

  const client = {
    id: "dt-pending-2",
    unitId: "D08",
    name: "CLIENTE D08",
    cedula: "8-222-222",
    rentAmount: 36,
    frequency: "daily",
    chargeFirstSunday: false,
    balance: 100,
    advanceBalance: 0,
    savings: 0,
    installmentsAgreed: 100,
    installmentsRemaining: 20,
    installmentsPaid: 80,
    otherCharges: [{ label: "REPARACION", amount: 47 }],
    createdAt: new Date().toISOString(),
    lastChargeDate: "2026-04-21",
    status: "active"
  };

  const pending = {
    folio: "FOLIO-DT-002",
    dateApplied: "2026-04-21",
    amountReceived: 3,
    capitalPart: 3,
    centsPart: 0,
    transactionCode: "253-215",
    referenceId: "D08",
    extractedName: "CLIENTE D08",
    description: "PRUEBA DT PENDIENTE MENOR A 5",
    importedAt: new Date().toISOString(),
    accountNumber: "3380008048",
    mappedGroup: "D",
    suggestedClientId: "dt-pending-2",
    suggestedClientName: "CLIENTE D08"
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
  if (state.payment.appliedToRent !== 0) throw new Error(`appliedToRent esperado 0, recibido ${state.payment.appliedToRent}`);
  if (!state.payment.otherChargesApplied || state.payment.otherChargesApplied[0]?.amount !== 3) {
    throw new Error(`otros cargos aplicados esperados 3, recibido ${JSON.stringify(state.payment.otherChargesApplied)}`);
  }
  if (state.client.balance !== 100) throw new Error(`balance esperado 100, recibido ${state.client.balance}`);
  if (!state.client.otherCharges || state.client.otherCharges[0]?.amount !== 44) {
    throw new Error(`otros cargos pendientes esperados 44, recibido ${JSON.stringify(state.client.otherCharges)}`);
  }

  console.log("OK pendiente D/T: pago menor a 5 va completo a otros cargos.");
  await browser.close();
})().catch((err) => {
  console.error("FALLO TEST PENDIENTE D/T <5:", err && err.message ? err.message : err);
  process.exit(1);
});
