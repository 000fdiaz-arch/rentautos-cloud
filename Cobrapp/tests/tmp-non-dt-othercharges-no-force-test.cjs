const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:5174/", { waitUntil: "domcontentloaded" });

  const client = {
    id: "non-dt-manual-1",
    unitId: "C71",
    name: "CLIENTE C71",
    cedula: "8-333-333",
    rentAmount: 35,
    frequency: "daily",
    chargeFirstSunday: false,
    balance: 140,
    advanceBalance: 0,
    savings: 0,
    installmentsAgreed: 100,
    installmentsRemaining: 20,
    installmentsPaid: 80,
    otherCharges: [{ label: "ABONO", amount: 120 }],
    createdAt: new Date().toISOString(),
    lastChargeDate: "2026-04-21",
    status: "active"
  };

  await page.evaluate(({ client }) => {
    localStorage.setItem("cobrapp.module1.clients.v1", JSON.stringify([client]));
    localStorage.setItem("cobrapp.module2.payments.v1", JSON.stringify([]));
    localStorage.setItem("cobrapp.module2.pending_bank.v1", JSON.stringify([]));
    localStorage.setItem("cobrapp.payments.seq.v1", "0");
    localStorage.setItem("cobrapp.module2.cash_closings.v1", JSON.stringify([]));
  }, { client });

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /^Pagos$/i }).click();
  const registerToggle = page.getByRole("button", { name: /Registrar pago|Cerrar/i }).first();
  if (await registerToggle.count()) {
    const label = await registerToggle.innerText();
    if (!/Cerrar/i.test(label)) await registerToggle.click();
  }

  const clientSearch = page.locator("input.client-search-input").first();
  await clientSearch.waitFor({ state: "visible" });
  await clientSearch.fill("C71");
  await page.locator(".client-dropdown-item").first().click();

  await page.getByLabel("Monto recibido (USD)").fill("30");
  await page.getByRole("button", { name: /Confirmar pago y generar recibo/i }).click();

  const state = await page.evaluate(() => {
    const clients = JSON.parse(localStorage.getItem("cobrapp.module1.clients.v1") || "[]");
    const payments = JSON.parse(localStorage.getItem("cobrapp.module2.payments.v1") || "[]");
    return { client: clients[0], payment: payments[0] };
  });

  if (!state.payment) throw new Error("No se registro pago");
  if (state.payment.appliedToRent !== 30) throw new Error(`appliedToRent esperado 30, recibido ${state.payment.appliedToRent}`);
  if (state.payment.otherChargesApplied) {
    throw new Error(`no se esperaba regla forzada fuera de D/T, recibido ${JSON.stringify(state.payment.otherChargesApplied)}`);
  }
  if (state.client.balance !== 110) throw new Error(`balance esperado 110, recibido ${state.client.balance}`);
  if (!state.client.otherCharges || state.client.otherCharges[0]?.amount !== 120) {
    throw new Error(`otros cargos deben quedar iguales en grupo no D/T, recibido ${JSON.stringify(state.client.otherCharges)}`);
  }

  console.log("OK control no D/T: no aplica regla fija de 5.");
  await browser.close();
})().catch((err) => {
  console.error("FALLO TEST NO D/T:", err && err.message ? err.message : err);
  process.exit(1);
});
