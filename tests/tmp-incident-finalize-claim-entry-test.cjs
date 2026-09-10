const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const unified = fs.readFileSync(path.join(root, "src/pages/UnifiedIncidentsFollowUp.tsx"), "utf8");
const control = fs.readFileSync(path.join(root, "src/pages/IncidentsControlPage.tsx"), "utf8");
const insurance = fs.readFileSync(path.join(root, "src/pages/InsuranceWorkflowPage.tsx"), "utf8");

assert.match(unified, /action: "finalize_claim"/);
assert.match(unified, /category === "finalize_claim" \? "finalize_claim" : undefined/);
assert.match(control, /initialAction=\{managementTarget\.action\}/);
assert.match(insurance, /initialAction === "finalize_claim" \? focusedClaimId \|\| initialExpandedId \|\| null : null/);
assert.match(insurance, />\s*Finalizar reclamo\s*<\/button>/);
assert.match(insurance, /Confirmar finalización/);

console.log("OK: la acción Finalizar reclamo abre el formulario y conserva un botón de acceso dentro del expediente.");
