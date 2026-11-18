import assert from "node:assert/strict";
import { calculateLeadAgeExtraDeposit } from "../src/leadAgeRules.ts";

const expectedScale = new Map([
  [26, 100],
  [25, 200],
  [24, 300],
  [23, 400],
  [22, 500],
  [21, 600],
  [20, 700],
  [19, 800],
  [18, 900]
]);

for (const [age, expectedDeposit] of expectedScale) {
  assert.equal(calculateLeadAgeExtraDeposit(age), expectedDeposit);
}

assert.equal(calculateLeadAgeExtraDeposit(27), 0);
assert.equal(calculateLeadAgeExtraDeposit(28), 0);
assert.equal(calculateLeadAgeExtraDeposit(17), 1000);
assert.equal(calculateLeadAgeExtraDeposit(null), 0);

console.log("OK escala de abono extra por edad");
