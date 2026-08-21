const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const intake = fs.readFileSync(path.join(root, "src/pages/IncidentIntakeForm.tsx"), "utf8");
const workflow = fs.readFileSync(path.join(root, "src/pages/InsuranceWorkflowPage.tsx"), "utf8");
const cloud = fs.readFileSync(path.join(root, "src/cloud/operationsCloudData.ts"), "utf8");
const followUp = fs.readFileSync(path.join(root, "src/pages/UnifiedIncidentsFollowUp.tsx"), "utf8");

function assertIncludes(source, expected, message) {
  if (!source.includes(expected)) throw new Error(message);
}

assertIncludes(intake, "¿El FUD original ya fue entregado presencialmente?", "El registro debe preguntar expresamente por la entrega presencial.");
assertIncludes(intake, "Una foto o PDF no sustituye la entrega física del original.", "El registro debe diferenciar la copia digital del documento físico.");
assertIncludes(intake, "Fecha de entrega presencial", "La entrega presencial debe conservar su fecha.");
assertIncludes(intake, "fudPhysicalDeliveryConfirmed: !documentationPending", "Los reclamos nuevos deben guardar la confirmación presencial explícita.");

assertIncludes(workflow, "Copia digital del FUD adjuntada. Falta confirmar la entrega presencial del original.", "Adjuntar una copia no debe completar el requisito presencial.");
assertIncludes(workflow, "documentationPending: true", "La copia digital debe mantener pendiente el expediente.");
assertIncludes(workflow, "Confirmo que el FUD original fue recibido presencialmente", "La revisión debe exigir confirmación explícita.");
assertIncludes(workflow, "Confirmar entrega presencial", "Debe existir una acción separada para completar la entrega física.");

assertIncludes(cloud, "claim.documentationPending === true || !fudPhysicalDeliveryConfirmed", "Los reclamos anteriores sin confirmación deben normalizarse como pendientes.");
assertIncludes(followUp, "Coordinar entrega presencial del FUD", "Las alertas deben describir la acción presencial correcta.");

console.log("OK FUD: entrega presencial, copia digital y expedientes anteriores pendientes.");
