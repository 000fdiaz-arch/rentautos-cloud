const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const rulesPath = path.join(root, "src/pages/incidents/incidentIntakeRules.ts");
const source = fs.readFileSync(rulesPath, "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText;
const target = path.join(os.tmpdir(), `incident-intake-rules-${Date.now()}.cjs`);
fs.writeFileSync(target, output);

const { insuranceClaimStatusAfterFudCompletion, requiresInsuranceClaimDetails, requiresInsuranceFud, shouldUploadInsuranceFud } = require(target);

if (requiresInsuranceFud("no")) {
  throw new Error("Un reclamo con FUD pendiente no debe exigir el documento para guardarse.");
}
if (!requiresInsuranceFud("yes")) {
  throw new Error("Un reclamo que ya recibió el FUD debe exigir el documento.");
}
if (requiresInsuranceClaimDetails("no")) {
  throw new Error("Un reclamo con FUD pendiente no debe exigir todavía aseguradora, monto ni número de reclamo.");
}
if (!requiresInsuranceClaimDetails("yes")) {
  throw new Error("Los datos del reclamo deben exigirse cuando el FUD ya fue recibido.");
}
if (insuranceClaimStatusAfterFudCompletion("Inactivo", "REC-57") !== "Activo") {
  throw new Error("Completar el FUD con número de reclamo debe activar el expediente.");
}
if (insuranceClaimStatusAfterFudCompletion("Activo", "") !== "Inactivo") {
  throw new Error("Completar el FUD sin número de reclamo debe mantener el expediente inactivo.");
}
if (insuranceClaimStatusAfterFudCompletion("Finalizado", "REC-57") !== "Finalizado") {
  throw new Error("Completar documentación histórica no debe reabrir un expediente finalizado.");
}
if (shouldUploadInsuranceFud("no", true)) {
  throw new Error("Un archivo residual no debe subirse cuando el FUD está marcado como pendiente.");
}
if (!shouldUploadInsuranceFud("yes", true) || shouldUploadInsuranceFud("yes", false)) {
  throw new Error("El FUD recibido solo debe subirse cuando existe un archivo seleccionado.");
}

const formSource = fs.readFileSync(path.join(root, "src/pages/IncidentIntakeForm.tsx"), "utf8");
if (formSource.includes('if (!fudFile) throw new Error("Falta el documento FUD.")')) {
  throw new Error("El formulario todavía contiene la exigencia incondicional que bloquea el FUD pendiente.");
}
if (!formSource.includes("shouldUploadInsuranceFud(form.documentationAvailable, Boolean(fudFile))")) {
  throw new Error("El formulario debe aplicar la regla de carga condicional del FUD.");
}
if (!formSource.includes("requiresInsuranceClaimDetails(form.documentationAvailable)")) {
  throw new Error("El formulario debe aplicar la regla condicional a los datos del reclamo.");
}
if (!formSource.includes("Datos del FUD pendientes") || !formSource.includes("Completar FUD")) {
  throw new Error("El registro debe explicar que los datos del FUD se completarán posteriormente.");
}

console.log("OK registro de reclamo con FUD pendiente y carga condicional del documento.");
