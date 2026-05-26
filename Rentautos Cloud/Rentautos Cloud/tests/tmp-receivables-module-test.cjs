const fs = require("fs");
const path = require("path");
const os = require("os");
const ts = require("typescript");

const ROOT = path.resolve(__dirname, "..");
const TMP_DIR = path.join(os.tmpdir(), `receivables-transpile-${Date.now()}`);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function transpileFile(srcPath, outPath) {
  const tsSource = fs.readFileSync(srcPath, "utf8");
  const output = ts.transpileModule(tsSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true
    }
  }).outputText;
  fs.writeFileSync(outPath, output, "utf8");
}

(function run() {
  fs.mkdirSync(TMP_DIR, { recursive: true });

  transpileFile(path.join(ROOT, "src", "billing.ts"), path.join(TMP_DIR, "billing.js"));
  transpileFile(path.join(ROOT, "src", "receivables.ts"), path.join(TMP_DIR, "receivables.js"));

  const {
    buildReceivableRows,
    computeReceivableState,
    filterReceivableRows,
    sortReceivableRows,
    computeReceivableSummary,
    createMockReceivableRows,
    DEFAULT_RECEIVABLE_FILTERS
  } = require(path.join(TMP_DIR, "receivables.js"));

  const now = new Date("2026-04-24T12:00:00");

  assert(computeReceivableState(0, 0, 2) === "alDia", "Estado al dia incorrecto");
  assert(computeReceivableState(120, 20, null) === "critico", "Estado moroso critico incorrecto");
  assert(computeReceivableState(120, 5, null) === "vencido", "Estado vencido incorrecto");
  assert(computeReceivableState(120, 0, -2) === "venceHoy", "Estado vence hoy incorrecto");
  assert(computeReceivableState(120, -1, 2) === "proximo", "Estado proximo a vencer incorrecto");

  const mocks = createMockReceivableRows(now);
  assert(mocks.length >= 10, `Se esperaban al menos 10 mocks, recibido ${mocks.length}`);

  const quotaPercentRows = buildReceivableRows(
    [
      {
        id: "q-1",
        unitId: "A-900",
        name: "Cliente Cuotas",
        rentAmount: 100,
        frequency: "monthly",
        monthlyChargeDay: 1,
        installmentsAgreed: 100,
        installmentsRemaining: 65,
        installmentsPaid: 35,
        otherCharges: [],
        balance: 6500,
        advanceBalance: 0,
        savings: 0,
        createdAt: now.toISOString(),
        lastChargeDate: "2026-04-01",
        status: "active"
      }
    ],
    [],
    now
  );
  assert(quotaPercentRows[0].percentPaid === 35, `El % pagado por cuotas debe ser 35, recibido ${quotaPercentRows[0].percentPaid}`);
  assert(quotaPercentRows[0].installmentsRemaining === 65, `Cuotas pendientes esperadas 65, recibido ${quotaPercentRows[0].installmentsRemaining}`);

  const onlyGroupD = filterReceivableRows(mocks, {
    ...DEFAULT_RECEIVABLE_FILTERS,
    group: "D"
  });
  assert(onlyGroupD.length > 0, "Filtro por grupo D sin resultados");
  assert(onlyGroupD.every((row) => row.group === "D"), "Filtro por grupo D devolvio grupos incorrectos");

  const onlyCritical = filterReceivableRows(mocks, {
    ...DEFAULT_RECEIVABLE_FILTERS,
    state: ["critico"]
  });
  assert(onlyCritical.length > 0, "Filtro critico sin resultados");
  assert(onlyCritical.every((row) => row.state === "critico"), "Filtro critico devolvio estados incorrectos");

  const dateRange = filterReceivableRows(mocks, {
    ...DEFAULT_RECEIVABLE_FILTERS,
    dateFrom: "2026-04-20",
    dateTo: "2026-04-30"
  });
  assert(dateRange.length > 0, "Filtro por rango de fechas no devolvio filas");
  assert(
    dateRange.every((row) => row.nextDueDate && row.nextDueDate >= "2026-04-20" && row.nextDueDate <= "2026-04-30"),
    "Filtro por rango de fechas devolvio fechas fuera de rango"
  );

  const sortedByLateDesc = sortReceivableRows(mocks, "daysLate", "desc");
  assert(sortedByLateDesc[0].daysLate >= sortedByLateDesc[1].daysLate, "Orden por atraso descendente incorrecto");
  const sortedByLateAsc = sortReceivableRows(mocks, "daysLate", "asc");
  assert(sortedByLateAsc[0].daysLate <= sortedByLateAsc[1].daysLate, "Orden por atraso ascendente incorrecto");

  const sortedByUnitAsc = sortReceivableRows(mocks, "unitId", "asc");
  assert(sortedByUnitAsc[0].unitId <= sortedByUnitAsc[1].unitId, "Orden por unidad ascendente incorrecto");
  const sortedByUnitDesc = sortReceivableRows(mocks, "unitId", "desc");
  assert(sortedByUnitDesc[0].unitId >= sortedByUnitDesc[1].unitId, "Orden por unidad descendente incorrecto");

  const sortedByNameAsc = sortReceivableRows(mocks, "name", "asc");
  assert(sortedByNameAsc[0].name <= sortedByNameAsc[1].name, "Orden por nombre ascendente incorrecto");
  const sortedByGroupAsc = sortReceivableRows(mocks, "group", "asc");
  assert(sortedByGroupAsc[0].group <= sortedByGroupAsc[1].group, "Orden por grupo ascendente incorrecto");
  const sortedByPlanAsc = sortReceivableRows(mocks, "plan", "asc");
  assert(["daily", "weekly", "biweekly", "monthly"].includes(sortedByPlanAsc[0].plan), "Orden por plan ascendente no valido");

  const sortedByDueAsc = sortReceivableRows(mocks, "nextDueDate", "asc");
  assert((sortedByDueAsc[0].nextDueDate ?? "") <= (sortedByDueAsc[1].nextDueDate ?? "9999-12-31"), "Orden por proximo vencimiento ascendente incorrecto");
  const sortedByDueDesc = sortReceivableRows(mocks, "nextDueDate", "desc");
  assert((sortedByDueDesc[0].nextDueDate ?? "") >= (sortedByDueDesc[1].nextDueDate ?? ""), "Orden por proximo vencimiento descendente incorrecto");

  const sortedByOverdueAsc = sortReceivableRows(mocks, "overdueBalance", "asc");
  assert(sortedByOverdueAsc[0].overdueBalance <= sortedByOverdueAsc[1].overdueBalance, "Orden por saldo vencido ascendente incorrecto");
  const sortedByPendingDesc = sortReceivableRows(mocks, "totalPending", "desc");
  assert(sortedByPendingDesc[0].totalPending >= sortedByPendingDesc[1].totalPending, "Orden por total pendiente descendente incorrecto");

  const sortedByLastPayAsc = sortReceivableRows(mocks, "lastPaymentDate", "asc");
  assert((sortedByLastPayAsc[0].lastPaymentDate ?? "") <= (sortedByLastPayAsc[1].lastPaymentDate ?? "9999-12-31"), "Orden por ultimo pago ascendente incorrecto");
  const sortedByPercentDesc = sortReceivableRows(mocks, "percentPaid", "desc");
  assert(sortedByPercentDesc[0].percentPaid >= sortedByPercentDesc[1].percentPaid, "Orden por % pagado descendente incorrecto");

  const sortedByStateAsc = sortReceivableRows(mocks, "state", "asc");
  assert(["alDia", "proximo", "venceHoy", "vencido", "critico"].includes(sortedByStateAsc[0].state), "Orden por estado ascendente no valido");

  const nullableDateRows = [
    { ...mocks[0], id: "nd-1", nextDueDate: null },
    { ...mocks[1], id: "nd-2", nextDueDate: "2026-04-15" },
    { ...mocks[2], id: "nd-3", nextDueDate: "2026-04-20" }
  ];
  const nullableDateAsc = sortReceivableRows(nullableDateRows, "nextDueDate", "asc");
  const nullableDateDesc = sortReceivableRows(nullableDateRows, "nextDueDate", "desc");
  assert(nullableDateAsc[nullableDateAsc.length - 1].nextDueDate === null, "Fechas vacias deben quedar al final en asc");
  assert(nullableDateDesc[nullableDateDesc.length - 1].nextDueDate === null, "Fechas vacias deben quedar al final en desc");

  const summary = computeReceivableSummary(mocks, [], now);
  assert(summary.totalPorCobrar > 0, "Resumen total por cobrar debe ser mayor a cero");
  assert(summary.totalVencido > 0, "Resumen total vencido debe ser mayor a cero");
  assert(summary.clientesMorosos > 0, "Resumen clientes morosos debe ser mayor a cero");

  const dueTodaySample = mocks.find((row) => row.state === "venceHoy");
  assert(!!dueTodaySample, "Debe existir al menos un mock en estado vence hoy");
  assert(dueTodaySample.overdueBalance === 0, "En camino 1, vence hoy no debe sumar saldo vencido");
  assert(dueTodaySample.totalPending > dueTodaySample.overdueBalance, "Total pendiente debe incluir no vencido");

  console.log("OK receivables module: estados, filtros, orden, resumen y mocks validados.");
})();
