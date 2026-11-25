const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const source = ts.createSourceFile("AppShell.tsx", fs.readFileSync("src/AppShell.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let backupFunction;
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "buildBackupExtraData") backupFunction = node;
  ts.forEachChild(node, visit);
}
visit(source);
assert.ok(backupFunction);
const code = ts.transpile(backupFunction.getText(source), { target: ts.ScriptTarget.ES2022 });

(async () => {
  for (const count of [0, 2501]) {
    const audit = Array.from({ length: count }, (_, id) => ({ id: String(id), folio: String(id), createdAt: "2026-11-24T12:00:00Z" }));
    let cloudReads = 0;
    const context = {
      cloudDataUserId: "current-owner", isSupabaseOnlyMode: true,
      async loadCloudManualAssignmentAudit(owner) { assert.equal(owner, "current-owner"); cloudReads++; return audit; },
      async loadManualBankAssignmentAuditFromIndexedDb() { throw Error("Backup cannot depend on unfinished audit hydration"); },
      loadManualBankAssignmentAudit() { throw Error("Empty cloud audit must not restore another owner's stale local data"); },
      async loadPendingBankItemsFromIndexedDb() { return []; }, loadPendingBankItems() { return []; },
      async loadControlUnits() { return []; }, async loadCloudChargeRunsWithDetails() { return []; },
      async loadCloudLeadEvaluations() { return []; },
      localStorage: { getItem() { return null; } }, parseLocalJson(_key, fallback) { return fallback; },
      leadEvaluations: [], console
    };
    vm.runInNewContext(code, context);
    const result = await context.buildBackupExtraData();
    assert.equal(cloudReads, 1);
    assert.equal(result.manualAssignmentAudit, audit, "Backup includes the entire canonical audit, including histories longer than 2000 rows");
  }
  console.log("PASS backups read the complete owner audit directly from cloud; empty cloud data never falls back to a stale local audit.");
})().catch(error => { console.error(error); process.exitCode = 1; });
