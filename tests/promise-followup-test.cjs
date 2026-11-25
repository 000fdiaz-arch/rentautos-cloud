const fs = require("node:fs");
const ts = require("typescript");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const exportsObject = {};
vm.runInNewContext(ts.transpile(fs.readFileSync("src/pages/receivablesV2/promiseFollowup.ts", "utf8"), {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020
}), { exports: exportsObject });
const follow = exportsObject.promiseFollowup;
const record = { contactOutcomes: [{ collector: "collector-1", result: "promise", at: "2026-11-16T17:00:00Z",
  date: "2026-11-16", promiseDate: "2026-11-16", promiseTime: "14:00", promiseAmount: 100 }] };
const at = new Date("2026-11-16T19:00:00Z");
assert.equal(follow(record, "collector-1", [], new Date("2026-11-16T18:59:00Z")).overdue, false);
assert.equal(follow(record, "collector-1", [], at).overdue, true);
const partial = [{ id: "1", createdAt: "2026-11-16T18:00:00Z", amountReceived: 40 }];
assert.equal(follow(record, "collector-1", partial, at).remaining, 60);
assert.equal(follow(record, "collector-1", [...partial, ...partial], at).remaining, 60);
assert.equal(follow(record, "collector-1", [{ ...partial[0], amountReceived: 100 }], at).overdue, false);
assert.equal(follow(record, "collector-1", [{ ...partial[0], createdAt: "2026-11-16T16:00:00Z" }], at).remaining, 100);
assert.equal(follow(record, "collector-2", [], at), null);
console.log("PASS promise alerts: Panama deadline, partial/full payments, deduplication, prior-payment exclusion and collector isolation.");

for (const result of ["no_answer", "reported_paid", "escalated"]) {
  const r = { contactOutcomes: [...record.contactOutcomes, { collector: "collector-1", result, at: "2026-11-16T19:01:00Z", followupOf: record.contactOutcomes[0].at, nextContactAt: "2026-11-16T16:00:00-05:00" }] };
  assert.equal(follow(r, "collector-1", [], new Date("2026-11-16T20:59:00Z")).overdue, false);
  assert.equal(follow(r, "collector-1", [], new Date("2026-11-16T21:00:00Z")).overdue, result !== "escalated");
  assert.equal(follow(r, "collector-1", [], at).remaining, 100);
  assert.notEqual(follow(r, "collector-1", [], at).alertKey, follow(record, "collector-1", [], at).alertKey);
  assert.equal(follow(r, "collector-1", [{id:"full",createdAt:"2026-11-16T20:00:00Z",amountReceived:100}], new Date("2026-11-16T21:00:00Z")).overdue, false);
}
console.log("PASS follow-up scheduling, reported payment stays unpaid, escalation and completion.");
