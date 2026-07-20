const fs = require("node:fs");
const path = require("node:path");
const esbuild = require("esbuild");

const root = path.resolve(__dirname, "..");
const outDir = path.join(root, ".tmp", "tests");
const outFile = path.join(outDir, "paymentStorage.bundle.cjs");
fs.mkdirSync(outDir, { recursive: true });

esbuild.buildSync({
  entryPoints: [path.join(root, "src", "pages", "payments", "paymentStorage.ts")],
  bundle: true,
  platform: "browser",
  format: "cjs",
  outfile: outFile
});

const store = new Map();
global.localStorage = {
  getItem: (key) => store.get(key) ?? null,
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
  clear: () => store.clear()
};

const { loadChargeRuns, saveChargeRuns } = require(outFile);

const run = {
  id: "run-close-001",
  closingDate: "2026-07-17",
  targetDate: "2026-07-18",
  expectedClients: 1,
  chargedClients: 1,
  anomalyClients: 0,
  chargedTotal: 30,
  createdAt: "2026-07-17T22:00:00.000Z",
  status: "completed",
  lateFeeEntryIds: ["fee-001"],
  clientSnapshots: [
    {
      clientId: "client-001",
      unitId: "A01",
      name: "CLIENTE PRUEBA",
      before: {
        balance: 0,
        advanceBalance: 30,
        lastChargeDate: "2026-07-17",
        firstSundayChargedAt: undefined,
        otherCharges: []
      },
      after: {
        balance: 0,
        advanceBalance: 0,
        lastChargeDate: "2026-07-18",
        firstSundayChargedAt: undefined,
        otherCharges: []
      }
    }
  ]
};

saveChargeRuns([run]);
const loaded = loadChargeRuns();

if (loaded.length !== 1) throw new Error(`Esperado 1 chargeRun, recibido ${loaded.length}`);
if (loaded[0].status !== "completed") throw new Error("No se preservo status completed.");
if (loaded[0].lateFeeEntryIds?.[0] !== "fee-001") throw new Error("No se preservo lateFeeEntryIds.");
if (loaded[0].clientSnapshots?.[0]?.before.advanceBalance !== 30) throw new Error("No se preservo snapshot.before.advanceBalance.");
if (loaded[0].clientSnapshots?.[0]?.after.lastChargeDate !== "2026-07-18") throw new Error("No se preservo snapshot.after.lastChargeDate.");

console.log("OK cash closing snapshot storage: chargeRuns conserva datos reversibles.");
