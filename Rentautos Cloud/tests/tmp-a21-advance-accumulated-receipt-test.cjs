const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:5174/", { waitUntil: "domcontentloaded" });

  const client = {
    id: "a21-client-test",
    unitId: "A21",
    name: "YENIFER MASSIEL SALAZAR VERGARA",
    cedula: "8-777-888",
    rentAmount: 299,
    frequency: "biweekly",
    chargeFirstSunday: false,
    balance: 0,
    advanceBalance: 0,
    savings: 0,
    installmentsAgreed: 300,
    installmentsRemaining: 298,
    installmentsPaid: 2,
    otherCharges: [],
    createdAt: new Date().toISOString(),
    lastChargeDate: "2026-04-22",
    status: "active"
  };

  await page.evaluate(({ client }) => {
    localStorage.setItem("cobrapp.module1.clients.v1", JSON.stringify([client]));
    localStorage.setItem("cobrapp.module2.payments.v1", JSON.stringify([]));
    localStorage.setItem("cobrapp.module2.pending_card.v1", JSON.stringify([]));
    localStorage.setItem("cobrapp.module2.pending_bank.v1", JSON.stringify([]));
    localStorage.setItem("cobrapp.payments.seq.v1", "1173");
    localStorage.setItem("cobrapp.module2.cash_closings.v1", JSON.stringify([]));
  }, { client });

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /^Pagos$/i }).click();

  async function registerAdvancePayment(amount, folio) {
    await page.locator("button:has-text('Registrar pago')").first().click();
    await page.locator("input[placeholder*='Buscar por unidad']").fill("A21");
    await page.locator(".client-dropdown-item").first().click();
    await page.getByRole("button", { name: "ACH Express" }).click();
    await page.locator("input[placeholder*='Obligatorio para pago bancario']").fill(folio);
    await page.locator("input.payment-input--amount").fill(String(amount));
    await page.getByRole("button", { name: /Confirmar pago y generar recibo/i }).click();
    await page.waitForTimeout(700);

    const receiptText = await page.locator(".receipt-card").first().innerText();
    await page.getByRole("button", { name: /Registrar otro pago/i }).click();
    await page.waitForTimeout(250);
    return receiptText;
  }

  const firstReceipt = await registerAdvancePayment("100.21", "2070124228");
  const secondReceipt = await registerAdvancePayment("20.21", "2073356905");

  const state = await page.evaluate(() => {
    const payments = JSON.parse(localStorage.getItem("cobrapp.module2.payments.v1") || "[]");
    const clients = JSON.parse(localStorage.getItem("cobrapp.module1.clients.v1") || "[]");
    return { payments, client: clients[0] };
  });

  if (state.payments.length !== 2) throw new Error(`se esperaban 2 pagos, recibido ${state.payments.length}`);
  if (Number(state.payments[0].advanceBalanceAfter || 0) !== 100) throw new Error(`primer pago advanceBalanceAfter esperado 100, recibido ${state.payments[0].advanceBalanceAfter}`);
  if (Number(state.payments[1].advanceBalanceAfter || 0) !== 120) throw new Error(`segundo pago advanceBalanceAfter esperado 120, recibido ${state.payments[1].advanceBalanceAfter}`);
  if (Number(state.client.advanceBalance || 0) !== 120) throw new Error(`cliente advanceBalance esperado 120, recibido ${state.client.advanceBalance}`);

  if (!secondReceipt.includes("Abonado acumulado a esa letra") || !secondReceipt.includes("$120.00")) {
    throw new Error("el recibo 2 no muestra abonado acumulado de $120.00");
  }
  if (!secondReceipt.includes("Faltan para completarla") || !secondReceipt.includes("$179.00")) {
    throw new Error("el recibo 2 no muestra faltante de $179.00");
  }

  console.log("OK A21: acumulado adelantado 100 + 20 se refleja en recibo (120 abonado, 179 faltante).");
  await browser.close();
})().catch((err) => {
  console.error("FALLO TEST A21 ADELANTO ACUMULADO:", err && err.message ? err.message : err);
  process.exit(1);
});
