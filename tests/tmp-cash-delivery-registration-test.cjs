const { chromium } = require("playwright");

(async () => {
  const baseUrl = process.env.RENTAUTOS_WORKFLOWS_BASE_URL ?? "http://127.0.0.1:5174/";
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });

  const client = {
    id: "cash-delivery-client",
    unitId: "E47",
    name: "CLIENTE EFECTIVO",
    cedula: "8-777-0047",
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
    createdAt: "2026-08-10T12:00:00.000Z",
    lastChargeDate: "2026-08-09",
    status: "active"
  };

  await page.evaluate((client) => {
    localStorage.setItem("cobrapp.module1.clients.v1", JSON.stringify([client]));
    localStorage.setItem("cobrapp.module2.payments.v1", JSON.stringify([]));
    localStorage.setItem("cobrapp.module2.pending_bank.v1", JSON.stringify([]));
    localStorage.setItem("cobrapp.module2.pending_card.v1", JSON.stringify([]));
    localStorage.setItem("cobrapp.payments.seq.v1", "0");
    localStorage.setItem("cobrapp.module2.cash_closings.v1", JSON.stringify([]));
  }, client);

  await page.goto(new URL("/pagos", baseUrl).href, { waitUntil: "domcontentloaded" });
  const cashQuestion = page.getByRole("radiogroup", { name: "Estado de entrega del efectivo" });
  await cashQuestion.waitFor({ state: "visible" });

  const search = page.locator("input.client-search-input").first();
  await search.fill("E47");
  await page.locator(".client-dropdown-item").first().click();
  await page.locator("input.payment-input--amount").fill("40");

  const confirm = page.getByRole("button", { name: "Confirmar pago y generar recibo" });
  if (!(await confirm.isDisabled())) throw new Error("El pago en efectivo no debe confirmarse sin responder la entrega");

  await cashQuestion.getByRole("button", { name: "Pendiente", exact: true }).click();
  if (await confirm.isDisabled()) throw new Error("El pago debe habilitarse después de clasificar el efectivo");
  await confirm.click();

  await page.waitForFunction(() => {
    const payments = JSON.parse(localStorage.getItem("cobrapp.module2.payments.v1") || "[]");
    return payments.length === 1;
  });
  const payment = await page.evaluate(() => JSON.parse(localStorage.getItem("cobrapp.module2.payments.v1") || "[]")[0]);
  if (payment.paymentMethod !== "Efectivo" || payment.moneyDelivered !== false) throw new Error("El efectivo no quedó guardado como pendiente de entrega");
  if (payment.moneyDeliveryDate) throw new Error("El efectivo pendiente no debe tener fecha de entrega");

  console.log("OK registro efectivo: pregunta obligatoria y estado pendiente guardado.");
  await browser.close();
})().catch((error) => {
  console.error("FALLO REGISTRO EFECTIVO:", error && error.message ? error.message : error);
  process.exit(1);
});
