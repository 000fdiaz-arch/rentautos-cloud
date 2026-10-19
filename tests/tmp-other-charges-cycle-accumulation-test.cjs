const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const ROOT = path.resolve(__dirname, "..");
const TMP = path.join(ROOT, ".tmp", `other-charges-cycle-${Date.now()}`);
const transpiled = new Set();

function transpile(relativePath) {
  if (transpiled.has(relativePath)) return;
  transpiled.add(relativePath);
  const sourcePath = path.join(ROOT, "src", relativePath);
  const outputPath = path.join(TMP, "src", relativePath.replace(/\.ts$/, ".js"));
  const output = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: sourcePath
  }).outputText;
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, output, "utf8");
  for (const match of output.matchAll(/require\("(\.[^"]+)"\)/g)) {
    const dependency = path.resolve(path.dirname(sourcePath), match[1] + ".ts");
    if (fs.existsSync(dependency)) transpile(path.relative(path.join(ROOT, "src"), dependency));
  }
}

function checkpoint(dateApplied, mode = "manual", appliedAmount = 0) {
  return {
    id: `payment-${dateApplied}-${mode}`,
    clientId: "client-1",
    dateApplied,
    createdAt: `${dateApplied}T12:00:00.000Z`,
    otherChargesRetentionEvent: {
      mode,
      cycle: "weekly",
      baseAmount: 5,
      cyclesElapsed: mode === "automatic" ? 1 : 0,
      calculatedAmount: appliedAmount,
      appliedAmount
    }
  };
}

