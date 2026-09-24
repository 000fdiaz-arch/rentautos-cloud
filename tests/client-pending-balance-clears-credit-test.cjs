const fs = require("node:fs");
const path = require("node:path");
const esbuild = require("esbuild");

const root = path.resolve(__dirname, "..");
const outDir = path.join(root, ".tmp", "tests");
fs.mkdirSync(outDir, { recursive: true });

const bundle = path.join(outDir, "client-pending-balance-clears-credit.bundle.cjs");
esbuild.buildSync({
  entryPoints: [path.join(root, "src", "pages", "clients", "clientRules.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: bundle
});

const { buildClient } = require(bundle);

const existing = {
  id: "client-t31",
  unitId: "T31",
  name: "CLIENTE PRUEBA",
  rentAmount: 214,
  frequency: "weekly",
  weeklyChargeDay: "wednesday",
  installmentsAgreed: 100,
  installmentsRemaining: 90,
  installmentsPaid: 10,
  otherCharges: [],
  balance: 0,
  advanceBalance: 250,
  savings: 0,
  createdAt: "2026-09-01T12:00:00.000Z",
  firstChargeDate: "2026-09-02",
  lastChargeDate: "2026-09-15",
  status: "activo"
};

function form(initialBalance) {
  return {
    unitId: existing.unitId,
    cedula: "",
    name: existing.name,
    whatsAppPhone: "",
    firstChargeDate: existing.firstChargeDate,
    rentAmount: String(existing.rentAmount),
    frequency: existing.frequency,
    chargeFirstSunday: false,
    initialBalance,
    travelFundBalance: "0",
    weeklyChargeDay: existing.weeklyChargeDay,
    monthlyChargeDay: "1",
    installmentsAgreed: "100",
    installmentsIssued: "10",
    installmentsRemaining: "90",
    installmentsPaid: "10",
    otherCharges: []
  };
}

const withPendingBalance = buildClient(form("150"), existing);
if (withPendingBalance.advanceBalance !== 0) {
  throw new Error(`Un saldo pendiente debe anular el saldo a favor; recibido ${withPendingBalance.advanceBalance}.`);
}

const withoutPendingBalance = buildClient(form("0"), existing);
if (withoutPendingBalance.advanceBalance !== 250) {
  throw new Error(`Sin saldo pendiente debe conservarse el saldo a favor; recibido ${withoutPendingBalance.advanceBalance}.`);
}

console.log("OK pending balance clears existing credit.");
