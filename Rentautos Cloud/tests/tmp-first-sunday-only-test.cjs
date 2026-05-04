const fs = require("fs");
const path = require("path");
const os = require("os");
const ts = require("typescript");

const ROOT = path.resolve(__dirname, "..");
const TMP_DIR = path.join(os.tmpdir(), `first-sunday-test-${Date.now()}`);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function makeDailyClient() {
  return {
    id: "c-a54-test",
    unitId: "A54",
    name: "CLIENTE TEST",
    rentAmount: 33,
    frequency: "daily",
    chargeFirstSunday: true,
    firstSundayChargedAt: undefined,
    installmentsAgreed: 100,
    installmentsRemaining: 94,
    installmentsPaid: 6,
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
  const compilerOptions = {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    esModuleInterop: true
  };
  const billingJs = ts.transpileModule(billingTs, { compilerOptions }).outputText;
  const bundlePath = path.join(TMP_DIR, "billing.js");
  fs.writeFileSync(bundlePath, billingJs, "utf8");

  const { applyAutomaticCharges } = require(bundlePath);

  // Caso 1: Primer domingo del mes -> SI cobra una vez
  let client = makeDailyClient();
  let run = applyAutomaticCharges([client], new Date("2026-05-03T10:00:00")); // domingo
  client = run.clients[0];
  assert(client.balance === 33, `Caso 1: balance esperado 33, recibido ${client.balance}`);
  assert(client.firstSundayChargedAt === "2026-05-03", `Caso 1: firstSundayChargedAt esperado 2026-05-03, recibido ${client.firstSundayChargedAt}`);

  // Caso 2: Siguiente domingo del mismo mes -> NO vuelve a cobrar domingo
  // Avanzamos hasta 2026-05-10 (incluye cobros lun-sab = 6 dias = 198)
  run = applyAutomaticCharges([client], new Date("2026-05-10T10:00:00")); // domingo
  client = run.clients[0];
  assert(client.balance === 231, `Caso 2: balance esperado 231 (33 + 6*33), recibido ${client.balance}`);
  assert(client.firstSundayChargedAt === "2026-05-03", `Caso 2: firstSundayChargedAt debe mantenerse en 2026-05-03, recibido ${client.firstSundayChargedAt}`);

  // Caso 3: Primer domingo del siguiente mes -> NO debe cobrar nuevamente
  // Desde 2026-05-10 hasta 2026-06-07 hay 24 dias laborables lun-sab (24*33=792), domingos no se cobran
  run = applyAutomaticCharges([client], new Date("2026-06-07T10:00:00")); // domingo
  client = run.clients[0];
  assert(client.balance === 1023, `Caso 3: balance esperado 1023 (231 + 24*33), recibido ${client.balance}`);
  assert(client.firstSundayChargedAt === "2026-05-03", `Caso 3: firstSundayChargedAt debe seguir fijo en 2026-05-03, recibido ${client.firstSundayChargedAt}`);

  console.log("OK first-sunday rule: solo primer domingo total de vida del cliente.");
})()
  .catch((error) => {
    console.error("FALLO TEST FIRST SUNDAY:", error && error.message ? error.message : error);
    process.exit(1);
  })
  .finally(() => {
    try {
      if (fs.existsSync(TMP_DIR)) fs.rmSync(TMP_DIR, { recursive: true, force: true });
    } catch {
      // noop
    }
  });
