const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const page = fs.readFileSync(path.join(root, "src/pages/UnifiedIncidentsFollowUp.tsx"), "utf8");
const css = fs.readFileSync(path.join(root, "src/pages/incidents/incidentFilters.css"), "utf8");

assert.match(page, /incidentsMatchingActionContext/);
assert.match(page, /visibleNextAction/);
assert.match(page, /NEXT_ACTION_GROUPS/);
assert.match(page, /nextActionGroup/);
assert.match(page, /nextActionOptions/);
assert.match(page, /nextActionTotal/);
assert.match(page, /unified-incidents-filter-label-with-count/);
assert.match(page, /incident-action-strip[\s\S]*?incident-next-action-filter[\s\S]*?Vencidos/);
assert.match(page, /Próx\. acción <b>\{nextActionTotal\}<\/b>/);
assert.match(page, /Todas pendientes \(\{nextActionTotal\}\)/);
assert.match(page, /if \(incident\.finalized\) return null/);
assert.match(page, /followUp\.comment\.trim\(\)/);
assert.match(page, /nextActionGroup\(incident\)\?\.value !== nextActionFilter/);
assert.match(page, /unified-incident-action-group/);
assert.match(page, /if \(!latestFollowUp\) return \{ label: "Registrar seguimiento del seguro", finalized: false, requiresAction: true \}/);
assert.doesNotMatch(page, /Definir próximo seguimiento del seguro/);
assert.doesNotMatch(page, /scheduled_follow_up/);
assert.doesNotMatch(page, /incident-next-action-strip/);
assert.match(css, /\.unified-incidents-filter-label-with-count b/);
assert.match(css, /\.unified-incident-action-group/);

console.log("OK próximas acciones: selector agrupado y categoría visible en cada tarjeta.");
