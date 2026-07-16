const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const ROOT = path.resolve(__dirname, "..");
const TMP = path.join(ROOT, ".tmp", `late-fee-payment-priority-${Date.now()}`);

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

function makeClient(unitId = "T03") {
  return {
    id: "client-late-fee",
    unitId,
    name: "CLIENTE RECARGO",
    rentAmount: 25,
    frequency: "daily",
    chargeFirstSunday: false,
    balance: 100,
    advanceBalance: 0,
    savings: 10,
    installmentsAgreed: 100,
    installmentsRemaining: 10,
    installmentsPaid: 90,
    otherCharges: [
      { id: "late-1", label: "RECARGO POR TARDANZA DE PAGO", amount: 12 }
    ],
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
    "pages/payments/paymentRules.ts"
  ].forEach(transpile);

  const { computeManualPaymentAllocation } = require(path.join(TMP, "src", "pages", "payments", "paymentRules.js"));
  const lateFeeSettings = {
    active: true,
    dailyAmount: 5,
    chargeLabel: "RECARGO POR TARDANZA DE PAGO",
    selectedUnits: ["T03"]
  };

  const prioritized = computeManualPaymentAllocation(
    makeClient(),
    50.75,
    {},
    {},
    [],
    "2026-07-09",
    false,
    lateFeeSettings
  );

  assert(prioritized.centavosAhorro === 0.75, `Centavos a ahorro esperado 0.75, recibido ${prioritized.centavosAhorro}`);
  assert(prioritized.totalLateFees === 12, `Recargos separados esperados 12, recibido ${prioritized.totalLateFees}`);
  assert(prioritized.totalOtherCharges === 12, `Recargo aplicado esperado 12, recibido ${prioritized.totalOtherCharges}`);
  assert(prioritized.otherChargesApplied?.[0]?.id === "late-1", "Debe aplicar primero el recargo de mora");
  assert(prioritized.appliedToRent === 38, `Renta esperada 38, recibido ${prioritized.appliedToRent}`);
  assert(prioritized.balanceAfter === 62, `Saldo renta esperado 62, recibido ${prioritized.balanceAfter}`);
  assert(prioritized.advanceApplied === 0, `Adelanto esperado 0, recibido ${prioritized.advanceApplied}`);

  const notListed = computeManualPaymentAllocation(
    makeClient("X99"),
    50.75,
    {},
    { "client-late-fee": { amount: 0, cycle: "when_payment" } },
    [],
    "2026-07-09",
    false,
    lateFeeSettings
  );
  assert(notListed.totalOtherCharges === 0, `Unidad fuera de lista no debe forzar recargo, recibido ${notListed.totalOtherCharges}`);
  assert(notListed.totalLateFees === 0, `Unidad fuera de lista no debe separar recargos, recibido ${notListed.totalLateFees}`);
  assert(notListed.appliedToRent === 50, `Unidad fuera de lista debe aplicar entero a renta, recibido ${notListed.appliedToRent}`);
  assert(notListed.centavosAhorro === 0.75, "La regla de centavos a ahorro aplica siempre");

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log("OK recargos: pago prioriza mora para unidades configuradas y siempre envia centavos a ahorro.");
})().catch((error) => {
  console.error("FALLO RECARGOS PRIORIDAD:", error?.message ?? error);
  process.exit(1);
});
