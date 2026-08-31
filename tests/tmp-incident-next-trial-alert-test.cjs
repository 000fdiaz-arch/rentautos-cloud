const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const page = fs.readFileSync(path.join(root, "src/pages/UnifiedIncidentsFollowUp.tsx"), "utf8");
const css = fs.readFileSync(path.join(root, "src/pages/incidents/incidentFilters.css"), "utf8");

assert.match(page, /const trialOverview = useMemo/);
assert.match(page, /upcoming: upcoming\.slice\(0, 5\)/);
assert.match(page, /type IncidentsWorkspaceView = "incidents" \| "agenda"/);
assert.match(page, /setWorkspaceView\("agenda"\)/);
assert.match(page, /Expedientes/);
assert.match(page, /Agenda judicial/);
assert.match(page, /incident-next-trial-compact/);
assert.match(page, /Faltan \$\{entry\.offset\} días/);
assert.match(page, /juicio sin fecha/);
assert.match(page, /entry\.offset <= 3 \? "urgent" : entry\.offset <= 10 \? "attention" : "upcoming"/);
assert.match(page, /trialOffset >= 1 && trialOffset <= 10/);
assert.match(page, /trialDaysRemaining <= 3 \? "urgent"/);
assert.match(page, /judicialTrialReadiness/);
assert.match(page, /Listo para juicio/);
assert.match(page, /Faltan \$\{readiness\.missing\.length\}/);
assert.match(css, /\.incident-trial-agenda/);
assert.match(css, /\.incident-workspace-tabs/);
assert.match(css, /\.incident-next-trial-compact/);
assert.match(css, /\.incident-trial-readiness\.is-ready/);
assert.match(css, /\.incident-trials-missing/);

console.log("OK agenda judicial: cinco próximos juicios, preparación, escalamiento 10/3/1 días y expedientes sin fecha.");
