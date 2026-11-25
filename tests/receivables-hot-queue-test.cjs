const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const source = fs.readFileSync("src/pages/receivablesV2/ReceivablesLedgerTable.tsx", "utf8");
const body = require("typescript").transpile("(() => {" + source.match(/onClick=\{\(\) => \{\s*(onPersistPendingChanges\(\);[\s\S]*?)\}\}/)[1] + "})()", { target: 9 });
const state = {
  hotClientId: null, automaticFollowup: false, shownPromises: [],
  dueFollowups: [{ row: { id: "A03" }, followup: { promise: { at: "promise-1" } } }],
  visibleRow: { id: "A10" }, currentRowIndex: 9, roundRows: Array(20),
  retryIds: null, pendingIds: [],
  onPersistPendingChanges() {},
  setHotClientId(id) { state.hotClientId = id; },
  setAutomaticFollowup(value) { state.automaticFollowup = value; },
  setShownPromises(update) { state.shownPromises = update(state.shownPromises); },
  changeSelectedRow(index) { state.currentRowIndex = index; },
  setRetryIds() {}, setSelectedRowIndex() {}, setRoundFinished() {}
};
vm.runInNewContext(body, state);
assert.equal(state.hotClientId, "A03");
assert.equal(state.currentRowIndex, 9, "Do not lose portfolio position");
vm.runInNewContext(body, state);
assert.equal(state.hotClientId, null);
assert.equal(state.currentRowIndex, 10, "Resume next portfolio unit");
vm.runInNewContext(body, state);
assert.equal(state.hotClientId, null, "Do not loop the same promise");
assert.equal(state.currentRowIndex, 11);
console.log("PASS: overdue unit on Next, preserved position, resume and no repeated loop.");
