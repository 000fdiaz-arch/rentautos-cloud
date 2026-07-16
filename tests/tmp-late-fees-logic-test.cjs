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
    status: "activo"
  };
}

function makeDailyFirstSundayClient() {
  return {
    ...makeDailyClient(),
    id: "daily-first-sunday-1",
    unitId: "T03",
    chargeFirstSunday: true,
    installmentsPaid: 7,
    firstSundayChargedAt: undefined
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
    status: "activo"
  };
}

function makeBiweeklyClient() {
  return {
    id: "biweekly-1",
    unitId: "B15",
    name: "QUINCENAL",
    rentAmount: 70,
    frequency: "biweekly",
    installmentsAgreed: 100,
    installmentsRemaining: 20,
    installmentsPaid: 80,
    otherCharges: [],
    balance: 70,
    advanceBalance: 0,
    savings: 0,
    createdAt: new Date().toISOString(),
    lastChargeDate: "2026-05-15",
    status: "activo"
  };
}

function makeMonthlyClient() {
  return {
    id: "monthly-1",
    unitId: "M10",
    name: "MENSUAL",
    rentAmount: 100,
    frequency: "monthly",
    monthlyChargeDay: 10,
    installmentsAgreed: 100,
    installmentsRemaining: 20,
    installmentsPaid: 80,
    otherCharges: [],
    balance: 100,
    advanceBalance: 0,
    savings: 0,
    createdAt: new Date().toISOString(),
    lastChargeDate: "2026-05-10",
    status: "activo"
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
    status: "activo"
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
    status: "activo"
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

  // 4) Semanal A80: martes-domingo + lunes de nuevo ciclo si arrastra mora anterior = 35
  let a80Client = {
    ...makeWeeklyClient(),
    id: "weekly-a80",
    unitId: "A80",
    name: "A80",
    lastChargeDate: "2026-08-03",
    balance: 35
  };
  let a80Ledger = [];
  let totalA80 = 0;
  for (const date of ["2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07", "2026-08-08", "2026-08-09"]) {
    const run = applyLateFeesForClosingDate({
      clients: [a80Client],
      payments: [],
      lateFeeLedger: a80Ledger,
      lateFeeSettings: { ...settings, selectedUnits: ["A80"] },
      closingDateKey: date
    });
    a80Client = run.clients[0];
    a80Ledger = [...run.newEntries, ...a80Ledger];
    totalA80 += run.lateFeeTotal;
  }
  assert(totalA80 === 30, `A80 martes-domingo: total esperado 30, recibido ${totalA80}`);

  a80Client = { ...a80Client, balance: 70 };
  const a80NewCycleRun = applyLateFeesForClosingDate({
    clients: [a80Client],
    payments: [],
    lateFeeLedger: a80Ledger,
    lateFeeSettings: { ...settings, selectedUnits: ["A80"] },
    closingDateKey: "2026-08-10"
  });
  assert(a80NewCycleRun.lateFeeTotal === 5, `A80 lunes nuevo ciclo con mora anterior: esperado 5, recibido ${a80NewCycleRun.lateFeeTotal}`);

  const a80OnlyNewCycleRun = applyLateFeesForClosingDate({
    clients: [{ ...a80Client, id: "weekly-a80-clean", otherCharges: [], balance: 35 }],
    payments: [],
    lateFeeLedger: [],
    lateFeeSettings: { ...settings, selectedUnits: ["A80"] },
    closingDateKey: "2026-08-10"
  });
  assert(a80OnlyNewCycleRun.lateFeeTotal === 0, `A80 lunes solo ciclo nuevo: esperado 0, recibido ${a80OnlyNewCycleRun.lateFeeTotal}`);

  // 5) Diario lunes-miercoles sin pago y jueves con pago = 15
  let dailyMissedClient = makeDailyClient();
  let dailyMissedLedger = [];
  let totalDailyMissed = 0;
  for (const date of ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06"]) {
    const payments = date === "2026-08-06" ? [paymentFor("daily-1", "T03", date, 35)] : [];
    const run = applyLateFeesForClosingDate({
      clients: [dailyMissedClient],
      payments,
      lateFeeLedger: dailyMissedLedger,
      lateFeeSettings: settings,
      closingDateKey: date
    });
    dailyMissedClient = run.clients[0];
    dailyMissedLedger = [...run.newEntries, ...dailyMissedLedger];
    totalDailyMissed += run.lateFeeTotal;
  }
  assert(totalDailyMissed === 15, `Diario lun-mie sin pago y jueves paga: esperado 15, recibido ${totalDailyMissed}`);

  // 6) Diario lunes-sabado sin pago y domingo paga = 30; domingo normal no genera mora
  let dailySundayClient = makeDailyClient();
  let dailySundayLedger = [];
  let totalDailySunday = 0;
  for (const date of ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07", "2026-08-08", "2026-08-09"]) {
    const payments = date === "2026-08-09" ? [paymentFor("daily-1", "T03", date, 35)] : [];
    const run = applyLateFeesForClosingDate({
      clients: [dailySundayClient],
      payments,
      lateFeeLedger: dailySundayLedger,
      lateFeeSettings: settings,
      closingDateKey: date
    });
    dailySundayClient = run.clients[0];
    dailySundayLedger = [...run.newEntries, ...dailySundayLedger];
    totalDailySunday += run.lateFeeTotal;
  }
  assert(totalDailySunday === 30, `Diario lun-sab sin pago y domingo paga: esperado 30, recibido ${totalDailySunday}`);

  const dailyNoSundayChargeRun = applyLateFeesForClosingDate({
    clients: [makeDailyClient()],
    payments: [],
    lateFeeLedger: [],
    lateFeeSettings: settings,
    closingDateKey: "2026-08-09"
  });
  assert(dailyNoSundayChargeRun.lateFeeTotal === 0, `Diario domingo sin cobro normal: esperado 0, recibido ${dailyNoSundayChargeRun.lateFeeTotal}`);

  const dailyFirstSundayRun = applyLateFeesForClosingDate({
    clients: [makeDailyFirstSundayClient()],
    payments: [],
    lateFeeLedger: [],
    lateFeeSettings: settings,
    closingDateKey: "2026-08-09"
  });
  assert(dailyFirstSundayRun.lateFeeTotal === 5, `Diario primer domingo cobrable sin pago: esperado 5, recibido ${dailyFirstSundayRun.lateFeeTotal}`);

  // 7) Largo plazo diario: 30 dias sin pago, solo dias cobrables = 130
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
  assert(totalLong === 130, `Largo plazo: total esperado 130, recibido ${totalLong}`);
  assert(longCharge && longCharge.amount === 130, `Largo plazo: cargo esperado 130, recibido ${JSON.stringify(longClient.otherCharges)}`);
  assert(longLedger.length === 26, `Largo plazo: ledger esperado 26 entradas, recibido ${longLedger.length}`);

  // 8) Reversion de cargos por reapertura
  const reversed = subtractOtherCharge(longClient.otherCharges, settings.chargeLabel, 25);
  const reversedCharge = reversed.find((c) => c.label === settings.chargeLabel);
  assert(reversedCharge && reversedCharge.amount === 105, "Reversion: monto esperado 105");

  // 9) Cambio de unidad: D29 -> EXD29 y nuevo D29
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

  // 10) Quincenal y mensual: tambien generan recargo diario despues de su vencimiento.
  const scheduledSettings = { ...settings, selectedUnits: ["B15", "M10"] };
  const scheduledRun = applyLateFeesForClosingDate({
    clients: [makeBiweeklyClient(), makeMonthlyClient()],
    payments: [],
    lateFeeLedger: [],
    lateFeeSettings: scheduledSettings,
    closingDateKey: "2026-05-16"
  });
  assert(scheduledRun.lateFeeTotal === 10, `Quincenal/mensual: total esperado 10, recibido ${scheduledRun.lateFeeTotal}`);
  assert(scheduledRun.newEntries.length === 2, `Quincenal/mensual: ledger esperado 2 entradas, recibido ${scheduledRun.newEntries.length}`);
  assert(scheduledRun.newEntries.every((entry) => entry.reason === "SCHEDULED_LATE_DAY"), "Quincenal/mensual: motivo esperado SCHEDULED_LATE_DAY");

  console.log("OK late fee logic: diario, semanal, quincenal, mensual, idempotencia, largo plazo, reapertura y cambio de unidad.");
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
