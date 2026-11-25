const fs = require("node:fs");
const ts = require("typescript");
const vm = require("node:vm");
const assert = require("node:assert/strict");

function extract(file, name) {
  const source = fs.readFileSync(file, "utf8");
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name.text === name);
  assert.ok(fn, name);
  return ts.transpile(fn.getText(ast), { target: ts.ScriptTarget.ES2022 });
}

const context = vm.createContext({
  recordOrNull: value => value && typeof value === "object" ? value : null,
  toIsoTimestamp: value => Date.parse(value) || 0
});
vm.runInContext(extract("src/cloud/operationsCloudDataV2.ts", "mergeStreetManagementRow"), context);
const attempt = (result, at, collector = "collector-1", date = "2026-11-16") => ({ result, at, collector, date });
const first = attempt("no_answer", "2026-11-16T15:00:00Z");
const second = attempt("promise", "2026-11-16T16:00:00Z");
const current = { status: "pending", contactOutcomes: [first] };
const merged = context.mergeStreetManagementRow(current, { status: "pending", contactOutcomes: [first, second] });
assert.equal(merged.contactOutcomes.length, 2, "Merge must deduplicate attempts");
assert.equal(context.mergeStreetManagementRow(merged, { status: "pending" }).contactOutcomes.length, 2,
  "Unrelated saves must preserve attempts");

const ledger = fs.readFileSync("src/pages/receivablesV2/ReceivablesLedgerTable.tsx", "utf8");
vm.runInContext(extract("src/pages/receivablesV2/workdayProgress.ts", "latestContact").replace(/^export /, ""), context);
const expression = ledger.match(/const pendingIds = ([\s\S]*?);/)[1];
function pending(records, collector = "collector-1") {
  return Array.from(vm.runInNewContext(expression, {
    openRows: Object.keys(records).map(id => ({ id })), latestContact: context.latestContact,
    collectionStatusByClient: records, todayDateKey: "2026-11-16", collectorKey: collector
  }));
}
assert.deepEqual(pending({ A: current, B: merged }), ["A"]);
assert.deepEqual(pending({ A: { contactOutcomes: [attempt("no_answer", first.at, "collector-2")] } }), []);
assert.deepEqual(pending({ A: { contactOutcomes: [attempt("no_answer", first.at, "collector-1", "2026-11-15")] } }), []);

// Navigation transitions are covered by receivables-workday-progress.cjs.

async function main() {
  const { PGlite } = await import("../.tmp/lead-portal-tests/node_modules/@electric-sql/pglite/dist/index.js");
  const db = new PGlite();
  try {
    await db.exec("create table street_management_items_cloud(user_id uuid, client_id text, data jsonb, primary key(user_id,client_id))");
    const owner = "11111111-1111-4111-8111-111111111111";
    await db.query("insert into street_management_items_cloud values($1,$2,$3)", [owner, "A", current]);
    let saved = (await db.query("select data from street_management_items_cloud")).rows[0].data;
    assert.deepEqual(saved.contactOutcomes, [first]);
    assert.deepEqual(pending({ A: saved }), ["A"], "Reloaded no-answer must enter second round");
    await db.query("update street_management_items_cloud set data=$1", [merged]);
    saved = (await db.query("select data from street_management_items_cloud")).rows[0].data;
    assert.equal(saved.contactOutcomes.length, 2);
    assert.deepEqual(pending({ A: saved }), [], "Resolved client must leave pending list");
    console.log("PASS: JSONB write/read, attempt merge, second-round selection, resolution, collector/day isolation");
  } finally { await db.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
