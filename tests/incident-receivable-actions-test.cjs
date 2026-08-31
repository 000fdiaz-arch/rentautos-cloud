const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "src/pages/receivables/incidentReceivableActions.ts"), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText;
const target = path.join(os.tmpdir(), `incident-receivable-actions-${Date.now()}.cjs`);
fs.writeFileSync(target, output);
const { buildIncidentActionsByUnit, incidentActionBlocksManagement } = require(target);

function collision(id, unit, trialDate) {
  return {
    id,
    unit,
    trialDate,
    status: "PENDIENTE",
    clientWillAttend: null,
    legalAssistanceRequested: null,
    judicialFollowUps: [],
    insuranceClaim: null,
    judicialResolutionEvidence: null,
    createdAt: "2026-08-14T00:00:00.000Z",
    updatedAt: "2026-08-14T00:00:00.000Z"
  };
}

const actions = buildIncidentActionsByUnit(
  [],
  [collision("b17-case", "B17", "2026-08-17"), collision("t08-case", "T08", "2026-08-31")],
  "2026-08-15"
);

if (actions.B17?.label !== "Confirmar si el cliente irá y si se pidió asistencia legal") {
  throw new Error("B17 no muestra la confirmación judicial pendiente.");
}
if (actions.B17.date !== "2026-08-07" || !actions.B17.urgent) {
  throw new Error("B17 debe vencer diez días antes del juicio y aparecer urgente.");
}
if (actions.T08?.date !== "2026-08-21" || actions.T08.urgent) {
  throw new Error("T08 debe aparecer pendiente con fecha límite 2026-08-21, todavía sin urgencia.");
}
if (actions.B17.destination !== "judicial" || actions.B17.targetId !== "b17-case") {
  throw new Error("La acción de B17 no abre el expediente judicial correcto.");
}
if (!incidentActionBlocksManagement(actions.B17)) {
  throw new Error("B17 debe bloquear la clasificación y gestión de cobro por estar urgente.");
}
if (incidentActionBlocksManagement(actions.T08)) {
  throw new Error("T08 todavía debe permitir la gestión antes de su fecha límite.");
}
if (incidentActionBlocksManagement(undefined)) {
  throw new Error("Una unidad sin acción de siniestros no debe quedar bloqueada.");
}

const completedFollowUp = collision("completed-case", "C30", "2026-09-10");
completedFollowUp.clientWillAttend = true;
completedFollowUp.legalAssistanceRequested = true;
completedFollowUp.judicialFollowUps = [{
  nextStep: "Llamar al juzgado",
  nextActionDate: "2026-08-14",
  completedAt: "2026-08-15T09:00:00Z"
}];
const completedActions = buildIncidentActionsByUnit([], [completedFollowUp], "2026-08-15");
if (completedActions.C30) {
  throw new Error("Un seguimiento judicial realizado no debe seguir bloqueando la gestión.");
}

const completedInsuranceActions = buildIncidentActionsByUnit([{
  id: "completed-claim", unit: "C31", status: "Activo", claimNumber: "REC-31",
  documentationPending: false, settlementDelivered: false,
  followUps: [{ nextStep: "Consultar ajustador", nextActionDate: "2026-08-14", completedAt: "2026-08-15T09:00:00Z" }],
  createdAt: "2026-08-10T08:00:00Z", updatedAt: "2026-08-15T09:00:00Z"
}], [], "2026-08-15");
if (completedInsuranceActions.C31?.urgent || completedInsuranceActions.C31?.label !== "Dar seguimiento y gestionar finiquito") {
  throw new Error("La nota del seguro no debe reemplazar la acción propia del reclamo.");
}

const noteOnlyInsuranceActions = buildIncidentActionsByUnit([{
  id: "noted-claim", unit: "C32", status: "Activo", claimNumber: "REC-32",
  documentationPending: false, settlementDelivered: false,
  followUps: [{ comment: "El ajustador confirmó recepción", nextStep: "", nextActionDate: "", createdAt: "2026-08-15T09:00:00Z" }],
  createdAt: "2026-08-10T08:00:00Z", updatedAt: "2026-08-15T09:00:00Z"
}], [], "2026-08-15");
if (noteOnlyInsuranceActions.C32?.label !== "Dar seguimiento y gestionar finiquito") {
  throw new Error("Una nota nueva no debe convertirse en la acción de cuentas por cobrar.");
}

const documentationActions = buildIncidentActionsByUnit(
  [{
    id: "fud-case", unit: "S21", status: "Inactivo", claimNumber: "", documentationPending: true,
    documentationPendingSince: "2026-08-13T08:00:00Z", followUps: [], settlementDelivered: false,
    createdAt: "2026-08-13T08:00:00Z", updatedAt: "2026-08-13T08:00:00Z"
  }],
  [collision("stub-case", "B22", "")],
  "2026-08-15"
);
if (documentationActions.S21?.label !== "Coordinar entrega presencial del FUD" || !documentationActions.S21.urgent) {
  throw new Error("El FUD pendiente debe escalar como acción urgente a las 48 horas.");
}

const finalizedPendingActions = buildIncidentActionsByUnit([{
  id: "finalized-fud-case", unit: "S22", status: "Finalizado", claimNumber: "REC-22",
  documentationPending: true, documentationPendingSince: "2026-08-13T08:00:00Z",
  followUps: [], settlementDelivered: true,
  createdAt: "2026-08-10T08:00:00Z", updatedAt: "2026-08-13T08:00:00Z"
}], [], "2026-08-15");
if (finalizedPendingActions.S22?.label !== "Coordinar entrega presencial del FUD" || !finalizedPendingActions.S22.urgent) {
  throw new Error("Un reclamo finalizado también debe revisarse si falta confirmar la entrega presencial del FUD.");
}

const pendingStub = collision("stub-case-2", "B23", "");
pendingStub.documentationPending = true;
pendingStub.documentationPendingSince = "2026-08-14T08:00:00Z";
const pendingStubActions = buildIncidentActionsByUnit([], [pendingStub], "2026-08-15");
if (pendingStubActions.B23?.label !== "Obtener y registrar la colilla" || pendingStubActions.B23.urgent) {
  throw new Error("La colilla pendiente debe mostrarse sin bloquear antes de las 48 horas.");
}

console.log("OK acciones de siniestros: B17 bloquea la gestión urgente y T08 permanece como aviso futuro.");
