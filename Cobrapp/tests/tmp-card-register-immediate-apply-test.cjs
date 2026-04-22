const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:5174/", { waitUntil: "domcontentloaded" });

  const client = {
    id: "card-register-1",
    unitId: "T26",
    name: "CLIENTE TARJETA REG",
    cedula: "8-000-111",
    rentAmount: 25,
    frequency: "daily",
    chargeFirstSunday: false,
    balance: 100,
    advanceBalance: 0,
    savings: 0,
    installmentsAgreed: 100,
    installmentsRemaining: 10,
    installmentsPaid: 90,
    otherCharges: [],
    createdAt: new Date().toISOString(),
    lastChargeDate: "2026-04-21",
    status: "active"
  };

  await page.evaluate(({ client }) => {
    localStorage.setItem("cobrapp.module1.clients.v1", JSON.stringify([client]));
    localStorage.setItem("cobrapp.module2.payments.v1", JSON.stringify([]));
    localStorage.setItem("cobrapp.module2.pending_card.v1", JSON.stringify([]));
    localStorage.setItem("cobrapp.module2.pending_bank.v1", JSON.stringify([]));
    localStorage.setItem("cobrapp.payments.seq.v1", "0");
    localStorage.setItem("cobrapp.module2.cash_closings.v1", JSON.stringify([]));
  }, { client });

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /^Pagos$/i }).click();
  await page.locator("button:has-text('Registrar pago')").first().click();

  await page.locator("input[placeholder*='Buscar por unidad']").fill("T26");
  await page.locator(".client-dropdown-item").first().click();
  await page.getByRole("button", { name: "Tarjeta" }).click();
  await page.locator("input.payment-input--amount").fill("30");
  await page.getByRole("button", { name: /Confirmar pago y generar recibo/i }).click();
  await page.waitForTimeout(600);

  const state = await page.evaluate(() => {
    const clients = JSON.parse(localStorage.getItem("cobrapp.module1.clients.v1") || "[]");
    const payments = JSON.parse(localStorage.getItem("cobrapp.module2.payments.v1") || "[]");
    const pendingCards = JSON.parse(localStorage.getItem("cobrapp.module2.pending_card.v1") || "[]");
    return { client: clients[0], payment: payments[0], pending: pendingCards[0], paymentsCount: payments.length, pendingCount: pendingCards.length };
  });

  if (state.paymentsCount !== 1) throw new Error(`se esperaba 1 pago registrado, recibido ${state.paymentsCount}`);
  if (state.pendingCount !== 1) throw new Error(`se esperaba 1 pendiente tarjeta, recibido ${state.pendingCount}`);
  if (state.payment.paymentMethod !== "Tarjeta") throw new Error(`paymentMethod esperado Tarjeta, recibido ${state.payment.paymentMethod}`);
  if (state.client.balance !== 70) throw new Error(`balance esperado 70 (aplicacion inmediata), recibido ${state.client.balance}`);
  if (state.pending.appliedPaymentId !== state.payment.id) throw new Error("El pendiente tarjeta no quedo vinculado al pago aplicado");
  if (!String(state.pending.folio || "").startsWith("TMP-")) throw new Error(`se esperaba folio temporal TMP-..., recibido ${state.pending.folio}`);

  console.log("OK tarjeta: registro aplica saldo inmediato y deja pendiente conciliacion vinculado.");
  await browser.close();
})().catch((err) => {
  console.error("FALLO TEST TARJETA REGISTRO INMEDIATO:", err && err.message ? err.message : err);
  process.exit(1);
});

