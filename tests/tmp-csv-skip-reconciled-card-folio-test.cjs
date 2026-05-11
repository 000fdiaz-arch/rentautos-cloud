const { chromium } = require("playwright");

(async () => {
  const csvText = [
    "Cuenta,Folio,Credito,Descripcion",
    "3380008048,2070201997,94.52,V MC PAGO DE FACTURA",
    "3380008048,2071488147,25.20,UNIDAD 20"
  ].join("\n");

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.addInitScript((text) => {
    window.showOpenFilePicker = async () => [
      {
        async getFile() {
          return new File([text], "movimientos.csv", { type: "text/csv" });
        }
      }
    ];
  }, csvText);

  await page.goto("http://127.0.0.1:5174/", { waitUntil: "domcontentloaded" });

  const nowIso = new Date().toISOString();
  const reconciledCardPayment = {
    id: "pay-card-reconciled-2070201997",
    receiptNumber: "REC-5000",
    clientId: "client-t01",
    clientName: "CLIENTE T01",
    clientUnit: "T01",
    clientCedula: "8-000-000",
    dateApplied: "2026-04-22",
    paymentMethod: "Tarjeta",
    reference: "FOLIO:2070201997 | TARJETA-PENDIENTE-CONCILIACION | 2070201997 | TARJETA-CONCILIADA | FOLIO:2070201997 | FECHA-BANCO:2026-04-22",
    amountReceived: 94.52,
    appliedToRent: 94,
    centavosAhorro: 0.52,
    installmentsDeducted: 3,
    installmentsFromDebt: 3,
    installmentsFromAdvance: 0,
    installmentsTotalInPayment: 3,
    balanceBefore: 200,
    balanceAfter: 106,
    savingsBefore: 0,
    savingsAfter: 0.52,
    installmentsPaidAfter: 243,
    installmentsRemainingAfter: 497,
    rentAmount: 30,
    frequency: "daily",
    createdAt: nowIso
  };

  const client = {
    id: "client-t01",
    unitId: "T01",
    name: "CLIENTE T01",
    cedula: "8-000-000",
    rentAmount: 30,
    frequency: "daily",
    chargeFirstSunday: false,
    balance: 106,
    advanceBalance: 0,
    savings: 0.52,
    installmentsAgreed: 740,
    installmentsRemaining: 497,
    installmentsPaid: 243,
    otherCharges: [],
    createdAt: nowIso,
    lastChargeDate: "2026-04-22",
    status: "active"
  };

  const bankRule = {
    id: "rule-t-3380008048",
    accountNumber: "3380008048",
    groupCode: "T",
    active: true,
    createdAt: nowIso,
    updatedAt: nowIso
  };

  await page.evaluate(({ client, payment, bankRule }) => {
    localStorage.setItem("cobrapp.module1.clients.v1", JSON.stringify([client]));
    localStorage.setItem("cobrapp.module2.payments.v1", JSON.stringify([payment]));
    localStorage.setItem("cobrapp.module2.pending_bank.v1", JSON.stringify([]));
    localStorage.setItem("cobrapp.module2.pending_card.v1", JSON.stringify([]));
    localStorage.setItem("cobrapp.settings.bank_rules.v1", JSON.stringify([bankRule]));
    localStorage.setItem("cobrapp.module2.cash_closings.v1", JSON.stringify([]));
  }, { client, payment: reconciledCardPayment, bankRule });

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /^Pagos$/i }).click();

  await page.getByRole("button", { name: /Importar CSV/i }).first().click();
  await page.waitForTimeout(800);

  const state = await page.evaluate(() => {
    const pendingBankItems = JSON.parse(localStorage.getItem("cobrapp.module2.pending_bank.v1") || "[]");
    return {
      pendingBankItems,
      pendingFolios: pendingBankItems.map((item) => String(item.folio || "").toUpperCase())
    };
  });

  if (state.pendingFolios.includes("2070201997")) {
    throw new Error("El folio 2070201997 no debio volver a cargarse desde CSV porque ya estaba conciliado en tarjeta.");
  }
  if (!state.pendingFolios.includes("2071488147")) {
    throw new Error(`Se esperaba conservar el nuevo folio 2071488147. Folios obtenidos: ${JSON.stringify(state.pendingFolios)}`);
  }
  if (state.pendingBankItems.length !== 1) {
    throw new Error(`Se esperaba 1 pendiente nuevo, recibido ${state.pendingBankItems.length}`);
  }

  console.log("OK CSV: se omite folio de tarjeta ya conciliado y solo entra folio nuevo.");
  await browser.close();
})().catch((err) => {
  console.error("FALLO TEST CSV OMITE TARJETA CONCILIADA:", err && err.message ? err.message : err);
  process.exit(1);
});
