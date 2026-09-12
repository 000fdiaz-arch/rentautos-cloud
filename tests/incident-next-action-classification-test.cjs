const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const source = fs.readFileSync(path.join(__dirname, "../src/pages/UnifiedIncidentsFollowUp.tsx"), "utf8");
const compiled = ts.transpileModule(`${source}\nexport { claimNextAction, collisionNextAction, nextActionGroup, incidentActionSchedule, compareIncidents };`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 }
}).outputText;
const moduleUnderTest = { exports: {} };
const dependencies = {
  "../collisionDocumentation": { getMissingCollisionDocumentation: () => [], formatMissingCollisionDocumentation: () => "" },
  "../courtNames": { normalizeCourtName: (value) => value.trim().toUpperCase() },
  "./incidents/judicialCaseNavigation": { nextPendingJudicialStep: () => "outcome", daysUntilAttendanceConfirmation: () => null }
};
const requireStub = (name) => dependencies[name] ?? {};
new Function("require", "module", "exports", compiled)(requireStub, moduleUnderTest, moduleUnderTest.exports);

const { claimNextAction, collisionNextAction, nextActionGroup, incidentActionSchedule, compareIncidents } = moduleUnderTest.exports;
const claim = {
  incidentDate: "2026-08-30",
  documentationPending: true,
  fudPhysicalDeliveryConfirmed: false,
  fudAttachment: null,
  claimNumber: "",
  status: "Inactivo",
  createdAt: "2026-09-01T12:00:00Z"
};
const collision = {
  status: "ABSUELTO",
  judicialResolutionEvidence: null,
  judicialResolutionSearchDate: "2026-09-20"
};

const resolution = collisionNextAction(collision, claim);
const fudDelivery = claimNextAction(claim);
assert.equal(resolution.key, "judicial_resolution");
assert.equal(resolution.groupLabel, "Buscar y adjuntar resolución judicial");
assert.equal(resolution.destination, "judicial");
assert.equal(resolution.date, "2026-09-20");
assert.notEqual(resolution.key, fudDelivery.key);
assert.equal(fudDelivery.groupLabel, "Coordinar entrega presencial del FUD");
assert.equal(fudDelivery.destination, "insurance");
assert.equal(nextActionGroup({ action: resolution, finalized: false }).value, "judicial_resolution");
assert.equal(incidentActionSchedule({ action: resolution, finalized: false }).date, "2026-09-20");

const fudAttachment = claimNextAction({ ...claim, fudPhysicalDeliveryConfirmed: true });
assert.equal(fudAttachment.key, "fud_attachment");
assert.equal(fudAttachment.groupLabel, "Adjuntar copia digital del FUD");

const fudCompletion = claimNextAction({ ...claim, fudPhysicalDeliveryConfirmed: true, fudAttachment: { path: "fud.pdf" } });
assert.equal(fudCompletion.key, "fud_completion");

const judicialResult = collisionNextAction({ ...collision, status: "PENDIENTE", trialDate: "2026-09-20" }, null);
assert.equal(judicialResult.key, "judicial_result");
assert.notEqual(judicialResult.key, resolution.key);

const administrativeClosure = collisionNextAction({ ...collision, status: "CIERRE ADMINISTRATIVO" }, null);
assert.equal(administrativeClosure.finalized, true);
assert.equal(nextActionGroup({ action: administrativeClosure, finalized: true }), null);

const incidentsByOccurrence = [
  { incidentDate: "2026-07-09", action: { date: "2026-08-10" }, requiresAction: true, updatedAt: "2026-08-01" },
  { incidentDate: "2026-05-16", action: { date: "2026-08-10" }, requiresAction: true, updatedAt: "2026-08-02" },
  { incidentDate: "2024-04-30", action: { date: "2026-08-21" }, requiresAction: true, updatedAt: "2026-08-03" }
];
incidentsByOccurrence.sort((left, right) => compareIncidents(left, right, "incident_asc"));
assert.deepEqual(incidentsByOccurrence.map((incident) => incident.incidentDate), ["2024-04-30", "2026-05-16", "2026-07-09"]);
incidentsByOccurrence.sort((left, right) => compareIncidents(left, right, "action_asc"));
assert.equal(incidentsByOccurrence.at(-1).incidentDate, "2024-04-30");

console.log("OK acciones y orden: siniestros antiguos primero por defecto, con orden de próxima acción disponible.");
