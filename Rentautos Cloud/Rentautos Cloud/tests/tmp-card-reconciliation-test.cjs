const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:5174/", { waitUntil: "domcontentloaded" });

  const client = {
    id: "card-client-1",
    unitId: "A55",
    name: "CLIENTE TARJETA",
    cedula: "9-732-2372",
    rentAmount: 29,
    frequency: "daily",
    chargeFirstSunday: false,
    balance: 8,
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

  const appliedPaymentA = {
    id: "pay-card-a",
    receiptNumber: "REC-0900",
    clientId: "card-client-1",
    clientName: "CLIENTE TARJETA",
    clientUnit: "A55",
    clientCedula: "9-732-2372",
    dateApplied: "2026-04-21",
    paymentMethod: "Tarjeta",
    reference: "FOLIO:TMP-20260421-A | TARJETA-PENDIENTE-CONCILIACION | PENDIENTE-FOLIO",
    amountReceived: 30,
    appliedToRent: 30,
    centavosAhorro: 0,
    installmentsDeducted: 1,
    installmentsFromDebt: 1,
    installmentsFromAdvance: 0,
    installmentsTotalInPayment: 1,
    balanceBefore: 58,
    balanceAfter: 28,
    savingsBefore: 0,
    savingsAfter: 0,
    installmentsPaidAfter: 1,
    installmentsRemainingAfter: 729,
    rentAmount: 29,
    frequency: "daily",
    createdAt: new Date().toISOString()
  };

  const appliedPaymentB = {
    id: "pay-card-b",
    receiptNumber: "REC-0901",
    clientId: "card-client-1",
    clientName: "CLIENTE TARJETA",
    clientUnit: "A55",
    clientCedula: "9-732-2372",
    dateApplied: "2026-04-21",
    paymentMethod: "Tarjeta",
    reference: "FOLIO:TMP-20260421-B | TARJETA-PENDIENTE-CONCILIACION | PENDIENTE-FOLIO",
    amountReceived: 20,
    appliedToRent: 20,
    centavosAhorro: 0,
    installmentsDeducted: 0,
    installmentsFromDebt: 0,
    installmentsFromAdvance: 0,
    installmentsTotalInPayment: 0,
    balanceBefore: 28,
    balanceAfter: 8,
    savingsBefore: 0,
    savingsAfter: 0,
    installmentsPaidAfter: 1,
    installmentsRemainingAfter: 729,
    rentAmount: 29,
    frequency: "daily",
    createdAt: new Date().toISOString()
  };

  const pendingCardA = {
    id: "pc-1",
    appliedPaymentId: "pay-card-a",
    folio: "CARD-001",
    clientId: "card-client-1",
    clientName: "CLIENTE TARJETA",
    clientUnit: "A55",
    amountExpected: 30,
    dateRegistered: "2026-04-21",
    expectedSettlementDate: "2026-04-22",
    createdAt: new Date().toISOString()
  };

  const pendingCardB = {
    id: "pc-2",
    appliedPaymentId: "pay-card-b",
    folio: "CARD-001",
    clientId: "card-client-1",
    clientName: "CLIENTE TARJETA",
    clientUnit: "A55",
    amountExpected: 20,
    dateRegistered: "2026-04-21",
    expectedSettlementDate: "2026-04-22",
    createdAt: new Date().toISOString()
  };

  const pendingBank = {
    folio: "CARD-001",
    dateApplied: "2026-04-22",
    amountReceived: 50,
    capitalPart: 50,
    centsPart: 0,
    transactionCode: "253-215",
    referenceId: "A55",
    extractedName: "CLIENTE TARJETA",
    description: "LIQ TARJETA",
    importedAt: new Date().toISOString(),
    accountNumber: "3380008048",
    mappedGroup: "A",
    suggestedClientId: "card-client-1",
    suggestedClientName: "CLIENTE TARJETA"
  };

  await page.evaluate(({ client, pendingCardA, pendingCardB, pendingBank, appliedPaymentA, appliedPaymentB }) => {
    localStorage.setItem("cobrapp.module1.clients.v1", JSON.stringify([client]));
    localStorage.setItem("cobrapp.module2.payments.v1", JSON.stringify([appliedPaymentA, appliedPaymentB]));
    localStorage.setItem("cobrapp.module2.pending_card.v1", JSON.stringify([pendingCardA, pendingCardB]));
    localStorage.setItem("cobrapp.module2.pending_bank.v1", JSON.stringify([pendingBank]));
    localStorage.setItem("cobrapp.payments.seq.v1", "901");
    localStorage.setItem("cobrapp.module2.cash_closings.v1", JSON.stringify([]));
  }, { client, pendingCardA, pendingCardB, pendingBank, appliedPaymentA, appliedPaymentB });

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /^Pagos$/i }).click();
  await page.waitForTimeout(700);

  const state = await page.evaluate(() => {
    const payments = JSON.parse(localStorage.getItem("cobrapp.module2.payments.v1") || "[]");
    const pendingCards = JSON.parse(localStorage.getItem("cobrapp.module2.pending_card.v1") || "[]");
    const pendingBanks = JSON.parse(localStorage.getItem("cobrapp.module2.pending_bank.v1") || "[]");
    const clients = JSON.parse(localStorage.getItem("cobrapp.module1.clients.v1") || "[]");
    return { payments, pendingCards, pendingBanks, client: clients[0] };
  });

  if (state.payments.length !== 2) throw new Error(`se esperaban 2 pagos originales, recibido ${state.payments.length}`);
  if (!String(state.payments[0].reference || "").includes("TARJETA-CONCILIADA")) throw new Error("Pago A no fue marcado como conciliado");
  if (!String(state.payments[1].reference || "").includes("TARJETA-CONCILIADA")) throw new Error("Pago B no fue marcado como conciliado");
  if (state.pendingCards.length !== 0) throw new Error(`pendientes tarjeta esperados 0, recibido ${state.pendingCards.length}`);
  if (state.pendingBanks.length !== 0) throw new Error(`pendientes banco esperados 0, recibido ${state.pendingBanks.length}`);
  if (state.client.balance !== 8) throw new Error(`balance del cliente no debe alterarse en conciliacion, recibido ${state.client.balance}`);

  console.log("OK tarjeta: conciliacion por lote limpia pendientes y marca pagos sin reaplicar saldo.");
  await browser.close();
})().catch((err) => {
  console.error("FALLO TEST TARJETA CONCILIACION:", err && err.message ? err.message : err);
  process.exit(1);
});
