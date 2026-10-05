const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const workflow = fs.readFileSync(path.join(root, "src/pages/InsuranceWorkflowPage.tsx"), "utf8");
const unified = fs.readFileSync(path.join(root, "src/pages/UnifiedIncidentsFollowUp.tsx"), "utf8");
const receivables = fs.readFileSync(path.join(root, "src/pages/receivables/incidentReceivableActions.ts"), "utf8");

assert.match(workflow, /Finiquito <small>Opcional<\/small>/, "El finiquito debe identificarse como opcional.");
assert.match(workflow, /No es requisito para finalizar el reclamo\./, "La interfaz debe explicar que el finiquito no bloquea el cierre.");
assert.match(workflow, /claim\.status !== "Finalizado" && finalizingClaimId !== claim\.id/, "La finalización debe estar disponible aunque no exista finiquito.");
assert.doesNotMatch(workflow, /claim\.settlementDelivered && claim\.status !== "Finalizado" && finalizingClaimId !== claim\.id/, "El botón de finalizar no debe depender de la entrega del finiquito.");
assert.doesNotMatch(workflow, /Finiquito pendiente/, "Un documento opcional no debe mostrarse como pendiente.");
assert.match(unified, /"insurance_follow_up", "Dar seguimiento al reclamo"/, "La próxima acción no debe exigir gestionar el finiquito.");
assert.match(receivables, /label: "Dar seguimiento al reclamo"/, "Cuentas por cobrar tampoco debe presentar el finiquito como obligatorio.");

console.log("OK finiquito opcional: puede registrarse sin bloquear la finalización del reclamo.");
