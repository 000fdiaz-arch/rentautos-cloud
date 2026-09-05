const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const esbuild = require("esbuild");

const root = path.resolve(__dirname, "..");
const outDir = path.join(root, ".tmp", "tests");
fs.mkdirSync(outDir, { recursive: true });
const client = {
  id: "daily", unitId: "A01", name: "Prueba", status: "activo",
  frequency: "daily", rentAmount: 31, balance: 62, advanceBalance: 0,
  installmentsAgreed: 100, installmentsPaid: 8, installmentsRemaining: 92,
  installmentsIssued: 10, lastChargeDate: "2026-09-01", otherCharges: [], savings: 0
};

async function run() {
  const rulesPath = path.join(outDir, "cashClosingRules.cjs");
  esbuild.buildSync({ entryPoints: [path.join(root, "src/cashClosingRules.ts")], bundle: true, platform: "node", outfile: rulesPath });
  const { applyPendingCashClosingCharges, getCashClosingDateError, getCashClosingPendingChargesError, getLastClosableDateKey } = require(rulesPath);
  const lateWednesday = new Date("2026-09-03T04:59:59Z");
  assert.match(getCashClosingDateError("2026-09-02", lateWednesday), /día en curso/);
  assert.equal(getCashClosingDateError("2026-09-01", lateWednesday), null);
  assert.match(getCashClosingDateError("2026-09-03", lateWednesday), /adelantado/);
  assert.match(getCashClosingDateError("2026-09-03", new Date("2026-09-03T05:00:00Z")), /día en curso/);
  assert.equal(getLastClosableDateKey(new Date("2026-09-03T04:59:59Z")), "2026-09-01");
  assert.equal(getLastClosableDateKey(new Date("2026-09-03T05:00:00Z")), "2026-09-02");
  for (const date of ["", "2026-02-30", "2026-9-2", "invalid"]) assert.ok(getCashClosingDateError(date, lateWednesday));
  const before = structuredClone(client);
  assert.match(getCashClosingPendingChargesError([client], "2026-09-02"), /A01/);
  assert.equal(getCashClosingPendingChargesError([{ ...client, lastChargeDate: "2026-09-02" }], "2026-09-02"), null);
  assert.match(getCashClosingPendingChargesError([{ ...client, frequency: "weekly", weeklyChargeDay: "wednesday" }], "2026-09-02"), /A01/);
  assert.equal(getCashClosingPendingChargesError([{ ...client, frequency: "weekly", weeklyChargeDay: "thursday" }], "2026-09-02"), null);
  assert.match(getCashClosingPendingChargesError([{ ...client, balance: 0, advanceBalance: 31 }], "2026-09-02"), /A01/, "Un adelanto no sustituye el registro del cargo.");
  for (const override of [{ status: "taller" }, { status: "archivado" }, { archivedAt: "2026-09-01" }, { firstChargeDate: "2026-09-03" }, { installmentsIssued: 100 }, { rentAmount: 0 }]) {
    assert.equal(getCashClosingPendingChargesError([{ ...client, ...override }], "2026-09-02"), null);
  }
  assert.deepEqual(client, before, "La validación no debe modificar saldos ni cuotas.");
  const repaired = applyPendingCashClosingCharges([{ ...client, balance: 0, advanceBalance: 10 }], "2026-09-02");
  assert.equal(repaired.chargedClients, 1);
  assert.equal(repaired.chargedTotal, 21);
  assert.equal(repaired.clients[0].balance, 21);
  assert.equal(repaired.clients[0].advanceBalance, 0);
  assert.equal(repaired.clients[0].lastChargeDate, "2026-09-02");
  assert.equal(repaired.clients[0].installmentsIssued, 11);
  const repeatedRepair = applyPendingCashClosingCharges(repaired.clients, "2026-09-02");
  assert.equal(repeatedRepair.chargedClients, 0, "Reintentar la reparación no debe duplicar el cargo.");
  assert.deepEqual(repeatedRepair.clients, repaired.clients);

  // Exercise the actual hook, including the order of cloud validation and writes.
  const hookPath = path.join(outDir, "useCashClosing-date-guard.cjs");
  await esbuild.build({
    entryPoints: [path.join(root, "src/pages/payments/useCashClosing.ts")],
    bundle: true, platform: "node", outfile: hookPath,
    plugins: [{ name: "cash-closing-adapters", setup(build) {
      const modules = {
        react: `export const useEffect = () => {}; export const useMemo = fn => fn(); export const useState = initial => { const i = global.__cash.stateIndex++; const value = i === 1 ? global.__cash.date : typeof initial === 'function' ? initial() : initial; return [value, next => global.__cash.states[i] = next]; };`,
        cloudData: `const read = async () => { global.__cash.reads++; return []; }; const write = async () => { global.__cash.writes++; }; export { read as loadCloudCashClosingAudit, read as loadCloudCashClosings, read as loadCloudChargeRunLateFeeEntryIds, read as loadCloudChargeRunSnapshots, read as loadCloudChargeRuns, write as saveCloudCashClosingAudit, write as saveCloudCashClosings, write as saveCloudChargeRuns };`,
        cashLedger: `export const loadCashSummaryRange = async () => { global.__cash.reads++; return []; };`,
        supabase: `export const supabase = null;`,
        persistenceMode: `export const isSupabaseOnlyMode = true;`,
        storage: `export const loadLateFeeLedger = () => []; export const saveLateFeeLedger = () => { global.__cash.writes++; };`,
        paymentStorage: `const load = () => []; const save = () => { global.__cash.writes++; }; export { load as loadCashClosingAudit, load as loadCashClosings, load as loadChargeRuns, save as saveCashClosingAudit, save as saveCashClosings, save as saveChargeRuns };`
      };
      build.onResolve({ filter: /^(react)$|\/(cloudData|cashLedger|supabase|persistenceMode|storage|paymentStorage)$/ }, args => {
        const name = args.path.split("/").pop();
        return { path: name, namespace: "cash-test" };
      });
      build.onLoad({ filter: /.*/, namespace: "cash-test" }, args => ({ contents: modules[args.path], loader: "js" }));
    }}]
  });
  const RealDate = Date;
  global.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : ["2026-09-03T14:00:00Z"])); } static now() { return new RealDate("2026-09-03T14:00:00Z").getTime(); } };
  global.window = { confirm: message => { global.__cash.confirmations++; global.__cash.confirmMessage = message; return global.__cash.confirmResult; } };
  const useCashClosing = require(hookPath).default;
  async function attempt(date, clients, confirmResult = false) {
    global.__cash = { date, stateIndex: 0, states: {}, reads: 0, writes: 0, confirmations: 0, confirmMessage: "", confirmResult, savedClients: null };
    const hook = useCashClosing({ clients, payments: [], lateFeeSettings: { active: false, dailyAmount: 0, chargeLabel: "Mora", selectedUnits: [] }, dataOwnerUserId: "owner", onClientsChange: next => { global.__cash.writes++; global.__cash.savedClients = next; } });
    await hook.handleCloseCashForDate();
    return global.__cash;
  }
  try {
    const uiPath = path.join(outDir, "cashClosing-date-guard-ui.cjs");
    esbuild.buildSync({
      stdin: { contents: `export { default as CashClosingPanel } from './src/pages/payments/CashClosingPanel'; export { default as CashDayHeader } from './src/pages/cashClosing/CashDayHeader';`, resolveDir: root },
      bundle: true, platform: "node", packages: "external", jsx: "automatic", outfile: uiPath
    });
    const React = require("react");
    const { renderToStaticMarkup } = require("react-dom/server");
    const { CashClosingPanel, CashDayHeader } = require(uiPath);
    const panelHtml = renderToStaticMarkup(React.createElement(CashClosingPanel, {
      cashSectionRef: { current: null }, isCashClosingOpen: true, cashClosingDate: "2026-09-03", cashClosingActor: "Operador",
      cashClosings: [], cashClosingAudit: [], chargeRuns: [], isClosingCash: false
    }));
    assert.match(panelHtml, /max="2026-09-02"/);
    assert.match(panelHtml, /<button[^>]*disabled=""[^>]*>Cerrar caja del dia<\/button>/);
    assert.match(panelHtml, /No se puede cerrar la caja del día en curso/);
    const dayHtml = renderToStaticMarkup(React.createElement(CashDayHeader, {
      totals: { opening: 0, income: 0, expense: 0, expected: 0, real: 0, difference: 0 },
      viewTab: "operacion", cashDate: "2026-09-03", isAdmin: true, isDayInitialized: true, isDayClosed: false,
      setCashDate: () => {}, closingNote: "", setClosingNote: () => {}
    }));
    assert.match(dayHtml, /<button[^>]*disabled=""[^>]*>Cerrar caja del dia<\/button>/);
    const future = await attempt("2026-09-04", [client]);
    assert.match(future.states[4], /adelantado/);
    assert.equal(future.reads, 0);
    assert.equal(future.writes, 0);
    assert.equal(future.confirmations, 0);
    const sameDay = await attempt("2026-09-03", [client]);
    assert.match(sameDay.states[4], /día en curso/);
    assert.equal(sameDay.reads, 0);
    assert.equal(sameDay.writes, 0);
    assert.equal(sameDay.confirmations, 0);
    const skippedToday = await attempt("2026-09-02", [client]);
    assert.match(skippedToday.confirmMessage, /Primero se repararan 1 cargo\(s\) pendiente\(s\) de 2026-09-02/);
    assert.match(skippedToday.confirmMessage, /cargos automaticos para 2026-09-03/);
    assert.equal(skippedToday.writes, 0);
    assert.equal(skippedToday.confirmations, 1);
    const normal = await attempt("2026-09-02", [{ ...client, lastChargeDate: "2026-09-02" }]);
    assert.equal(normal.confirmations, 1, "Un cierre válido debe llegar a la confirmación normal.");
    assert.equal(normal.writes, 0, "Cancelar la confirmación no guarda cambios.");
    const repairedAndClosed = await attempt("2026-09-02", [client], true);
    assert.equal(repairedAndClosed.savedClients[0].lastChargeDate, "2026-09-03");
    assert.equal(repairedAndClosed.savedClients[0].balance, 124, "Debe reparar el 2 y aplicar el cargo normal del 3.");
    assert.equal(repairedAndClosed.savedClients[0].installmentsIssued, 12);
    assert.deepEqual(client, before);
  } finally { global.Date = RealDate; delete global.window; }
  console.log("OK cierre: fechas futuras bloqueadas en horario de Panamá, sin saltar cargos pendientes ni modificar cuotas durante la validación.");
}
run().catch(error => { console.error(error); process.exitCode = 1; });
