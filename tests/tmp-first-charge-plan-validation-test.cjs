const fs = require("node:fs");
const path = require("node:path");
const esbuild = require("esbuild");

const root = path.resolve(__dirname, "..");
const outDir = path.join(root, ".tmp", "tests");
fs.mkdirSync(outDir, { recursive: true });
const bundle = path.join(outDir, "first-charge-plan-validation.bundle.cjs");

esbuild.buildSync({
  entryPoints: [path.join(root, "src", "pages", "clients", "clientRules.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: bundle
});

const {
  clearIncompatibleFirstChargeDate,
  findFirstCompatibleChargeDate,
  getFirstChargeDatePlanError,
  hasBillingScheduleChanged
} = require(bundle);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const dialogSource = fs.readFileSync(path.join(root, "src", "pages", "clients", "ClientFormDialogs.tsx"), "utf8");
assert(dialogSource.includes("clearIncompatibleFirstChargeDate"), "El formulario debe limpiar la fecha al cambiar a un plan incompatible.");
assert(dialogSource.includes("min={minimumDate}"), "El alta debe anclar el calendario en la primera fecha valida.");
assert(dialogSource.includes("step={weeklyStep}"), "El alta semanal debe restringir el calendario en saltos de siete dias.");
assert(dialogSource.includes("Primera letra:"), "El formulario debe confirmar visualmente la fecha de la primera letra.");

const base = {
  unitId: "D15",
  cedula: "",
  name: "CLIENTE PRUEBA",
  whatsAppPhone: "",
  firstChargeDate: "2026-10-13",
  rentAmount: "204",
  frequency: "weekly",
  chargeFirstSunday: false,
  initialBalance: "0",
  travelFundBalance: "0",
  weeklyChargeDay: "tuesday",
  monthlyChargeDay: "1",
  installmentsAgreed: "183",
  installmentsIssued: "0",
  installmentsRemaining: "183",
  installmentsPaid: "0",
  otherCharges: []
};

assert(getFirstChargeDatePlanError(base) === null, "El martes 13 debe ser valido para un plan semanal de martes.");
assert(
  /lunes/.test(getFirstChargeDatePlanError({ ...base, weeklyChargeDay: "monday" }) ?? ""),
  "El martes 13 debe rechazarse cuando el plan semanal cobra lunes."
);

const cleared = clearIncompatibleFirstChargeDate(base, { weeklyChargeDay: "monday" });
assert(cleared.firstChargeDate === "", "Cambiar el dia semanal debe limpiar una fecha incompatible.");
assert(
  findFirstCompatibleChargeDate({ ...base, weeklyChargeDay: "monday" }, "2026-10-18") === "2026-10-19",
  "La proxima fecha semanal valida debe ser el lunes 19."
);

assert(getFirstChargeDatePlanError({ ...base, frequency: "daily", firstChargeDate: "2026-10-18" }) !== null, "Diario no debe aceptar domingo sin habilitarlo.");
assert(getFirstChargeDatePlanError({ ...base, frequency: "daily", firstChargeDate: "2026-10-18", chargeFirstSunday: true }) === null, "Diario debe aceptar el primer domingo habilitado.");

assert(getFirstChargeDatePlanError({ ...base, frequency: "biweekly", firstChargeDate: "2026-10-15" }) === null, "Quincenal debe aceptar dia 15.");
assert(getFirstChargeDatePlanError({ ...base, frequency: "biweekly", firstChargeDate: "2026-10-30" }) === null, "Quincenal debe aceptar dia 30.");
assert(getFirstChargeDatePlanError({ ...base, frequency: "biweekly", firstChargeDate: "2027-02-28" }) === null, "Quincenal debe aceptar el ultimo dia de febrero.");
assert(getFirstChargeDatePlanError({ ...base, frequency: "biweekly", firstChargeDate: "2026-10-17" }) !== null, "Quincenal debe rechazar dia 17.");

assert(getFirstChargeDatePlanError({ ...base, frequency: "monthly", monthlyChargeDay: "18", firstChargeDate: "2026-10-18" }) !== null, "Mensual debe rechazar el domingo nominal cuando se mueve al lunes.");
assert(getFirstChargeDatePlanError({ ...base, frequency: "monthly", monthlyChargeDay: "18", firstChargeDate: "2026-10-19" }) === null, "Mensual debe aceptar el lunes posterior al domingo nominal.");

const existing = {
  id: "client-d15",
  unitId: "D15",
  name: base.name,
  rentAmount: 204,
  frequency: "weekly",
  weeklyChargeDay: "monday",
  chargeFirstSunday: false,
  installmentsAgreed: 183,
  installmentsRemaining: 183,
  installmentsPaid: 0,
  otherCharges: [],
  balance: 0,
  advanceBalance: 0,
  savings: 0,
  createdAt: "2026-10-06T15:20:23.340Z",
  firstChargeDate: "2026-10-13",
  lastChargeDate: "2026-10-17",
  status: "activo"
};
assert(
  !hasBillingScheduleChanged(existing, { ...base, weeklyChargeDay: "monday" }),
  "Una inconsistencia historica sin cambios de calendario debe poder editarse sin bloquear otros datos."
);

console.log("OK primer cobro: semanal, diario, quincenal y mensual bloquean fechas incompatibles sin cerrar ediciones historicas.");
