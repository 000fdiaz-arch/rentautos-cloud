const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const ROOT = path.resolve(__dirname, "..");
const TMP = path.join(ROOT, ".tmp", `manual-payment-workflow-${Date.now()}`);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function transpile(relativePath) {
  const sourcePath = path.join(ROOT, "src", relativePath);
  const outputPath = path.join(TMP, "src", relativePath.replace(/\.ts$/, ".js"));
  const output = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: sourcePath
  }).outputText;
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, output, "utf8");
}

function makeClient() {
  return {
    id: "client-1",
    unitId: "T26",
    name: "CLIENTE PRUEBA",
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
    createdAt: "2026-07-01T00:00:00.000Z",
    lastChargeDate: "2026-07-08",
    status: "activo"
  };
}

(async () => {
  fs.mkdirSync(TMP, { recursive: true });
  fs.writeFileSync(path.join(TMP, "package.json"), JSON.stringify({ type: "commonjs" }));
  [
    "billing.ts",
    "pages/payments/paymentConstants.ts",
    "pages/payments/paymentRules.ts",
    "pages/payments/bankPaymentRules.ts",
    "pages/payments/manualPaymentWorkflow.ts"
  ].forEach(transpile);

  const { buildManualPaymentTransaction } = require(path.join(TMP, "src", "pages", "payments", "manualPaymentWorkflow.js"));
  const base = {
    clients: [makeClient()],
    payments: [],
    selectedClient: makeClient(),
    manualOtherChargesInput: {},
    retentionByClient: {},
    operationalDateKey: "2026-07-09",
    overrideForcedOtherCharges: false,
    receiptNumber: "REC-1001",
    currentActor: "operador@rentautos.app"
  };

  const cash = buildManualPaymentTransaction({
    ...base,
    form: { clientId: "client-1", dateApplied: "2026-07-09", paymentMethod: "Efectivo", cashDeliveryStatus: "pending", reference: "", amountReceived: "30" }
  });
  assert(cash.payment.amountReceived === 30, "El pago efectivo debe conservar el monto recibido.");
  assert(cash.updatedClients[0].balance === 70, `El saldo efectivo debe quedar en 70, recibido ${cash.updatedClients[0].balance}.`);
  assert(!cash.pendingCard, "El efectivo no debe crear pendiente de tarjeta.");
  assert(cash.payment.moneyDelivered === false, "El efectivo pendiente debe conservarse como no entregado.");
  assert(!cash.payment.moneyDeliveryDate, "El efectivo pendiente no debe tener fecha de entrega.");

  const deliveredCash = buildManualPaymentTransaction({
    ...base,
    receiptNumber: "REC-1003",
    form: { clientId: "client-1", dateApplied: "2026-07-09", paymentMethod: "Efectivo", cashDeliveryStatus: "delivered", reference: "", amountReceived: "30" }
  });
  assert(deliveredCash.payment.moneyDelivered === true, "El efectivo entregado debe quedar marcado como entregado.");
  assert(deliveredCash.payment.moneyDeliveryDate === "2026-07-09", "El efectivo entregado debe sumar en su fecha de entrega.");

  const card = buildManualPaymentTransaction({
    ...base,
    receiptNumber: "REC-1002",
    form: { clientId: "client-1", dateApplied: "2026-07-09", paymentMethod: "Tarjeta", cashDeliveryStatus: "", reference: "FOLIO:ABC-123", amountReceived: "30" }
  });
  assert(card.payment.paymentMethod === "Tarjeta", "La transaccion debe conservar el metodo Tarjeta.");
  assert(card.pendingCard?.folio === "ABC-123", `El folio esperado es ABC-123, recibido ${card.pendingCard?.folio}.`);
  assert(card.pendingCard?.appliedPaymentId === card.payment.id, "El pendiente debe enlazar el pago creado.");
  assert(card.updatedClients[0].balance === 70, "La tarjeta debe aplicar el saldo inmediatamente.");

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log("OK flujo manual: efectivo y tarjeta construyen transacciones coherentes.");
})().catch((error) => {
  console.error("FALLO FLUJO MANUAL:", error?.message ?? error);
  process.exit(1);
});
