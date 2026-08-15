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
const { defaultJudicialCaseTab } = require(target);

function judicialCase(overrides = {}) {
  return {
    status: "PENDIENTE",
    trialDate: "2026-08-31",
    clientWillAttend: true,
    legalAssistanceRequested: true,
    judicialFollowUps: [],
    judicialResolutionEvidence: null,
    insuranceClaim: null,
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

console.log("OK navegación judicial: cada acción abre directamente su sección del expediente.");
