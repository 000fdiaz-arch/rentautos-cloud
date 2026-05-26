const fs = require("fs");
const path = require("path");
const os = require("os");
const ts = require("typescript");

const ROOT = path.resolve(__dirname, "..");
const TMP_DIR = path.join(os.tmpdir(), `latefees-transpile-${Date.now()}`);
const BUNDLE = path.join(TMP_DIR, "lateFees.js");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function makeDailyClient() {
  return {
    id: "daily-1",
    unitId: "T03",
    name: "DIARIO",
    rentAmount: 35,
    frequency: "daily",
    installmentsAgreed: 100,
    installmentsRemaining: 20,
    installmentsPaid: 80,
    otherCharges: [],
    balance: 17,
    advanceBalance: 0,
    savings: 0,
    createdAt: new Date().toISOString(),
    lastChargeDate: "2026-04-21",
    status: "active"
  };
}

function makeWeeklyClient() {
  return {
    id: "weekly-1",
    unitId: "W11",
    name: "SEMANAL",
    rentAmount: 35,
    frequency: "weekly",
    weeklyChargeDay: "monday",
    installmentsAgreed: 100,
    installmentsRemaining: 20,
    installmentsPaid: 80,
    otherCharges: [],
    balance: 35,
    advanceBalance: 0,
    savings: 0,
    createdAt: new Date().toISOString(),
    lastChargeDate: "2026-04-21",
    status: "active"
  };
}

function makeUnitRenameClientOriginal() {
  return {
    id: "rename-old-d29",
    unitId: "D29",
    name: "CLIENTE ORIGINAL D29",
    rentAmount: 35,
    frequency: "daily",
    installmentsAgreed: 100,
    installmentsRemaining: 25,
    installmentsPaid: 75,
    otherCharges: [],
    balance: 20,
    advanceBalance: 0,
    savings: 0,
    createdAt: new Date().toISOString(),
    lastChargeDate: "2026-04-21",
    status: "active"
  };
}

function makeUnitRenameClientNew() {
  return {
    id: "rename-new-d29",
    unitId: "D29",
    name: "CLIENTE NUEVO D29",
    rentAmount: 35,
    frequency: "daily",
    installmentsAgreed: 100,
    installmentsRemaining: 30,
    installmentsPaid: 70,
    otherCharges: [],
    balance: 35,
    advanceBalance: 0,
    savings: 0,
    createdAt: new Date().toISOString(),
    lastChargeDate: "2026-04-21",
    status: "active"
  };
}

function paymentFor(clientId, unitId, date, appliedToRent) {
  return {
    id: `pay-${clientId}-${date}`,
    receiptNumber: `REC-${date}`,
    clientId,
    clientName: unitId,
    clientUnit: unitId,
    dateApplied: date,
    paymentMethod: "Efectivo",
    amountReceived: appliedToRent,
    appliedToRent,
    centavosAhorro: 0,
    installmentsDeducted: 1,
    balanceBefore: appliedToRent,
    balanceAfter: 0,
    savingsBefore: 0,
    savingsAfter: 0,
    installmentsPaidAfter: 1,
    installmentsRemainingAfter: 0,
    rentAmount: 35,
    frequency: "daily",
    createdAt: new Date().toISOString()
  };
}

