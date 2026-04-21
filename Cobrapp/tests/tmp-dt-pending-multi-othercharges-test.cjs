const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:5174/", { waitUntil: "domcontentloaded" });

  const client = {
    id: "dt-pending-3",
    unitId: "T10",
    name: "CLIENTE T10",
    cedula: "8-333-333",
    rentAmount: 35,
    frequency: "daily",
    chargeFirstSunday: false,
    balance: 100,
    advanceBalance: 0,
    savings: 0,
    installmentsAgreed: 100,
    installmentsRemaining: 20,
    installmentsPaid: 80,
    otherCharges: [
      { label: "PIEZAS", amount: 4 },
      { label: "COLISION", amount: 10 }
    ],
    createdAt: new Date().toISOString(),
    lastChargeDate: "2026-04-21",
    status: "active"
  };

  const pending = {
    folio: "FOLIO-DT-003",
    dateApplied: "2026-04-21",
    amountReceived: 5,
    capitalPart: 5,
    centsPart: 0,
    transactionCode: "253-215",
    referenceId: "T10",
    extractedName: "CLIENTE T10",
    description: "PRUEBA DT MULTI CARGOS",
    importedAt: new Date().toISOString(),
    accountNumber: "3380008048",
    mappedGroup: "T",
    suggestedClientId: "dt-pending-3",
    suggestedClientName: "CLIENTE T10"
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
  await page.locator("button:has-text('Confirmar y registrar pago')").first().click();

  const state = await page.evaluate(() => {
    const clients = JSON.parse(localStorage.getItem("cobrapp.module1.clients.v1") || "[]");
    const payments = JSON.parse(localStorage.getItem("cobrapp.module2.payments.v1") || "[]");
    return { client: clients[0], payment: payments[0] };
  });

  if (!state.payment) throw new Error("No se registro pago");
  if (state.payment.appliedToRent !== 0) throw new Error(`appliedToRent esperado 0, recibido ${state.payment.appliedToRent}`);
  const applied = state.payment.otherChargesApplied || [];
  if (applied.length !== 2 || applied[0].amount !== 4 || applied[1].amount !== 1) {
    throw new Error(`distribucion esperada [4,1], recibido ${JSON.stringify(applied)}`);
  }
  const due = state.client.otherCharges || [];
  if (due.length !== 1 || due[0].label !== "COLISION" || due[0].amount !== 9) {
    throw new Error(`saldo pendiente esperado COLISION=9, recibido ${JSON.stringify(due)}`);
  }

  console.log("OK pendiente D/T multi-cargos: distribuye 5 sin errores entre varios conceptos.");
  await browser.close();
})().catch((err) => {
  console.error("FALLO TEST PENDIENTE D/T MULTI-CARGOS:", err && err.message ? err.message : err);
  process.exit(1);
});
