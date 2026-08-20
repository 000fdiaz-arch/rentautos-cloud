const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "src/pages/incidents/incidentFilterRules.ts"), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText;
const target = path.join(os.tmpdir(), `incident-control-filters-${Date.now()}.cjs`);
fs.writeFileSync(target, output);
const { dateMatchesRange, hasMissingClaimNumber } = require(target);

if (!hasMissingClaimNumber("") || !hasMissingClaimNumber("   ") || hasMissingClaimNumber("REC-104")) {
  throw new Error("El filtro sin número debe evaluar el número real del reclamo.");
}

if (!dateMatchesRange("2026-08-20", "2026-08-01", "2026-08-31")) {
  throw new Error("Una fecha dentro del rango debe coincidir.");
}
if (dateMatchesRange("2026-07-31", "2026-08-01", "2026-08-31")) {
  throw new Error("Una fecha anterior al rango no debe coincidir.");
}
if (dateMatchesRange("2026-09-01", "2026-08-01", "2026-08-31")) {
  throw new Error("Una fecha posterior al rango no debe coincidir.");
}
if (!dateMatchesRange("2026-08-20", "", "2026-08-20") || !dateMatchesRange("2026-08-20", "2026-08-20", "")) {
  throw new Error("Los límites abiertos deben incluir la fecha límite.");
}
if (dateMatchesRange("", "2026-08-01", "2026-08-31")) {
  throw new Error("Un expediente sin fecha no debe aparecer al aplicar un rango.");
}

console.log("OK filtros de siniestros: número de reclamo y rangos de fecha.");