(async () => {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  const billingTs = fs.readFileSync(path.join(ROOT, "src", "billing.ts"), "utf8");
  const lateFeesTs = fs.readFileSync(path.join(ROOT, "src", "lateFees.ts"), "utf8");
  const compilerOptions = {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    esModuleInterop: true
  };
  const billingJs = ts.transpileModule(billingTs, { compilerOptions }).outputText;
  const lateFeesJs = ts.transpileModule(lateFeesTs, { compilerOptions }).outputText;
  fs.writeFileSync(path.join(TMP_DIR, "billing.js"), billingJs, "utf8");
  fs.writeFileSync(BUNDLE, lateFeesJs, "utf8");

  const {
    applyLateFeesForClosingDate,
    subtractOtherCharge
  } = require(BUNDLE);

  const settings = {
    active: true,
    dailyAmount: 5,
    chargeLabel: "RECARGO POR TARDANZA DE PAGO",
    selectedUnits: ["T03", "W11"]
  };

  // 1) Diario sin pago: +5
  const dailyRun = applyLateFeesForClosingDate({
    clients: [makeDailyClient()],
    payments: [],
    lateFeeLedger: [],
    lateFeeSettings: settings,
    closingDateKey: "2026-04-22"
  });
  assert(dailyRun.lateFeeTotal === 5, `Diario sin pago: total esperado 5, recibido ${dailyRun.lateFeeTotal}`);
  assert(dailyRun.newEntries.length === 1, "Diario sin pago: debe crear 1 entrada de ledger");
  assert(dailyRun.newEntries[0].reason === "DAILY_MISSED_PROOF", "Diario sin pago: motivo incorrecto");
  assert(dailyRun.clients[0].otherCharges[0].amount === 5, "Diario sin pago: cargo esperado 5");

  // 2) Idempotencia: mismo cliente/fecha/motivo no duplica
  const dailyIdempotent = applyLateFeesForClosingDate({
    clients: dailyRun.clients,
    payments: [],
    lateFeeLedger: dailyRun.newEntries,
    lateFeeSettings: settings,
    closingDateKey: "2026-04-22"
  });
  assert(dailyIdempotent.newEntries.length === 0, "Idempotencia: no debe crear nuevas entradas");
  assert(dailyIdempotent.lateFeeTotal === 0, "Idempotencia: total debe ser 0");

  // 3) Semanal tardio martes-viernes con pago viernes: 4 dias = 20
  let weeklyClient = makeWeeklyClient();
  let ledger = [];
  const weeklyDates = ["2026-04-22", "2026-04-23", "2026-04-24", "2026-04-25"];
  let totalWeekly = 0;
  for (const date of weeklyDates) {
    const payments = date === "2026-04-25"
      ? [paymentFor("weekly-1", "W11", date, 35)]
      : [];
    if (date === "2026-04-25") {
      weeklyClient = { ...weeklyClient, balance: 0 };
    }
    const run = applyLateFeesForClosingDate({
      clients: [weeklyClient],
      payments,
      lateFeeLedger: ledger,
      lateFeeSettings: settings,
      closingDateKey: date
    });
    weeklyClient = run.clients[0];
    ledger = [...run.newEntries, ...ledger];
    totalWeekly += run.lateFeeTotal;
  }
  const weeklyCharge = (weeklyClient.otherCharges || []).find((c) => c.label === settings.chargeLabel);
  assert(totalWeekly === 20, `Semanal: total esperado 20, recibido ${totalWeekly}`);
  assert(weeklyCharge && weeklyCharge.amount === 20, `Semanal: cargo esperado 20, recibido ${JSON.stringify(weeklyClient.otherCharges)}`);
  assert(ledger.length === 4, `Semanal: ledger esperado 4 entradas, recibido ${ledger.length}`);

  // 4) Largo plazo: 30 dias diarios sin pago = 150
  let longClient = makeDailyClient();
  let longLedger = [];
  let totalLong = 0;
  for (let day = 1; day <= 30; day += 1) {
    const date = `2026-05-${String(day).padStart(2, "0")}`;
    const run = applyLateFeesForClosingDate({
      clients: [longClient],
      payments: [],
      lateFeeLedger: longLedger,
      lateFeeSettings: settings,
      closingDateKey: date
    });
    longClient = run.clients[0];
    longLedger = [...run.newEntries, ...longLedger];
    totalLong += run.lateFeeTotal;
  }
  const longCharge = (longClient.otherCharges || []).find((c) => c.label === settings.chargeLabel);
  assert(totalLong === 150, `Largo plazo: total esperado 150, recibido ${totalLong}`);
  assert(longCharge && longCharge.amount === 150, `Largo plazo: cargo esperado 150, recibido ${JSON.stringify(longClient.otherCharges)}`);
  assert(longLedger.length === 30, `Largo plazo: ledger esperado 30 entradas, recibido ${longLedger.length}`);

  // 5) Reversion de cargos por reapertura
  const reversed = subtractOtherCharge(longClient.otherCharges, settings.chargeLabel, 25);
  const reversedCharge = reversed.find((c) => c.label === settings.chargeLabel);
  assert(reversedCharge && reversedCharge.amount === 125, "Reversion: monto esperado 125");

  // 6) Cambio de unidad: D29 -> EXD29 y nuevo D29
  // Debe cobrar solo al nuevo D29 (la lista sigue con D29).
  const renamedOriginal = { ...makeUnitRenameClientOriginal(), unitId: "EXD29" };
  const newD29 = makeUnitRenameClientNew();
  const renameScenario = applyLateFeesForClosingDate({
    clients: [renamedOriginal, newD29],
    payments: [],
    lateFeeLedger: [],
    lateFeeSettings: {
      ...settings,
      selectedUnits: ["D29"]
    },
    closingDateKey: "2026-04-22"
  });
  const oldClientAfter = renameScenario.clients.find((c) => c.id === "rename-old-d29");
  const newClientAfter = renameScenario.clients.find((c) => c.id === "rename-new-d29");
  assert(oldClientAfter, "Cambio de unidad: cliente original no encontrado");
  assert(newClientAfter, "Cambio de unidad: cliente nuevo no encontrado");
  const oldCharge = (oldClientAfter.otherCharges || []).find((c) => c.label === settings.chargeLabel);
  const newCharge = (newClientAfter.otherCharges || []).find((c) => c.label === settings.chargeLabel);
  assert(!oldCharge, "Cambio de unidad: cliente renombrado a EXD29 no debe recibir recargo por lista D29");
  assert(newCharge && newCharge.amount === 5, "Cambio de unidad: nuevo D29 debe recibir recargo de 5");
  assert(renameScenario.newEntries.length === 1, `Cambio de unidad: se esperaba 1 entrada de ledger, recibido ${renameScenario.newEntries.length}`);
  assert(renameScenario.newEntries[0].clientId === "rename-new-d29", "Cambio de unidad: ledger debe apuntar al nuevo cliente D29");

  console.log("OK late fee logic: diario, semanal, idempotencia, largo plazo, reapertura y cambio de unidad.");
})()
  .catch((error) => {
    console.error("FALLO TEST LATE FEE LOGIC:", error && error.message ? error.message : error);
    process.exit(1);
  })
  .finally(() => {
    try {
      if (fs.existsSync(TMP_DIR)) fs.rmSync(TMP_DIR, { recursive: true, force: true });
    } catch {
      // noop
    }
  });
