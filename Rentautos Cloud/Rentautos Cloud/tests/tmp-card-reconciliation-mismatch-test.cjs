const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:5174/", { waitUntil: "domcontentloaded" });

  const client = {
    id: "card-client-2",
    unitId: "A56",
    name: "CLIENTE TARJETA 2",
    cedula: "9-111-2222",
    rentAmount: 29,
    frequency: "daily",
    chargeFirstSunday: false,
    balance: 58,
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

  const existingPayment = {
    id: "pay-card-mismatch",
    receiptNumber: "REC-0990",
    clientId: "card-client-2",
    clientName: "CLIENTE TARJETA 2",
    clientUnit: "A56",
    clientCedula: "9-111-2222",
    dateApplied: "2026-04-21",
    paymentMethod: "Tarjeta",
    reference: "FOLIO:TMP-20260421-XYZ | TARJETA-PENDIENTE-CONCILIACION | PENDIENTE",
    amountReceived: 58,
    appliedToRent: 58,
    centavosAhorro: 0,
    installmentsDeducted: 2,
    installmentsFromDebt: 2,
    installmentsFromAdvance: 0,
    installmentsTotalInPayment: 2,
    balanceBefore: 58,
    balanceAfter: 0,
    savingsBefore: 0,
    savingsAfter: 0,
    installmentsPaidAfter: 2,
    installmentsRemainingAfter: 728,
    rentAmount: 29,
    frequency: "daily",
    createdAt: new Date().toISOString()
  };

  const pendingCard = {
    id: "pc-2",
    appliedPaymentId: "pay-card-mismatch",
    folio: "CARD-002",
    clientId: "card-client-2",
    clientName: "CLIENTE TARJETA 2",
    clientUnit: "A56",
    amountExpected: 58,
    dateRegistered: "2026-04-21",
    expectedSettlementDate: "2026-04-22",
    createdAt: new Date().toISOString()
  };

  const pendingBank = {
    folio: "CARD-002",
    dateApplied: "2026-04-22",
    amountReceived: 57.5,
    capitalPart: 57,
    centsPart: 0.5,
    transactionCode: "253-215",
    referenceId: "A56",
    extractedName: "CLIENTE TARJETA 2",
    description: "LIQ TARJETA",
    importedAt: new Date().toISOString(),
    accountNumber: "3380008048",
    mappedGroup: "A",
    suggestedClientId: "card-client-2",
    suggestedClientName: "CLIENTE TARJETA 2"
  };

  await page.evaluate(({ client, pendingCard, pendingBank, existingPayment }) => {
    localStorage.setItem("cobrapp.module1.clients.v1", JSON.stringify([client]));
    localStorage.setItem("cobrapp.module2.payments.v1", JSON.stringify([existingPayment]));
    localStorage.setItem("cobrapp.module2.pending_card.v1", JSON.stringify([pendingCard]));
    localStorage.setItem("cobrapp.module2.pending_bank.v1", JSON.stringify([pendingBank]));
    localStorage.setItem("cobrapp.payments.seq.v1", "990");
    localStorage.setItem("cobrapp.module2.cash_closings.v1", JSON.stringify([]));
  }, { client, pendingCard, pendingBank, existingPayment });

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /^Pagos$/i }).click();
  await page.waitForTimeout(700);

  const state = await page.evaluate(() => {
    const payments = JSON.parse(localStorage.getItem("cobrapp.module2.payments.v1") || "[]");
    const pendingCards = JSON.parse(localStorage.getItem("cobrapp.module2.pending_card.v1") || "[]");
    const pendingBanks = JSON.parse(localStorage.getItem("cobrapp.module2.pending_bank.v1") || "[]");
    return { payments, pendingCards, pendingBanks };
  });

  if (state.payments.length !== 1) throw new Error(`se esperaba conservar 1 pago original, recibido ${state.payments.length}`);
  if (String(state.payments[0].reference || "").includes("TARJETA-CONCILIADA")) throw new Error("No debia marcarse conciliado por mismatch de monto");
  if (state.pendingCards.length !== 1) throw new Error(`pendiente tarjeta esperado 1, recibido ${state.pendingCards.length}`);
  if (state.pendingBanks.length !== 1) throw new Error(`pendiente banco esperado 1, recibido ${state.pendingBanks.length}`);

  console.log("OK tarjeta: si el monto del lote no coincide, no concilia ni altera pagos.");
  await browser.close();
})().catch((err) => {
  console.error("FALLO TEST TARJETA MISMATCH:", err && err.message ? err.message : err);
  process.exit(1);
});
