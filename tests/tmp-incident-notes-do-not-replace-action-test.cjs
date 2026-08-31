const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const unified = fs.readFileSync(path.join(root, "src/pages/UnifiedIncidentsFollowUp.tsx"), "utf8");
const insurance = fs.readFileSync(path.join(root, "src/pages/InsuranceWorkflowPage.tsx"), "utf8");
const judicial = fs.readFileSync(path.join(root, "src/pages/CollisionsPage.tsx"), "utf8");
const receivables = fs.readFileSync(path.join(root, "src/pages/receivables/incidentReceivableActions.ts"), "utf8");

assert.match(unified, /<small>\{incident\.finalized \? "Estado" : "Acción pendiente"\}<\/small>[\s\S]*?<strong>\{incident\.nextAction\}<\/strong>[\s\S]*?latestIncidentNote/);
assert.match(unified, /Última nota/);
assert.match(unified, /incidentLatestNote/);
assert.doesNotMatch(unified, /incidentFollowUpSummary/);
assert.doesNotMatch(unified, /Seguimiento judicial vencido|Seguimiento del reclamo vencido/);

for (const page of [insurance, judicial]) {
  const formStart = page.indexOf('className="judicial-follow-up-form"');
  const formEnd = page.indexOf("</div>}", formStart);
  const form = page.slice(formStart, formEnd);
  assert.ok(formStart >= 0 && formEnd > formStart, "No se encontró el formulario de notas.");
  assert.match(form, /Nueva nota/);
  assert.match(form, /Guardar nota/);
  assert.doesNotMatch(form, /type="date"|Próximo paso|Próxima gestión/);
}

assert.doesNotMatch(receivables, /latestPendingFollowUp|nextActionDate/);

console.log("OK notas de siniestros: la acción permanece principal y la nota no exige fecha ni reemplaza el paso.");
