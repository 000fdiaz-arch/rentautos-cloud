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
const { buildIncidentActionsByUnit } = require(target);

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
  "2026-08-14"
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

console.log("OK acciones de siniestros: B17 y T08 muestran confirmación judicial con fecha límite correcta.");
