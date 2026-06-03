const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(120000);
  await page.goto("http://127.0.0.1:5174/", { waitUntil: "domcontentloaded" });

  const client = {
    id: "c91-client-test",
    unitId: "C91",
    name: "LUIS ALBERTO JIMENEZ MARENGO",
    cedula: "8-123-456",
    rentAmount: 351,
    frequency: "biweekly",
    chargeFirstSunday: false,
    balance: 0,
    advanceBalance: 0,
    savings: 0,
    installmentsAgreed: 300,
    installmentsRemaining: 299,
    installmentsPaid: 1,
    otherCharges: [],
    createdAt: new Date().toISOString(),
    lastChargeDate: "2026-05-15",
    status: "active"
  };

  await page.evaluate(({ client }) => {
    localStorage.setItem("cobrapp.module1.clients.v1", JSON.stringify([client]));
    localStorage.setItem("cobrapp.module2.payments.v1", JSON.stringify([]));
    localStorage.setItem("cobrapp.module2.pending_card.v1", JSON.stringify([]));
    localStorage.setItem("cobrapp.module2.pending_bank.v1", JSON.stringify([]));
    localStorage.setItem("cobrapp.payments.seq.v1", "6140");
    localStorage.setItem("cobrapp.module2.cash_closings.v1", JSON.stringify([]));
  }, { client });

  await page.reload({ waitUntil: "domcontentloaded" });
  const pagosButton = page.getByRole("button", { name: /^Pagos$/i });
  if (await pagosButton.count()) {
    await pagosButton.click();
  } else {
    await page.locator("text=Pagos").first().click();
  }

  await page.locator("button:has-text('Registrar pago')").first().click();
  await page.locator("input[placeholder*='Buscar por unidad']").fill("C91");
  await page.locator(".client-dropdown-item").first().click();
  await page.getByRole("button", { name: "ACH Express" }).click();
  await page.locator("input[placeholder*='Obligatorio para pago bancario']").fill("37162067");
  await page.locator("input.payment-input--amount").fill("351.00");
  await page.getByRole("button", { name: /Confirmar pago y generar recibo/i }).click();
  await page.waitForTimeout(800);

  const receiptText = await page.locator(".receipt-card").first().innerText();

  if (!receiptText.includes("Proximo pago: 15 jun 2026")) {
    throw new Error(`badge incorrecto. Recibido: ${receiptText}`);
  }

  if (!receiptText.includes("Proxima letra") || !receiptText.includes("30 may 2026")) {
    throw new Error("panel de pago adelantado no conserva la letra cubierta (30 may 2026).");
  }

  console.log("OK C91: al pagar por adelantado la letra del 30-may-2026, badge muestra 15-jun-2026.");
  await browser.close();
})().catch((err) => {
  console.error("FALLO TEST C91 PROXIMO PAGO ADELANTADO:", err && err.message ? err.message : err);
  process.exit(1);
});
