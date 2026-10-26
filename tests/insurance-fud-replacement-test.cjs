const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "src/pages/InsuranceWorkflowPage.tsx"), "utf8");

const requirements = [
  ['claim.fudAttachment ? "Reemplazar FUD" : "Adjuntar FUD"', "la acción visible para corregir un FUD existente"],
  ["void handleFudAttachmentUpload(claim, file)", "la carga del archivo de reemplazo"],
  ["Copia digital del FUD reemplazada para corregir el archivo adjunto.", "la trazabilidad de la corrección"],
  ["removeInsuranceSettlement(claim.fudAttachment.path)", "la limpieza del FUD anterior después de guardar"],
  ["El archivo anterior se conserva.", "la garantía de conservación cuando falla el reemplazo"]
];

for (const [fragment, description] of requirements) {
  if (!source.includes(fragment)) throw new Error(`Falta ${description}.`);
}

const savePosition = source.indexOf("await saveInsuranceClaim(dataOwnerUserId, updatedClaim);", source.indexOf("async function handleFudAttachmentUpload"));
const cleanupPosition = source.indexOf("removeInsuranceSettlement(claim.fudAttachment.path)", savePosition);
if (savePosition < 0 || cleanupPosition < savePosition) {
  throw new Error("El FUD anterior solo debe eliminarse después de guardar correctamente el reemplazo.");
}

console.log("OK corrección de FUD: permite reemplazar el archivo con trazabilidad y conserva el anterior si falla.");
