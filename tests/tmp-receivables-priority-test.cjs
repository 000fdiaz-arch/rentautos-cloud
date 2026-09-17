const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "receivables-priority-"));

function bundle(source, output) {
  const windows = process.platform === "win32";
  const args = ["esbuild", source, "--bundle", "--platform=node", "--format=cjs", `--outfile=${output}`];
  const result = spawnSync(windows ? "cmd.exe" : "npx", windows ? ["/c", "npx", ...args] : args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true
  });
  if (result.status !== 0) throw new Error(result.error?.message || result.stderr || result.stdout || `No se pudo compilar ${source}`);
}

function client(overrides = {}) {
  return {
    id: "weekly",
    unitId: "W01",
    name: "Cliente semanal",
    cedula: "8-1-1",
    rentAmount: 100,
    frequency: "weekly",
    weeklyChargeDay: "monday",
    installmentsAgreed: 20,
    installmentsIssued: 1,
    installmentsRemaining: 20,
    installmentsPaid: 0,
    otherCharges: [],
    balance: 100,
    advanceBalance: 0,
    savings: 0,
    createdAt: "2026-08-01T12:00:00",
    firstChargeDate: "2026-09-14",
    lastChargeDate: "2026-09-14",
    status: "activo",
    ...overrides
  };
}

