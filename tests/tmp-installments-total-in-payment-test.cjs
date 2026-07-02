const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:5174/", { waitUntil: "domcontentloaded" });

  const client = {
    id: "inst-total-1",
    unitId: "A55",
    name: "CLIENTE A55",
    cedula: "9-732-2372",
    rentAmount: 29,
    frequency: "daily",
    chargeFirstSunday: false,
    balance: 29,
    advanceBalance: 0,
    savings: 0,
    installmentsAgreed: 730,
    installmentsRemaining: 730,
    installmentsPaid: 0,
    otherCharges: [],
    createdAt: new Date().toISOString(),
    lastChargeDate: "2026-04-21",
    status: "active"
  };

  const pending = {
    folio: "FOLIO-INST-001",
    dateApplied: "2026-04-21",
    amountReceived: 58,
    capitalPart: 58,
    centsPart: 0,
    transactionCode: "253-215",
    referenceId: "A55",
    extractedName: "CLIENTE A55",
    description: "PRUEBA CUOTAS TOTALES",
    importedAt: new Date().toISOString(),
    accountNumber: "3380008048",
    mappedGroup: "A",
    suggestedClientId: "inst-total-1",
    suggestedClientName: "CLIENTE A55"
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
  await page.locator("button:has-text('Revisar')").first().click();
  await page.locator("button:has-text('Aplicar pago')").first().click();

  const state = await page.evaluate(() => {
    const payments = JSON.parse(localStorage.getItem("cobrapp.module2.payments.v1") || "[]");
    return payments[0];
  });

  if (!state) throw new Error("No se registro pago");
  if (state.installmentsFromDebt !== 1) throw new Error(`installmentsFromDebt esperado 1, recibido ${state.installmentsFromDebt}`);
  if (state.installmentsFromAdvance !== 1) throw new Error(`installmentsFromAdvance esperado 1, recibido ${state.installmentsFromAdvance}`);
  if (state.installmentsTotalInPayment !== 2) throw new Error(`installmentsTotalInPayment esperado 2, recibido ${state.installmentsTotalInPayment}`);

  console.log("OK cuotas totales: 1 vencida + 1 adelantada = 2.");
  await browser.close();
})().catch((err) => {
  console.error("FALLO TEST CUOTAS TOTALES:", err && err.message ? err.message : err);
  process.exit(1);
});
