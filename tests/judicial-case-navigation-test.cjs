const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "src/pages/incidents/judicialCaseNavigation.ts"), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText;
const target = path.join(os.tmpdir(), `judicial-case-navigation-${Date.now()}.cjs`);
fs.writeFileSync(target, output);
const { availableJudicialCaseTabs, daysUntilAttendanceConfirmation, defaultJudicialCaseTab, nextPendingJudicialStep } = require(target);

function judicialCase(overrides = {}) {
  return {
    status: "PENDIENTE",
    trialDate: "2026-08-31",
    clientWillAttend: true,
    legalAssistanceRequested: true,
    judicialFollowUps: [],
    judicialResolutionEvidence: null,
    insuranceClaim: null,
    vehicleInspectedAt: "2026-08-10T10:00:00Z",
    expenseInvoice: { chargeId: "charge-1" },
    ...overrides
  };
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: esperado ${expected}, recibido ${actual}`);
}

assertEqual(defaultJudicialCaseTab(judicialCase({
  trialDate: "2026-08-17",
  clientWillAttend: null,
  legalAssistanceRequested: null
}), "2026-08-15"), "attendance", "B17 abre Asistencia");

assertEqual(defaultJudicialCaseTab(judicialCase({
  trialDate: "2026-08-14",
  clientWillAttend: null,
  legalAssistanceRequested: null
}), "2026-08-15"), "outcome", "juicio vencido abre Resultado");

assertEqual(defaultJudicialCaseTab(judicialCase({
  status: "ABSUELTO",
  judicialResolutionEvidence: { path: "resolution.jpg" }
}), "2026-08-15"), "insurance", "absolución con resolución abre Seguro");

assertEqual(defaultJudicialCaseTab(judicialCase({
  judicialFollowUps: [{ nextActionDate: "2026-08-15" }]
}), "2026-08-15"), "follow_up", "seguimiento vencido abre Seguimiento");

assertEqual(defaultJudicialCaseTab(judicialCase(), "2026-08-15"), "summary", "expediente al día abre Resumen");

const documentationPendingCase = judicialCase({ documentationPending: true, trialDate: "", vehicleInspectedAt: null, expenseInvoice: null });
assertEqual(nextPendingJudicialStep(documentationPendingCase, "2026-08-15"), "documentation", "la colilla pendiente bloquea los pasos posteriores");
assertEqual(defaultJudicialCaseTab(documentationPendingCase, "2026-08-15"), "summary", "la colilla pendiente abre Resumen");
const documentationTabs = availableJudicialCaseTabs(documentationPendingCase, "2026-08-15");
if (documentationTabs.join(",") !== "summary,follow_up,history") throw new Error("Con colilla pendiente solo deben aparecer Resumen, Seguimiento e Historial.");

const pendingTabs = availableJudicialCaseTabs(judicialCase(), "2026-08-15");
if (pendingTabs.includes("insurance")) throw new Error("Seguro no debe aparecer antes de estar habilitado.");

const guiltyTabs = availableJudicialCaseTabs(judicialCase({ status: "CULPABLE", expenseInvoice: null }), "2026-08-15");
if (guiltyTabs.includes("attendance") || guiltyTabs.includes("follow_up") || guiltyTabs.includes("balance") || guiltyTabs.includes("insurance")) {
  throw new Error("Un expediente culpable no debe mostrar pasos que ya no están habilitados.");
}

const settledTabs = availableJudicialCaseTabs(judicialCase({
  status: "ABSUELTO",
  judicialResolutionEvidence: { path: "resolution.jpg" }
}), "2026-08-15");
if (!settledTabs.includes("insurance")) throw new Error("Seguro debe aparecer al quedar habilitado.");

const awaitingWorkshop = judicialCase({ vehicleInspectedAt: null, expenseInvoice: null });
assertEqual(defaultJudicialCaseTab(awaitingWorkshop, "2026-08-15"), "workshop", "expediente nuevo abre Taller");
const awaitingWorkshopTabs = availableJudicialCaseTabs(awaitingWorkshop, "2026-08-15");
if (awaitingWorkshopTabs.includes("balance") || awaitingWorkshopTabs.includes("outcome")) {
  throw new Error("Saldo y Resultado no deben aparecer antes de revisar el vehículo.");
}

const awaitingBalance = judicialCase({ expenseInvoice: null });
assertEqual(defaultJudicialCaseTab(awaitingBalance, "2026-08-15"), "balance", "revisión completada abre Saldo");
if (availableJudicialCaseTabs(awaitingBalance, "2026-08-15").includes("outcome")) {
  throw new Error("Resultado no debe aparecer antes de registrar el saldo.");
}

const beforeTrialTabs = availableJudicialCaseTabs(judicialCase({ trialDate: "2026-08-16" }), "2026-08-15");
if (beforeTrialTabs.includes("outcome")) throw new Error("Resultado no debe aparecer antes de la fecha del juicio.");

const trialDayTabs = availableJudicialCaseTabs(judicialCase({ trialDate: "2026-08-15" }), "2026-08-15");
if (!trialDayTabs.includes("outcome")) throw new Error("Resultado debe aparecer el día del juicio.");

assertEqual(nextPendingJudicialStep(judicialCase({
  trialDate: "2026-08-31",
  vehicleInspectedAt: null,
  expenseInvoice: null
}), "2026-08-15"), "workshop", "acción pendiente solicita Taller");

assertEqual(nextPendingJudicialStep(judicialCase({
  trialDate: "2026-08-31",
  expenseInvoice: null
}), "2026-08-15"), "balance", "acción pendiente solicita Saldo");

assertEqual(nextPendingJudicialStep(judicialCase({
  trialDate: "2026-08-14",
  vehicleInspectedAt: null,
  expenseInvoice: null,
  clientWillAttend: null,
  legalAssistanceRequested: null
}), "2026-08-15"), "workshop", "juicio vencido mantiene el primer paso bloqueante");

assertEqual(nextPendingJudicialStep(judicialCase({
  trialDate: "2026-08-15"
}), "2026-08-15"), "outcome", "flujo completo solicita Resultado el día del juicio");

assertEqual(daysUntilAttendanceConfirmation(judicialCase({
  trialDate: "2026-08-31",
  clientWillAttend: null,
  legalAssistanceRequested: null
}), "2026-08-15"), 6, "T08 muestra días restantes para confirmar asistencia");

assertEqual(daysUntilAttendanceConfirmation(judicialCase({
  trialDate: "2026-08-25",
  clientWillAttend: null,
  legalAssistanceRequested: null
}), "2026-08-15"), null, "al llegar a diez días la confirmación ya es inmediata");

console.log("OK navegación judicial: cada acción abre directamente su sección del expediente.");
