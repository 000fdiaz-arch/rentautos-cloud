const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const source = fs.readFileSync(path.resolve(__dirname, "../src/pages/incidents/insurancePaymentMatching.ts"), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText;
const runtimeModule = { exports: {} };
new Function("exports", "module", compiled)(runtimeModule.exports, runtimeModule);
const { buildInsurancePaymentClaimSuggestions } = runtimeModule.exports;

const payment = {
  id: "BG-984521",
  status: "pending",
  forwardedAt: "2026-10-24T12:00:00.000Z",
  updatedAt: "2026-10-24T12:00:00.000Z",
  bankItem: {
    folio: "BG-984521",
    dateApplied: "2026-10-24",
    amountReceived: 3250,
    capitalPart: 3250,
    centsPart: 0,
    referenceId: "784512",
    extractedName: "ASEGURADORA MUNDIAL",
    description: "INDEM. RECLAMO 784512 AUTO 024 PLACA 890214",
    importedAt: "2026-10-24T12:00:00.000Z"
  }
};

const claim = (overrides) => ({
  id: "claim-024",
  incidentDate: "2026-10-02",
  unit: "024",
  driver: "LAURA GOMEZ",
  plate: "890214",
  insurer: "ASEGURADORA MUNDIAL",
  hasClaimNumber: true,
  claimNumber: "784512",
  amount: "3250.00",
  vehicleDamage: "",
  status: "Activo",
  damagePhotoNames: [], damagePhotos: [], settlementDelivered: false,
  settlementDeliveredDate: "", settlementMarkedAt: null, settlementAttachment: null,
  followUpComment: "", followUpCommentUpdatedAt: null, followUps: [], closureOutcome: null,
  closureJustification: "", finalizedAt: null, editHistory: [],
  createdAt: "2026-10-02T12:00:00.000Z", updatedAt: "2026-10-20T12:00:00.000Z",
  ...overrides
});

const suggestions = buildInsurancePaymentClaimSuggestions(payment, [
  claim({ id: "wrong", unit: "118", plate: "123456", insurer: "OTRA", claimNumber: "111111", amount: "210" }),
  claim({})
]);

assert.equal(suggestions[0].claim.id, "claim-024");
assert.equal(suggestions[0].confidence, "high");
assert.ok(suggestions[0].reasons.some((reason) => reason.includes("784512")), "debe explicar la coincidencia del reclamo");
assert.ok(suggestions[0].reasons.some((reason) => reason.includes("monto")), "debe explicar la coincidencia del monto");
assert.ok(suggestions[0].score > suggestions[1].score, "el expediente exacto debe quedar primero");
assert.deepEqual(
  suggestions.map((suggestion) => suggestion.score),
  suggestions.map((suggestion) => suggestion.score).sort((left, right) => right - left),
  "las sugerencias deben ordenarse de mayor a menor similitud"
);

const claimTwentyPayment = {
  ...payment,
  bankItem: { ...payment.bankItem, description: "CR ACH SEGUROS FE Pago de Reclamo No 20", referenceId: "" }
};
const claimNumberSuggestions = buildInsurancePaymentClaimSuggestions(claimTwentyPayment, [
  claim({ id: "placeholder-zero", claimNumber: "0", insurer: "ACERTA", amount: "" }),
  claim({ id: "claim-twenty", claimNumber: "20", insurer: "OTRA", amount: "3250.00" })
]);
assert.equal(claimNumberSuggestions[0].claim.id, "claim-twenty", "Reclamo No 20 debe coincidir con 20, nunca con el placeholder 0");
assert.ok(!claimNumberSuggestions.some((item) => item.claim.id === "placeholder-zero" && item.reasons.some((reason) => reason.includes("número"))));

const companySuggestions = buildInsurancePaymentClaimSuggestions({
  ...payment,
  bankItem: {
    ...payment.bankItem,
    mappedGroup: "A",
    amountReceived: 749.8,
    description: "PAGO DE SEGUROS",
    referenceId: ""
  }
}, [
  claim({ id: "wrong-company", unit: "T23", claimNumber: "T-999", insurer: "", amount: "749.80" }),
  claim({ id: "right-company", unit: "A06", claimNumber: "A-123", insurer: "", amount: "749.80" }),
  claim({ id: "no-claim-number", unit: "A07", claimNumber: "", hasClaimNumber: false, insurer: "", amount: "749.80" }),
  claim({ id: "no-claim-amount", unit: "A08", claimNumber: "A-456", insurer: "", amount: "" })
], {
  companyByUnit: new Map([["A06", "GEDLERCARS S.A."], ["T23", "VISION CAR S.A."]]),
  companyByGroup: new Map([["A", "GEDLERCARS S.A."], ["T", "VISION CAR S.A."]])
});
assert.equal(companySuggestions.length, 1, "las sugerencias no deben mezclar expedientes de otras empresas/grupos");
assert.equal(companySuggestions[0].claim.id, "right-company");
assert.ok(!companySuggestions.some((item) => item.claim.id === "no-claim-number"), "un expediente sin número no debe sugerirse");
assert.ok(!companySuggestions.some((item) => item.claim.id === "no-claim-amount"), "un expediente sin monto no debe sugerirse");
assert.ok(companySuggestions[0].reasons.some((reason) => reason.includes("GEDLERCARS")), "debe explicar la coincidencia de empresa");
assert.ok(companySuggestions[0].reasons.some((reason) => reason.includes("monto")), "debe comparar también el monto");

console.log("OK sugerencias de seguros: priorizan reclamo, monto, aseguradora, unidad y placa.");
