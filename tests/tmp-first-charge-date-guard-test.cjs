const fs = require("node:fs");
const path = require("node:path");
const esbuild = require("esbuild");

const root = path.resolve(__dirname, "..");
const outDir = path.join(root, ".tmp", "tests");
fs.mkdirSync(outDir, { recursive: true });

const billingBundle = path.join(outDir, "billing-first-charge-guard.bundle.cjs");
const clientRulesBundle = path.join(outDir, "clientRules-first-charge-guard.bundle.cjs");

esbuild.buildSync({
  entryPoints: [path.join(root, "src", "billing.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: billingBundle
});

esbuild.buildSync({
  entryPoints: [path.join(root, "src", "pages", "clients", "clientRules.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: clientRulesBundle
});

const { isBeforeFirstChargeDate } = require(billingBundle);
const { buildClient } = require(clientRulesBundle);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const client = {
  id: "client-001",
  unitId: "D82",
  name: "CLIENTE PRUEBA",
  rentAmount: 198,
  frequency: "weekly",
  weeklyChargeDay: "friday",
  installmentsAgreed: 180,
  installmentsRemaining: 180,
  installmentsPaid: 0,
  otherCharges: [],
  balance: 0,
  advanceBalance: 0,
  savings: 0,
  createdAt: "2026-08-07T01:47:44.206Z",
  firstChargeDate: "2026-08-14",
  lastChargeDate: "2026-08-05",
  status: "activo"
};

assert(
  isBeforeFirstChargeDate(client, new Date(2026, 7, 7)),
  "El cobro objetivo 2026-08-07 debe considerarse antes del primer cobro 2026-08-14."
);
assert(
  !isBeforeFirstChargeDate(client, new Date(2026, 7, 14)),
  "El dia de primer cobro 2026-08-14 ya debe permitir cobro."
);

const edited = buildClient({
  unitId: client.unitId,
  cedula: "",
  name: client.name,
  whatsAppPhone: "",
  firstChargeDate: "2026-08-21",
  rentAmount: String(client.rentAmount),
  frequency: "weekly",
  chargeFirstSunday: false,
  initialBalance: "0",
  travelFundBalance: "0",
  weeklyChargeDay: "friday",
  monthlyChargeDay: "1",
  installmentsAgreed: "180",
  installmentsRemaining: "180",
  installmentsPaid: "0",
  otherCharges: []
}, client);

assert(
  edited.lastChargeDate === "2026-08-20",
  `Al cambiar fecha primer cobro, lastChargeDate debe ser 2026-08-20; recibido ${edited.lastChargeDate}.`
);

console.log("OK first charge date guard: no cobrar antes de fecha inicial y recalcular lastChargeDate.");
