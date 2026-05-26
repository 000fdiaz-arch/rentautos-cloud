const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:5174/", { waitUntil: "domcontentloaded" });

  const client = {
    id: "card-bulk-1",
    unitId: "A10",
    name: "CLIENTE BULK",
    cedula: "8-100-100",
    rentAmount: 20,
    frequency: "daily",
    chargeFirstSunday: false,
    balance: 0,
    advanceBalance: 0,
    savings: 0,
    installmentsAgreed: 100,
    installmentsRemaining: 0,
    installmentsPaid: 100,
    otherCharges: [],
    createdAt: new Date().toISOString(),
    status: "active"
  };

  const pendingA = {
    id: "bulk-pc-1",
    folio: "TMP-20260422-111111",
    clientId: "card-bulk-1",
    clientName: "CLIENTE BULK",
    clientUnit: "A10",
    amountExpected: 12,
    dateRegistered: "2026-04-22",
    expectedSettlementDate: "2026-04-23",
    createdAt: new Date().toISOString()
  };

  const pendingB = {
    id: "bulk-pc-2",
    folio: "TMP-20260422-222222",
    clientId: "card-bulk-1",
    clientName: "CLIENTE BULK",
    clientUnit: "A10",
    amountExpected: 18,
    dateRegistered: "2026-04-22",
    expectedSettlementDate: "2026-04-23",
    createdAt: new Date().toISOString()
  };

  await page.evaluate(({ client, pendingA, pendingB }) => {
    localStorage.setItem("cobrapp.module1.clients.v1", JSON.stringify([client]));
    localStorage.setItem("cobrapp.module2.payments.v1", JSON.stringify([]));
    localStorage.setItem("cobrapp.module2.pending_card.v1", JSON.stringify([pendingA, pendingB]));
    localStorage.setItem("cobrapp.module2.pending_bank.v1", JSON.stringify([]));
    localStorage.setItem("cobrapp.payments.seq.v1", "0");
    localStorage.setItem("cobrapp.module2.cash_closings.v1", JSON.stringify([]));
  }, { client, pendingA, pendingB });

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /^Pagos$/i }).click();
  await page.locator("button:has-text('Pendientes tarjeta')").first().click();
  await page.locator("input[placeholder='Folio final del lote']").fill("POS-LOTE-123");
  await page.locator("button:has-text('Aplicar folio a todos')").click();
  await page.waitForTimeout(400);

  const folios = await page.evaluate(() => {
    const pending = JSON.parse(localStorage.getItem("cobrapp.module2.pending_card.v1") || "[]");
    return pending.map((item) => item.folio);
  });

  if (folios.length !== 2) throw new Error(`se esperaban 2 pendientes, recibido ${folios.length}`);
  if (!folios.every((f) => f === "POS-LOTE-123")) throw new Error(`folios esperados POS-LOTE-123, recibido ${JSON.stringify(folios)}`);

  console.log("OK tarjeta: aplicacion de folio masivo actualiza todos los pendientes.");
  await browser.close();
})().catch((err) => {
  console.error("FALLO TEST TARJETA FOLIO MASIVO:", err && err.message ? err.message : err);
  process.exit(1);
});