try {
  fs.mkdirSync(TMP, { recursive: true });
  fs.writeFileSync(path.join(TMP, "package.json"), JSON.stringify({ type: "commonjs" }));
  transpile("pages/payments/paymentRules.ts");
  const rules = require(path.join(TMP, "src", "pages", "payments", "paymentRules.js"));

  const client = {
    id: "client-1",
    unitId: "A01",
    name: "Cliente",
    rentAmount: 25,
    frequency: "weekly",
    weeklyChargeDay: "monday",
    balance: 100,
    advanceBalance: 0,
    savings: 0,
    installmentsPaid: 0,
    installmentsRemaining: 100,
    otherCharges: [{ id: "charge-1", label: "REPARACION", amount: 100, createdAt: "2026-09-07" }]
  };
  const weekly = { "client-1": { amount: 5, cycle: "weekly" } };

  assert.equal(
    rules.computeConfiguredRetentionForPayment(client, weekly, [], "2026-10-05"),
    20,
    "Cuatro semanas pendientes deben acumular $20."
  );

  const ordinaryPayment = { id: "ordinary", clientId: "client-1", dateApplied: "2026-09-21", createdAt: "2026-09-21T12:00:00.000Z" };
  assert.equal(
    rules.computeConfiguredRetentionForPayment(client, weekly, [ordinaryPayment], "2026-10-05"),
    20,
    "Un pago normal no debe reiniciar el ciclo de Otros cargos."
  );

  const manualReset = checkpoint("2026-09-21", "manual", 8);
  assert.equal(
    rules.computeConfiguredRetentionForPayment(client, weekly, [ordinaryPayment, manualReset], "2026-10-05"),
    10,
    "Un ajuste manual debe reiniciar el ciclo desde su fecha."
  );
  assert.equal(
    rules.computeConfiguredRetentionForPayment(client, weekly, [manualReset], "2026-09-21"),
    0,
    "No debe volver a cobrar en la misma fecha del reinicio manual."
  );

  const automatic = rules.computeManualPaymentAllocation(client, 50, {}, weekly, [], "2026-10-05");
  assert.equal(automatic.totalOtherCharges, 20);
  assert.deepEqual(automatic.otherChargesRetentionEvent, {
    mode: "automatic",
    cycle: "weekly",
    baseAmount: 5,
    cyclesElapsed: 4,
    calculatedAmount: 20,
    appliedAmount: 20
  });

  const partialAutomatic = rules.computeManualPaymentAllocation(client, 10, {}, weekly, [], "2026-10-05");
  assert.equal(partialAutomatic.totalOtherCharges, 10);
  assert.equal(partialAutomatic.otherChargesRetentionEvent.calculatedAmount, 20);
  assert.equal(
    rules.computeConfiguredRetentionForPayment(client, weekly, [{
      ...checkpoint("2026-10-05", "automatic", 10),
      otherChargesRetentionEvent: partialAutomatic.otherChargesRetentionEvent
    }], "2026-10-05"),
    10,
    "La parte automática que no alcanzó a cobrarse debe seguir pendiente."
  );

  const manual = rules.computeManualPaymentAllocation(client, 50, { "id:charge-1": "8" }, weekly, [], "2026-10-05", true);
  assert.equal(manual.totalOtherCharges, 8);
  assert.equal(manual.otherChargesRetentionEvent.mode, "manual");
  assert.equal(manual.otherChargesRetentionEvent.appliedAmount, 8);

  const manualZero = rules.computeManualPaymentAllocation(client, 50, { "id:charge-1": "0" }, weekly, [], "2026-10-05", true);
  assert.equal(manualZero.totalOtherCharges, 0);
  assert.equal(manualZero.otherChargesRetentionEvent.mode, "manual");
  assert.equal(manualZero.otherChargesRetentionEvent.appliedAmount, 0);

  assert.equal(
    rules.computeConfiguredRetentionForPayment(client, { "client-1": { amount: 5, cycle: "biweekly" } }, [checkpoint("2026-09-15")], "2026-10-15"),
    10,
    "Dos quincenas deben acumular $10."
  );
  assert.equal(
    rules.computeConfiguredRetentionForPayment({
      ...client,
      monthlyChargeDay: 1,
      otherCharges: [{ ...client.otherCharges[0], createdAt: "2026-07-01" }]
    }, { "client-1": { amount: 5, cycle: "monthly" } }, [checkpoint("2026-07-01")], "2026-10-01"),
    15,
    "Tres mensualidades deben acumular $15."
  );
  assert.equal(
    rules.computeConfiguredRetentionForPayment(client, { "client-1": { amount: 5, cycle: "when_payment" } }, [manualReset], "2026-09-21"),
    5,
    "Cuando paga debe cobrar en cada pago."
  );

  const legacyRetention = { ...ordinaryPayment, otherChargesApplied: [{ label: "REPARACION", amount: 5 }] };
  assert.equal(rules.computeConfiguredRetentionForPayment(client, weekly, [legacyRetention], "2026-10-05"), 10);
  const legacyLateFee = { ...ordinaryPayment, otherChargesApplied: [{ label: "RECARGO POR MORA", amount: 5 }] };
  assert.equal(rules.computeConfiguredRetentionForPayment(client, weekly, [legacyLateFee], "2026-10-05"), 20);

  const oldCheckpointBeforeNewCharge = checkpoint("2026-08-03", "automatic", 5);
  const clientWithNewCharge = { ...client, otherCharges: [{ ...client.otherCharges[0], createdAt: "2026-09-21" }] };
  assert.equal(
    rules.computeConfiguredRetentionForPayment(clientWithNewCharge, weekly, [oldCheckpointBeforeNewCharge], "2026-10-05"),
    10,
    "Un cargo nuevo no debe acumular semanas anteriores a su creación."
  );

  const dailyClient = {
    ...client,
    id: "client-a99",
    unitId: "A99",
    frequency: "daily",
    otherCharges: [{ id: "charge-a99", label: "DEUDA ANTERIOR", amount: 21, createdAt: "2026-09-09" }]
  };
  const persistedCheckpoint = {
    clientId: "client-a99",
    paymentId: "payment-a99-2026-10-17",
    dateApplied: "2026-10-17",
    createdAt: "2026-10-17T13:45:20.025Z",
    retentionEvent: {
      mode: "automatic",
      cycle: "daily",
      baseAmount: 2,
      cyclesElapsed: 1,
      calculatedAmount: 2,
      appliedAmount: 2
    }
  };
  const truncatedHistory = [{
    id: "ordinary-a99-2026-10-18",
    clientId: "client-a99",
    dateApplied: "2026-10-18",
    createdAt: "2026-10-18T17:35:34.526Z"
  }];
  assert.equal(
    rules.computeConfiguredRetentionForPayment(
      dailyClient,
      { "client-a99": { amount: 2, cycle: "daily" } },
      truncatedHistory,
      "2026-10-19",
      persistedCheckpoint
    ),
    2,
    "El punto de control persistido debe evitar cobrar todo cuando el historial local está truncado."
  );
  assert.equal(
    rules.computeManualPaymentAllocation(
      dailyClient,
      9,
      {},
      { "client-a99": { amount: 2, cycle: "daily" } },
      truncatedHistory,
      "2026-10-19",
      false,
      undefined,
      persistedCheckpoint
    ).totalOtherCharges,
    2,
    "A99 debe aplicar solo $2 de un pago de $9 aun sin cargar el historial completo."
  );

  const manualSource = fs.readFileSync(path.join(ROOT, "src", "pages", "payments", "manualPaymentWorkflow.ts"), "utf8");
  const bankSource = fs.readFileSync(path.join(ROOT, "src", "pages", "payments", "pendingBankRules.ts"), "utf8");
  assert.match(manualSource, /otherChargesRetentionEvent: allocation\.otherChargesRetentionEvent/);
  assert.match(bankSource, /otherChargesRetentionEvent: remainingOtherChargesAllocation\.retentionEvent/);

  console.log("OK Otros cargos: ciclos acumulados, reinicio manual y persistencia del punto de control.");
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}
