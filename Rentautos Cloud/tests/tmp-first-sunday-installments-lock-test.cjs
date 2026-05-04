const fs = require("fs");
const path = require("path");
const os = require("os");
const ts = require("typescript");

const ROOT = path.resolve(__dirname, "..");
const TMP_DIR = path.join(os.tmpdir(), `first-sunday-installments-test-${Date.now()}`);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function buildClient(installmentsPaid) {
  return {
    id: "c-test",
    unitId: "A54",
    name: "CLIENTE TEST",
    rentAmount: 33,
    frequency: "daily",
    chargeFirstSunday: true,
    firstSundayChargedAt: undefined,
    installmentsAgreed: 100,
    installmentsRemaining: 100 - installmentsPaid,
    installmentsPaid,
    otherCharges: [],
    balance: 0,
    advanceBalance: 0,
    savings: 0,
    createdAt: "2026-04-30T08:00:00.000Z",
    lastChargeDate: "2026-05-02",
    status: "active"
  };
}

(async () => {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  const billingTs = fs.readFileSync(path.join(ROOT, "src", "billing.ts"), "utf8");
  const billingJs = ts.transpileModule(billingTs, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true
    }
  }).outputText;
  const bundlePath = path.join(TMP_DIR, "billing.js");
  fs.writeFileSync(bundlePath, billingJs, "utf8");

  const { applyAutomaticCharges, isChargeDay } = require(bundlePath);

  const sunday = new Date("2026-05-03T10:00:00");

  const c6 = buildClient(6);
  assert(isChargeDay(c6, sunday) === true, "Con 6 cuotas pagadas, primer domingo debe cobrar");
  const run6 = applyAutomaticCharges([c6], sunday).clients[0];
  assert(run6.balance === 33, `Con 6 cuotas pagadas, balance esperado 33, recibido ${run6.balance}`);

  const c7 = buildClient(7);
  assert(isChargeDay(c7, sunday) === false, "Con 7 cuotas pagadas, domingo no debe cobrar");
  const run7 = applyAutomaticCharges([c7], sunday).clients[0];
  assert(run7.balance === 0, `Con 7 cuotas pagadas, balance esperado 0, recibido ${run7.balance}`);

  console.log("OK sunday lock by installmentsPaid>=7.");
})()
  .catch((error) => {
    console.error("FALLO TEST SUNDAY LOCK:", error && error.message ? error.message : error);
    process.exit(1);
  })
  .finally(() => {
    try {
      if (fs.existsSync(TMP_DIR)) fs.rmSync(TMP_DIR, { recursive: true, force: true });
    } catch {
      // noop
    }
  });
