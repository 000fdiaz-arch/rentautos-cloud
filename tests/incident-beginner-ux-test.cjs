const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const root = process.cwd();
const intake = readFileSync(join(root, "src/pages/IncidentIntakeForm.tsx"), "utf8");
const unified = readFileSync(join(root, "src/pages/UnifiedIncidentsFollowUp.tsx"), "utf8");
const insurance = readFileSync(join(root, "src/pages/InsuranceWorkflowPage.tsx"), "utf8");
const collisions = readFileSync(join(root, "src/pages/CollisionsPage.tsx"), "utf8");
const timeline = readFileSync(join(root, "src/pages/incidents/judicialCaseTimeline.ts"), "utf8");
const filtersCss = readFileSync(join(root, "src/pages/incidents/incidentFilters.css"), "utf8");

assert.match(intake, /type IntakeStep = 1 \| 2 \| 3/);
assert.match(intake, /Paso 1 · Datos de la colisión/);
assert.match(intake, /¿La colisión debe pasar por un juzgado\?/);
assert.match(intake, /Paso 3 · Documentos y confirmación/);
assert.match(intake, /FUD significa Formato Único y Definitivo para Accidentes de Tránsito Menor/);
assert.match(intake, /La colilla es el volante o desprendible físico/);
assert.match(intake, /Una foto o PDF no sustituye la entrega física del original/);
assert.match(intake, /workflow-field-error/);
assert.match(intake, /incident-inline-create/);

assert.match(unified, /Filtros rápidos por área/);
assert.match(unified, /function nextActionButtonLabel/);
assert.match(unified, /Agregar número de reclamo/);
assert.doesNotMatch(unified, />Gestionar ahora</);
assert.match(filtersCss, /\.unified-incidents-filter-groups\s*\{\s*display: none/);

assert.match(insurance, /Falta información/);
assert.match(insurance, /En gestión con aseguradora/);
assert.match(insurance, /Reclamo cerrado/);
assert.doesNotMatch(insurance, /<select\s+className=\{`workflow-status-select/);
assert.match(insurance, /Documento final de pago o cierre emitido por la aseguradora/);

assert.match(collisions, /Lo que debes hacer ahora/);
assert.match(collisions, /agrega cada novedad en Notas/);
assert.match(timeline, /note\.nextStep \?/);

console.log("OK UX de siniestros para principiantes: asistente, ayudas, acciones y estados claros.");
