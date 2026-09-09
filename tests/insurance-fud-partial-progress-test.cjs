const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.resolve(__dirname, "../src/pages/InsuranceWorkflowPage.tsx"), "utf8");
const progressStart = source.indexOf("async function saveFudProgress");
const completionStart = source.indexOf("async function completeFudDocumentation");
const progressHandler = source.slice(progressStart, completionStart);
const completionHandler = source.slice(completionStart, source.indexOf("async function viewSettlement", completionStart));

if (progressStart < 0 || completionStart < 0) {
  throw new Error("Deben existir acciones separadas para guardar avances y completar el FUD.");
}
if (!source.includes('"Guardar avance"') || !source.includes('"Completar FUD"')) {
  throw new Error("La interfaz debe mostrar por separado Guardar avance y Completar FUD.");
}
if (!progressHandler.includes("documentationPending: true") || !progressHandler.includes("Avance guardado.")) {
  throw new Error("Guardar avance debe conservar la alerta documental y confirmar el guardado.");
}
if (!progressHandler.includes("Escribe el registro de la gestión para guardar el avance.")) {
  throw new Error("El avance debe dejar trazabilidad mediante el registro de gestión.");
}
if (progressHandler.includes("!fudCompletionForm.deliveryDate ||") || progressHandler.includes("!fudCompletionForm.physicalDeliveryConfirmed")) {
  throw new Error("La fecha y la entrega presencial no deben bloquear el guardado parcial.");
}
if (!completionHandler.includes("missingFudCompletionRequirements") || !completionHandler.includes("documentationPending: false")) {
  throw new Error("Completar el FUD debe validar todos los requisitos y retirar la alerta.");
}
if (!source.includes("Información pendiente para completar el FUD") || !source.includes("fudCompletionMissing.map")) {
  throw new Error("La pantalla debe enumerar exactamente qué falta para completar el FUD.");
}
if (!source.includes('hasClaimNumber: claim.claimNumber.trim() ? "yes" : "no"')) {
  throw new Error("Un expediente sin número debe abrir explícitamente con la opción No seleccionada.");
}

console.log("OK FUD parcial: guarda aseguradora y avances sin fingir la recepción física.");
