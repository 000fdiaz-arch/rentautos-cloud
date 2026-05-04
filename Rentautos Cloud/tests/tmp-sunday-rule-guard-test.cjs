const fs = require("fs");
const path = require("path");
const os = require("os");
const ts = require("typescript");

const ROOT = path.resolve(__dirname, "..");
const TMP_DIR = path.join(os.tmpdir(), `sunday-rule-transpile-${Date.now()}`);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function transpileBilling() {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  const source = fs.readFileSync(path.join(ROOT, "src", "billing.ts"), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true
    }
  }).outputText;
  const outPath = path.join(TMP_DIR, "billing.js");
  fs.writeFileSync(outPath, output, "utf8");
  return require(outPath);
}

function makeClient(overrides = {}) {
  return {
    id: "sunday-test-client",
    unitId: "A54",
    name: "CLIENTE DOMINGO",
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
    status: "active",
    ...overrides
  };
}

(function run() {
  const { applyAutomaticCharges, isChargeDay } = transpileBilling();

  const firstSunday = new Date("2026-05-03T10:00:00");
  const secondSunday = new Date("2026-05-10T10:00:00");
  const nextMonthSunday = new Date("2026-06-07T10:00:00");

  // Caso 1: primer domingo se cobra cuando no hay bloqueo
  let c1 = makeClient({ installmentsPaid: 6 });
  assert(isChargeDay(c1, firstSunday) === true, "Caso 1: primer domingo debe ser dia de cobro");
  c1 = applyAutomaticCharges([c1], firstSunday).clients[0];
  assert(c1.balance === 33, `Caso 1: balance esperado 33, recibido ${c1.balance}`);
  assert(c1.firstSundayChargedAt === "2026-05-03", `Caso 1: firstSundayChargedAt esperado 2026-05-03, recibido ${c1.firstSundayChargedAt}`);

  // Caso 2: siguiente domingo del mismo mes no se cobra de nuevo
  c1 = applyAutomaticCharges([c1], secondSunday).clients[0];
  assert(c1.balance === 231, `Caso 2: balance esperado 231, recibido ${c1.balance}`); // +6 dias lun-sab

  // Caso 3: domingo de mes siguiente tampoco se cobra de nuevo
  c1 = applyAutomaticCharges([c1], nextMonthSunday).clients[0];
  assert(c1.balance === 1023, `Caso 3: balance esperado 1023, recibido ${c1.balance}`); // +24 dias lun-sab

  // Caso 4: con 7 o mas cuotas pagadas, domingo se bloquea aunque chargeFirstSunday=true
  let c2 = makeClient({ installmentsPaid: 7 });
  assert(isChargeDay(c2, firstSunday) === false, "Caso 4: con >=7 cuotas pagadas, domingo debe bloquearse");
  c2 = applyAutomaticCharges([c2], firstSunday).clients[0];
  assert(c2.balance === 0, `Caso 4: balance esperado 0, recibido ${c2.balance}`);
  assert(!c2.firstSundayChargedAt, "Caso 4: firstSundayChargedAt no debe setearse cuando hay bloqueo");

  console.log("OK sunday rule guard: primer domingo unico y bloqueo por installmentsPaid >= 7.");
})();
