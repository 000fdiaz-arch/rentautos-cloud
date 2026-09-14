const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function loadTypeScriptModule(relativePath) {
  const source = fs.readFileSync(path.resolve(__dirname, "..", relativePath), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: () => ({}), console });
  return module.exports;
}

const {
  activeRouteDeltaFromPayload,
  applyActiveRouteDelta
} = loadTypeScriptModule("src/cloud/operationsCloudData.ts");
const {
  routeReportDeltaFromPayload,
  applyRouteReportDelta
} = loadTypeScriptModule("src/cloud/routeReportCloudData.ts");

const routeRow = (unitId, inCustody = false) => ({
  client_id: "client-1",
  data: {
    clientId: "client-1",
    unitId,
    clientName: "Cliente",
    releaseAmount: 100,
    pendingAmount: 100,
    overdueBalance: 100,
    rentAmount: 100,
    daysLate: 1,
    lastPaymentDate: null,
    publishedAt: "2026-09-14T10:00:00Z",
    routeStartedAt: "2026-09-14T10:00:00Z"
  },
  in_custody: inCustody
});

const inserted = activeRouteDeltaFromPayload({ eventType: "INSERT", new: routeRow("A-1") });
assert.equal(inserted.item.unitId, "A-1");
let items = applyActiveRouteDelta([], inserted);
assert.equal(items.length, 1);
const updated = activeRouteDeltaFromPayload({ eventType: "UPDATE", new: routeRow("A-2", true) });
items = applyActiveRouteDelta(items, updated);
assert.equal(items.length, 1);
assert.equal(items[0].unitId, "A-2");
assert.equal(items[0].inCustody, true);
const removed = activeRouteDeltaFromPayload({ eventType: "DELETE", old: { client_id: "client-1" } });
assert.equal(applyActiveRouteDelta(items, removed).length, 0);
assert.equal(activeRouteDeltaFromPayload({ eventType: "UPDATE", new: { client_id: "client-1" } }), null);

const reportRow = (status, amount = "100.00") => ({
  id: "report-1",
  user_id: "owner-1",
  client_id: "client-1",
  published_at: "2026-09-14T10:00:00Z",
  snapshot: routeRow("A-1").data,
  amount,
  method: "cash",
  status,
  reported_at: "2026-09-14T11:00:00Z"
});
const newReport = routeReportDeltaFromPayload({ eventType: "INSERT", new: reportRow("review") });
let reports = applyRouteReportDelta([], newReport);
assert.equal(reports[0].amount, 100);
assert.equal(reports[0].cash_amount, 100);
const confirmed = routeReportDeltaFromPayload({ eventType: "UPDATE", new: reportRow("confirmed", "110.00") });
reports = applyRouteReportDelta(reports, confirmed);
assert.equal(reports.length, 1);
assert.equal(reports[0].amount, 110);
assert.equal(reports[0].status, "confirmed");
const cancelled = routeReportDeltaFromPayload({ eventType: "UPDATE", new: reportRow("cancelled") });
assert.equal(applyRouteReportDelta(reports, cancelled).length, 0);
assert.equal(routeReportDeltaFromPayload({ eventType: "DELETE", old: { id: "report-1" } }).report, null);

// An event received during an initial fetch must win over the older fetched snapshot.
assert.equal(applyActiveRouteDelta([inserted.item], updated)[0].unitId, "A-2");
assert.equal(applyRouteReportDelta([newReport.report], confirmed)[0].status, "confirmed");
console.log("Deltas de ruta y reportes: altas, cambios, bajas y superposición con carga inicial OK.");
