const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "src/pages/incidents/incidentDocumentation.ts"), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText;
const target = path.join(os.tmpdir(), `incident-documentation-${Date.now()}.cjs`);
fs.writeFileSync(target, output);
const { documentationAlertState } = require(target);

const now = new Date("2026-08-17T12:00:00Z");
const recent = documentationAlertState("2026-08-17T00:00:00Z", now);
const delayed = documentationAlertState("2026-08-16T12:00:00Z", now);
const overdue = documentationAlertState("2026-08-15T12:00:00Z", now);

if (recent.severity !== "attention" || recent.title !== "Pendiente") throw new Error("Antes de 24 horas debe mantenerse como atención.");
if (delayed.severity !== "urgent" || delayed.title !== "Documentación no recibida") throw new Error("A las 24 horas debe escalar a urgente.");
if (overdue.severity !== "urgent" || overdue.title !== "Documentación vencida") throw new Error("A las 48 horas debe marcarse vencida.");

console.log("OK alertas documentales: atención inicial, urgencia a 24 horas y vencimiento a 48 horas.");
