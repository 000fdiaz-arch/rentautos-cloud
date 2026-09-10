import assert from "node:assert/strict";
import esbuild from "esbuild";

const bundle = await esbuild.build({
  entryPoints: ["src/pages/payments/pendingBankRules.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false
});
const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`;
const { getPendingSimilaritySignals } = await import(moduleUrl);

const client = (id, unitId, name, cedula = "") => ({
  id,
  unitId,
  name,
  cedula,
  status: "active",
  balance: 100,
  savings: 0,
  rentAmount: 20,
  frequency: "daily",
  installmentsRemaining: 5,
  installmentsPaid: 0,
  installmentsAgreed: 5
});
const pending = (overrides = {}) => ({
  folio: "F-1",
  dateApplied: "2026-09-10",
  amountReceived: 204,
  capitalPart: 204,
  centsPart: 0,
  referenceId: "",
  extractedName: "LUIS PALASIO MOSQUERA",
  description: "CR TRAN ACH XPRESS-LUIS PALASIO MOSQUERA",
  importedAt: "2026-09-10T17:00:00.000Z",
  mappedGroup: "C",
  suggestedClientId: "client-luis",
  suggestedClientName: "LUIS PALASIO MOSQUERA",
  ...overrides
});

const luis = client("client-luis", "C05", "LUIS PALASIO MOSQUERA");
const other = client("client-other", "C06", "OTRA PERSONA");

const exactName = getPendingSimilaritySignals(pending(), [], [luis, other]);
assert.equal(exactName.score, 1, "Sin centavos ni aviso conserva su puntuacion historica.");
assert.equal(exactName.exacto, true);
assert.equal(exactName.aplicable, true, "El nombre exacto y unico debe habilitar el pago .00 en lote.");

const exactUnit = getPendingSimilaritySignals(
  pending({ referenceId: "C05", extractedName: "", description: "CR ACH-C05" }),
  [],
  [luis, other]
);
assert.equal(exactUnit.aplicable, true, "La unidad exacta y unica debe habilitar el pago .00.");

const prefixOnly = getPendingSimilaritySignals(
  pending({ extractedName: "LUIS PALASIO", description: "CR ACH-LUIS PALASIO" }),
  [],
  [luis, other]
);
assert.equal(prefixOnly.exacto, false);
assert.equal(prefixOnly.aplicable, false, "Una coincidencia parcial sin centavos debe esperar revision manual.");

const duplicate = client("client-duplicate", "C07", "LUIS PALASIO MOSQUERA");
const ambiguous = getPendingSimilaritySignals(pending(), [], [luis, duplicate, other]);
assert.equal(ambiguous.exacto, false);
assert.equal(ambiguous.aplicable, false, "Un nombre exacto duplicado no debe aplicarse automaticamente.");

console.log("OK pagos .00: solo coincidencias exactas y unicas entran al lote automatico.");

