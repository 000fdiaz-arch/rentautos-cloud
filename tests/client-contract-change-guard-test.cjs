const fs = require("node:fs");
const path = require("node:path");
const esbuild = require("esbuild");

const root = path.resolve(__dirname, "..");
const outDir = path.join(root, ".tmp", "tests");
fs.mkdirSync(outDir, { recursive: true });
const bundle = path.join(outDir, "client-contract-change-guard.bundle.cjs");

esbuild.buildSync({
  entryPoints: [path.join(root, "src", "pages", "clients", "clientRules.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: bundle
});

const {
  buildClient,
  calculateIssuedInstallmentsForContract,
  hasContractTermsChanged
} = require(bundle);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const oldDailyContract = {
  id: "client-c36",
  unitId: "C36",
  name: "CLIENTE PRUEBA",
  rentAmount: 37,
  frequency: "daily",
  chargeFirstSunday: false,
  installmentsAgreed: 1098,
  installmentsIssued: 179,
  installmentsIssuedEstimateNeedsReview: false,
  installmentsRemaining: 923,
  installmentsPaid: 175,
  otherCharges: [],
  balance: 0,
  advanceBalance: 0,
  savings: 0,
  createdAt: "2026-07-05T12:00:00.000Z",
  firstChargeDate: "2026-07-05",
  lastChargeDate: "2026-09-08",
  status: "activo"
};

const newBiweeklyForm = {
  unitId: "C36",
  cedula: "",
  name: oldDailyContract.name,
  whatsAppPhone: "",
  firstChargeDate: "2026-07-05",
  rentAmount: "403",
  frequency: "biweekly",
  chargeFirstSunday: false,
  initialBalance: "48",
  travelFundBalance: "0",
  weeklyChargeDay: "monday",
  monthlyChargeDay: "1",
  installmentsAgreed: "85",
  installmentsIssued: "179",
  installmentsRemaining: "73",
  installmentsPaid: "12",
  otherCharges: []
};

assert(hasContractTermsChanged(oldDailyContract, newBiweeklyForm), "Debe detectar el cambio de contrato diario a quincenal.");
assert(calculateIssuedInstallmentsForContract(newBiweeklyForm) === 13, "El contrato nuevo debe partir de 12 pagadas y una cuota con saldo.");

const unsafeCarry = buildClient(newBiweeklyForm, oldDailyContract);
assert(unsafeCarry.installmentsIssued === 179, "Sin confirmacion explicita no se debe borrar el contador anterior.");
assert(unsafeCarry.installmentsIssuedEstimateNeedsReview === true, "El contador 179/85 debe quedar bloqueado para revision.");

const resetContract = buildClient(newBiweeklyForm, oldDailyContract, { resetInstallmentsIssued: true });
assert(resetContract.installmentsIssued === 13, "Al confirmar contrato nuevo debe recalcular las cuotas emitidas.");
assert(resetContract.installmentsIssuedEstimateNeedsReview === false, "El contrato corregido no debe quedar marcado para revision.");

const sameContractForm = { ...newBiweeklyForm, installmentsIssued: "13" };
assert(!hasContractTermsChanged(resetContract, sameContractForm), "Una edicion sin cambios del plan no debe pedir otro reinicio.");

console.log("OK cambio de contrato: detecta el plan nuevo, evita arrastrar 179 cuotas y recalcula 13.");
