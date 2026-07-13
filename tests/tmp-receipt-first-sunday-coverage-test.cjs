const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const ROOT = path.resolve(__dirname, "..");
const TMP_DIR = path.join(ROOT, ".tmp", `receipt-first-sunday-test-${Date.now()}`);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function transpileTo(filePath, outPath, extraSource = "") {
  const source = fs.readFileSync(filePath, "utf8") + extraSource;
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.React,
      esModuleInterop: true
    },
    fileName: filePath
  }).outputText;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, output, "utf8");
}

function makePayment(overrides) {
  return {
    id: "payment-test",
    receiptNumber: "REC-TEST",
    receiptDeliveryStatus: "pending",
    clientId: "client-test",
    clientName: "CLIENTE TEST",
    clientUnit: "A17",
    dateApplied: "2026-07-07",
    paymentMethod: "Efectivo",
    amountReceived: 45.17,
    appliedToRent: 45,
    centavosAhorro: 0.17,
    installmentsDeducted: 1,
    installmentsFromDebt: 1,
    installmentsFromAdvance: 0,
    installmentsTotalInPayment: 1,
    balanceBefore: 87,
    balanceAfter: 42,
    savingsBefore: 0,
    savingsAfter: 0.17,
    installmentsPaidAfter: 1,
    installmentsRemainingAfter: 729,
    rentAmount: 29,
    frequency: "daily",
    chargeFirstSunday: false,
    firstSundayChargedAt: undefined,
    createdAt: "2026-07-07T12:00:00.000Z",
    ...overrides
  };
}

(async () => {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  fs.writeFileSync(path.join(TMP_DIR, "package.json"), JSON.stringify({ type: "commonjs" }), "utf8");

  transpileTo(
    path.join(ROOT, "src", "billing.ts"),
    path.join(TMP_DIR, "src", "billing.js")
  );
  transpileTo(
    path.join(ROOT, "src", "format.ts"),
    path.join(TMP_DIR, "src", "format.js")
  );
  transpileTo(
    path.join(ROOT, "src", "components", "paymentReceiptRules.ts"),
    path.join(TMP_DIR, "src", "components", "paymentReceiptRules.js")
  );

  const rules = require(path.join(TMP_DIR, "src", "components", "paymentReceiptRules.js"));

  const earlySundayPayment = makePayment();
  const earlyRows = rules.buildCoveredPaymentRows(earlySundayPayment);
  const earlyBreakdownRows = rules.buildRentPaymentBreakdownRows(earlySundayPayment);
  assert(earlyRows.length === 2, `A17 debe mostrar 2 filas. Recibido: ${JSON.stringify(earlyRows)}`);
  assert(earlyRows[0].dateLabel === "Domingo 05 de julio", `A17 fila 1 debe ser Domingo 05. Recibido: ${JSON.stringify(earlyRows)}`);
  assert(earlyRows[0].status === "complete", `A17 Domingo debe ser completo. Recibido: ${JSON.stringify(earlyRows)}`);
  assert(earlyRows[1].dateLabel === "Lunes 06 de julio", `A17 fila 2 debe ser Lunes 06. Recibido: ${JSON.stringify(earlyRows)}`);
  assert(earlyRows[1].status === "partial", `A17 Lunes debe ser abono parcial. Recibido: ${JSON.stringify(earlyRows)}`);
  assert(earlyRows[1].amount === 16, `A17 Lunes debe ser abono $16. Recibido: ${JSON.stringify(earlyRows)}`);
  assert(
    JSON.stringify(earlyBreakdownRows) === JSON.stringify([
      { label: "Domingo 05 de julio", amount: 29 },
      { label: "Lunes 06 de julio", amount: 16 }
    ]),
    `A17 desglose exacto incorrecto. Recibido: ${JSON.stringify(earlyBreakdownRows)}`
  );

  const advancedPayment = makePayment({
    clientUnit: "T29",
    dateApplied: "2026-07-06",
    amountReceived: 34.29,
    appliedToRent: 34,
    centavosAhorro: 0.29,
    balanceBefore: 86,
    balanceAfter: 52,
    installmentsPaidAfter: 38,
    rentAmount: 33,
    chargeFirstSunday: true
  });
  const advancedRows = rules.buildCoveredPaymentRows(advancedPayment);
  assert(
    !advancedRows.some((row) => row.dateLabel === "Domingo 05 de julio"),
    `T29 avanzado no debe mostrar Domingo 05 de julio. Recibido: ${JSON.stringify(advancedRows)}`
  );

  console.log("OK receipt first-sunday coverage: A17 incluye domingo temprano y T29 lo bloquea avanzado.");
})()
  .catch((error) => {
    console.error("FALLO TEST RECEIPT FIRST SUNDAY:", error && error.message ? error.message : error);
    process.exit(1);
  })
  .finally(() => {
    try {
      if (fs.existsSync(TMP_DIR)) fs.rmSync(TMP_DIR, { recursive: true, force: true });
    } catch {
      // noop
    }
  });
