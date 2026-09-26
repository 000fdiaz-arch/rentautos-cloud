import assert from "node:assert/strict";
import { calculateLeadAgeExtraDeposit } from "../src/leadAgeRules.ts";

const expectedScale = new Map([
  [27, 100],
  [26, 200],
  [25, 300],
  [24, 400],
  [23, 500],
  [22, 600],
  [21, 700],
  [20, 800],
  [19, 900],
  [18, 1000]
]);

for (const [age, expectedDeposit] of expectedScale) {
  assert.equal(calculateLeadAgeExtraDeposit(age), expectedDeposit);
}

assert.equal(calculateLeadAgeExtraDeposit(28), 0);
assert.equal(calculateLeadAgeExtraDeposit(17), 1100);
assert.equal(calculateLeadAgeExtraDeposit(null), 0);

console.log("OK escala de abono extra por edad");
