const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:5174/", { waitUntil: "domcontentloaded" });

  const client = {
    id: "dt-manual-1",
    unitId: "T01",
    name: "CLIENTE T01",
    cedula: "8-111-111",
    rentAmount: 30,
    frequency: "daily",
    chargeFirstSunday: false,
    balance: 225,
    advanceBalance: 0,
    savings: 0,
    installmentsAgreed: 100,
    installmentsRemaining: 20,
    installmentsPaid: 80,
    otherCharges: [{ label: "REPARACION", amount: 1285 }],
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
  await clientSearch.fill("T01");
  await page.locator(".client-dropdown-item").first().click();

  await page.getByLabel("Monto recibido (USD)").fill("30");
  await page.getByRole("button", { name: /Confirmar pago y generar recibo/i }).click();

  const state = await page.evaluate(() => {
    const clients = JSON.parse(localStorage.getItem("cobrapp.module1.clients.v1") || "[]");
    const payments = JSON.parse(localStorage.getItem("cobrapp.module2.payments.v1") || "[]");
    return { client: clients[0], payment: payments[0] };
  });

  if (!state.payment) throw new Error("No se registro pago");
  if (state.payment.appliedToRent !== 25) throw new Error(`appliedToRent esperado 25, recibido ${state.payment.appliedToRent}`);
  if (!state.payment.otherChargesApplied || state.payment.otherChargesApplied[0]?.amount !== 5) {
    throw new Error(`otros cargos aplicados esperados 5, recibido ${JSON.stringify(state.payment.otherChargesApplied)}`);
  }
  if (state.client.balance !== 200) throw new Error(`balance esperado 200, recibido ${state.client.balance}`);
  if (!state.client.otherCharges || state.client.otherCharges[0]?.amount !== 1280) {
    throw new Error(`otros cargos pendientes esperados 1280, recibido ${JSON.stringify(state.client.otherCharges)}`);
  }

  console.log("OK manual D/T: pago 30 => 5 a otros cargos y 25 a renta.");
  await browser.close();
})().catch((err) => {
  console.error("FALLO TEST D/T MANUAL 30:", err && err.message ? err.message : err);
  process.exit(1);
});