try {
  const receivablesOutput = path.join(temp, "receivables.cjs");
  const priorityOutput = path.join(temp, "priority.cjs");
  bundle("src/receivables.ts", receivablesOutput);
  bundle("src/pages/receivables/receivablesPriority.ts", priorityOutput);
  const { buildReceivableRows } = require(receivablesOutput);
  const { buildPriorityReceivables, formatInstallmentDebt, formatPriorityPayment, priorityGeneratedInstallments, priorityOverdueInstallmentCount, priorityPaymentDaysAgo, priorityTenureBucket } = require(priorityOutput);

  const monday = buildReceivableRows([client()], [], new Date("2026-09-14T12:00:00"))[0];
  const tuesday = buildReceivableRows([client()], [], new Date("2026-09-15T12:00:00"))[0];
  const partialPriorDebt = buildReceivableRows([
    client({ firstChargeDate: "2026-09-07", installmentsIssued: 2, balance: 150 })
  ], [], new Date("2026-09-14T12:00:00"))[0];

  assert.equal(monday.overdueBalance, 0, "La cuota semanal del lunes no debe estar vencida el mismo lunes.");
  assert.equal(tuesday.overdueBalance, 100, "La cuota semanal impaga debe aparecer vencida desde el martes.");
  assert.equal(partialPriorDebt.overdueBalance, 50, "El lunes solo debe mostrarse el saldo anterior, no la cuota del día.");

  const oldClient = client({
    id: "old",
    unitId: "W02",
    name: "Cliente antiguo",
    createdAt: "2025-01-01T12:00:00",
    firstChargeDate: "2025-01-01",
    balance: 200
  });
  const oldRow = { ...tuesday, id: "old", unitId: "W02", name: "Cliente antiguo", overdueBalance: 200, totalPending: 200, daysLate: 8 };
  const priority = buildPriorityReceivables(
    [oldRow],
    [oldClient],
    [],
    { old: { status: "unassigned", comment: "", updatedAt: "2026-09-16T12:00:00", priorityDebtCap: 150 } },
    new Date("2026-09-16T12:00:00")
  );
  assert.equal(priority.length, 1, "Todo cliente con renta vencida debe entrar a prioridad.");
  assert.equal(priority[0].level, "critical", "Superar el tope manual debe llevar el caso a crítico.");
  assert.equal(formatInstallmentDebt(44, 34), "2 cuotas; con $10 baja una cuota", "C04 debe contar la cuota parcial dentro del total de cuotas adeudadas.");
  assert.equal(priorityOverdueInstallmentCount(44, 34), 2, "El filtro debe contar la cuota parcial de C04 como una cuota vencida completa en la selección.");
  assert.equal(formatInstallmentDebt(1685, 35), "49 cuotas; con $5 baja una cuota");
  assert.equal(priorityOverdueInstallmentCount(1685, 35), 49, "Las opciones dinámicas deben usar el mismo total que se muestra en la tarjeta.");
  assert.equal(formatInstallmentDebt(70, 35), "2 cuotas", "Una deuda exacta no debe inventar una cuota parcial.");
  assert.equal(
    formatPriorityPayment({
      dateApplied: "2026-09-14",
      amountReceived: 33,
      appliedToRent: 33,
      otherCharges: [{ label: "Enganche", amount: 0.004 }]
    }, new Date("2026-09-16T12:00:00")),
    "Pagó hace 2 días $33 a renta",
    "Los cargos que se muestran como $0 no deben aparecer en la explicación del pago."
  );
  assert.equal(
    priorityPaymentDaysAgo({ dateApplied: "2026-09-14", amountReceived: 33, appliedToRent: 33, otherCharges: [] }, new Date("2026-09-16T12:00:00")),
    2,
    "El filtro de último pago debe usar días calendario."
  );
  assert.equal(priorityPaymentDaysAgo(null, new Date("2026-09-16T12:00:00")), null, "Sin pago registrado no debe coincidir con un número de días.");

  const workshopClient = client({
    id: "d81",
    unitId: "D81",
    status: "taller",
    balance: 200,
    firstChargeDate: "2026-09-01"
  });
  const workshopRow = buildReceivableRows(
    [workshopClient],
    [],
    new Date("2026-09-16T12:00:00"),
    [{ unit_id: "D81", operational_status: "activo" }]
  )[0];
  assert.equal(workshopRow.operationalStatus, "taller", "El estado Taller del cliente debe prevalecer aunque la flota local esté desactualizada.");
  assert.equal(
    buildPriorityReceivables([workshopRow], [workshopClient], [], {}, new Date("2026-09-16T12:00:00")).length,
    0,
    "D81 no debe aparecer en prioridad de cobro mientras esté en taller."
  );

  const a80 = client({
    id: "a80",
    unitId: "A80",
    name: "Cliente A80",
    installmentsAgreed: 120,
    installmentsIssued: 109,
    installmentsPaid: 108,
    installmentsRemaining: 11,
    firstChargeDate: "2026-08-01",
    createdAt: "2026-08-01T12:00:00"
  });
  const a80Priority = buildPriorityReceivables(
    [{ ...tuesday, id: "a80", unitId: "A80", name: "Cliente A80" }],
    [a80],
    [],
    {},
    new Date("2026-09-16T12:00:00")
  )[0];
  assert.equal(a80Priority.generatedInstallments, 109, "A80 debe conservar sus 109 cuotas semanales generadas.");
  assert.equal(a80Priority.tenureDays, 763, "109 cuotas semanales deben equivaler a 763 días de antigüedad.");
  assert.equal(a80Priority.isEstablishedClient, true, "109 semanas generadas deben clasificar a A80 como antiguo.");

  const d96 = client({
    id: "d96",
    unitId: "D96",
    name: "Cliente D96",
    frequency: "weekly",
    rentAmount: 204,
    balance: 54,
    installmentsIssued: 8,
    installmentsPaid: 1,
    firstChargeDate: "2026-08-28"
  });
  const d96Priority = buildPriorityReceivables(
    [{ ...tuesday, id: "d96", unitId: "D96", name: "Cliente D96", plan: "weekly", rentAmount: 204, overdueBalance: 54 }],
    [d96],
    [],
    {},
    new Date("2026-09-16T12:00:00")
  )[0];
  assert.equal(priorityGeneratedInstallments(d96), 2, "D96 representa una cuota pagada y una cuota parcial pendiente.");
  assert.equal(d96Priority.generatedInstallments, 2, "El contador histórico incorrecto de 8 no debe inflar a D96.");
  assert.equal(d96Priority.tenureDays, 14, "Dos cuotas semanales deben equivaler a 14 días.");

  const longContractNewClient = client({ installmentsAgreed: 109, installmentsIssued: 1 });
  const longContractPriority = buildPriorityReceivables([tuesday], [longContractNewClient], [], {}, new Date("2026-09-15T12:00:00"))[0];
  assert.equal(longContractPriority.isEstablishedClient, false, "Las cuotas pactadas no deben confundirse con las ya generadas.");

  const biweeklyClient = client({
    id: "biweekly",
    unitId: "Q01",
    frequency: "biweekly",
    installmentsIssued: 12,
    installmentsPaid: 11,
    firstChargeDate: "2026-08-01"
  });
  const biweeklyPriority = buildPriorityReceivables(
    [{ ...tuesday, id: "biweekly", unitId: "Q01", plan: "biweekly" }],
    [biweeklyClient],
    [],
    {},
    new Date("2026-09-16T12:00:00")
  )[0];
  assert.equal(biweeklyPriority.tenureDays, 183, "12 cuotas quincenales deben equivaler aproximadamente a 6 meses.");
  assert.equal(biweeklyPriority.isEstablishedClient, true, "12 quincenas generadas deben clasificar al cliente como antiguo.");

  const monthlyClient = client({
    id: "monthly",
    unitId: "M01",
    frequency: "monthly",
    installmentsIssued: 6,
    installmentsPaid: 5,
    firstChargeDate: "2026-08-01"
  });
  const monthlyPriority = buildPriorityReceivables(
    [{ ...tuesday, id: "monthly", unitId: "M01", plan: "monthly" }],
    [monthlyClient],
    [],
    {},
    new Date("2026-09-16T12:00:00")
  )[0];
  assert.equal(monthlyPriority.tenureDays, 184, "6 cuotas mensuales deben retroceder 6 meses calendario.");
  assert.equal(monthlyPriority.isEstablishedClient, true, "6 mensualidades generadas deben clasificar al cliente como antiguo.");

  const t07 = client({
    id: "t07",
    unitId: "T07",
    frequency: "biweekly",
    rentAmount: 338,
    balance: 762,
    installmentsIssued: 7,
    installmentsPaid: 3,
    firstChargeDate: "2026-06-08"
  });
  const t11 = client({
    id: "t11",
    unitId: "T11",
    frequency: "daily",
    rentAmount: 33,
    balance: 30,
    installmentsIssued: 13,
    firstChargeDate: "2026-09-01"
  });
  const newnessFirst = buildPriorityReceivables(
    [
      { ...tuesday, id: "t07", unitId: "T07", plan: "biweekly", rentAmount: 338, overdueBalance: 762, daysLate: 32 },
      { ...tuesday, id: "t11", unitId: "T11", plan: "daily", rentAmount: 33, overdueBalance: 30, daysLate: 1 }
    ],
    [t07, t11],
    [],
    {},
    new Date("2026-09-16T12:00:00")
  );
  assert.equal(newnessFirst[0].row.unitId, "T11", "El cliente de hasta 30 días debe preceder al de 3 a 6 meses.");
  assert.equal(priorityTenureBucket(newnessFirst[0].tenureDays), "up_to_30", "T11 debe caer en el filtro de hasta 30 días.");
  assert.equal(priorityTenureBucket(newnessFirst[1].tenureDays), "three_to_six", "T07 debe caer en el filtro de 3 a 6 meses.");
  assert.equal(priorityTenureBucket(500), "one_to_two_years", "La antigüedad general debe distinguir clientes de 1 a 2 años.");
  assert.equal(priorityTenureBucket(800), "two_years_plus", "La antigüedad general debe agrupar clientes de 2 años o más.");

  console.log("OK prioridad de cobranza: vencimiento estricto, antigüedad por cuotas, saldo parcial y tope validados.");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
