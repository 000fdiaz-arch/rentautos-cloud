const fs = require("node:fs");
const path = require("node:path");
const esbuild = require("esbuild");

const root = path.resolve(__dirname, "..");
const outDir = path.join(root, ".tmp", "tests");
fs.mkdirSync(outDir, { recursive: true });
const bundle = path.join(outDir, "installment-issuance-cap.bundle.cjs");

esbuild.buildSync({
  entryPoints: [path.join(root, "src", "billing.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: bundle
});

const {
  applyAutomaticCharges,
  findNextChargeDay,
  resolveInstallmentIssuance,
  withResolvedInstallmentIssuance
} = require(bundle);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function monday(year, monthIndex, day) {
  return new Date(year, monthIndex, day, 12, 0, 0);
}

let client = {
  id: "weekly-4x50",
  unitId: "T01",
  name: "PRUEBA CUATRO CUOTAS",
  rentAmount: 50,
  frequency: "weekly",
  weeklyChargeDay: "monday",
  installmentsAgreed: 4,
  installmentsIssued: 0,
  installmentsIssuedEstimateNeedsReview: false,
  installmentsRemaining: 4,
  installmentsPaid: 0,
  otherCharges: [],
  balance: 0,
  advanceBalance: 0,
  savings: 0,
  createdAt: "2026-08-09T12:00:00.000Z",
  firstChargeDate: "2026-08-10",
  lastChargeDate: "2026-08-09",
  status: "activo"
};

for (const day of [10, 17, 24, 31]) {
  client = applyAutomaticCharges([client], monday(2026, 7, day)).clients[0];
  client = { ...client, balance: client.balance - 10 };
}

assert(client.installmentsIssued === 4, `Deben existir 4 cuotas emitidas; recibido ${client.installmentsIssued}.`);
assert(client.balance === 160, `El saldo al 31 de agosto debe ser 160; recibido ${client.balance}.`);

const afterSeptember7 = applyAutomaticCharges([client], monday(2026, 8, 7)).clients[0];
assert(afterSeptember7.balance === 160, `El 7 de septiembre no debe aumentar el saldo; recibido ${afterSeptember7.balance}.`);
assert(afterSeptember7.installmentsIssued === 4, "El contador emitido no debe superar las cuotas pactadas.");
assert(findNextChargeDay(afterSeptember7, monday(2026, 8, 7)) === null, "Un contrato completamente emitido no debe anunciar otro cobro.");

const legacy = { ...client };
delete legacy.installmentsIssued;
delete legacy.installmentsIssuedEstimateNeedsReview;
const balanceBeforeMigration = legacy.balance;
const migrated = withResolvedInstallmentIssuance(legacy);
assert(migrated.balance === balanceBeforeMigration, "La estimación legacy no puede modificar el balance.");
assert(migrated.installmentsIssued === 4, `La estimación por fechas debe producir 4; recibido ${migrated.installmentsIssued}.`);
assert(migrated.installmentsIssuedEstimateNeedsReview === false, "Fechas completas no deben marcarse como dudosas.");

const incompleteLegacy = { ...legacy, firstChargeDate: undefined, lastChargeDate: undefined };
const incompleteBalanceBefore = incompleteLegacy.balance;
const incompleteIssuance = resolveInstallmentIssuance(incompleteLegacy);
assert(incompleteLegacy.balance === incompleteBalanceBefore, "La estimación incompleta tampoco puede tocar el balance.");
assert(incompleteIssuance.needsReview === true, "Los datos sin fechas deben quedar marcados para revisión.");
assert(findNextChargeDay(incompleteLegacy, monday(2026, 8, 7)) === null, "La estimación legacy completa también debe frenar la próxima fecha.");

const prepaidLegacy = {
  ...incompleteLegacy,
  balance: 0,
  advanceBalance: 200,
  installmentsPaid: 4
};
const prepaidIssuance = resolveInstallmentIssuance(prepaidLegacy);
assert(prepaidIssuance.issued === 0, "Un adelanto sin fechas no debe confundirse con cuotas ya emitidas.");
assert(findNextChargeDay(prepaidLegacy, monday(2026, 8, 7)) === null, "Un contrato totalmente prepagado no debe anunciar una cuota fuera del contrato.");

const expanded = applyAutomaticCharges([{ ...afterSeptember7, installmentsAgreed: 5 }], monday(2026, 8, 14)).clients[0];
assert(expanded.balance === 210 && expanded.installmentsIssued === 5, "Aumentar a 5 cuotas debe permitir exactamente un nuevo cobro.");

const reduced = applyAutomaticCharges([{ ...expanded, installmentsAgreed: 3 }], monday(2026, 8, 21)).clients[0];
assert(reduced.balance === 210 && reduced.installmentsIssued === 5, "Reducir lo pactado no debe borrar emisiones ni alterar el saldo.");

console.log("OK installment issuance cap: límite contractual, migración sin balances y cambios de contrato.");
