const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "src/provisionalRentals.ts"), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText;
const target = path.join(os.tmpdir(), `provisional-rentals-${Date.now()}.cjs`);
fs.writeFileSync(target, output);
const rules = require(target);

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: esperado ${expected}, recibido ${actual}`);
}

const client = {
  id: "client-1", unitId: "A10", name: "Cliente", rentAmount: 30, frequency: "daily",
  installmentsAgreed: 100, installmentsRemaining: 80, installmentsPaid: 20,
  otherCharges: [], balance: 90, advanceBalance: 0, savings: 2.1,
  createdAt: "2026-08-01T00:00:00.000Z", status: "taller"
};

let rental = rules.createProvisionalRental({
  client, unitId: "B20", brandModel: "Toyota Yaris", plate: "AB1234",
  frequency: "daily", rentAmount: 25, startDate: "2026-08-10", now: "2026-08-10T10:00:00.000Z"
});
assertEqual(rental.balance, 25, "cargo inmediato al asignar");
rental = rules.accrueProvisionalRental(rental, "2026-08-12");
assertEqual(rental.balance, 75, "cargos diarios acumulados");

const partial = rules.applyPaymentToProvisionalRental(rental, 60, "2026-08-12");
assertEqual(partial.balanceAfter, 15, "abono primero a cargos antiguos");
assertEqual(partial.chargeApplications.length, 3, "detalle de periodos aplicados");
assertEqual(rules.nextProvisionalRentalChargeDate(partial.rental), "2026-08-12", "proxima fecha muestra primero la cuota pendiente");
const overpayment = rules.applyPaymentToProvisionalRental(partial.rental, 40, "2026-08-12");
assertEqual(overpayment.balanceAfter, 0, "deuda provisional saldada");
assertEqual(overpayment.creditAfter, 25, "excedente provisional guardado");

const activeClient = { ...client, activeProvisionalRental: overpayment.rental };
const returned = rules.returnActiveProvisionalRental(activeClient, "2026-08-12");
assertEqual(returned.balance, 90, "saldo regular permanece congelado");
assertEqual(returned.installmentsRemaining, 80, "cuotas regulares no cambian");
assertEqual(returned.activeProvisionalRental, undefined, "alquiler deja de estar activo");
assertEqual(returned.lastChargeDate, "2026-08-12", "contrato reanuda sin retroactivo");
const carried = rules.collectReturnedProvisionalRentalCredit(returned);
assertEqual(carried.credit, 25, "saldo a favor disponible para alquiler futuro");
assertEqual(carried.history[0].creditBalance, 0, "crédito no se duplica en el historial");

const sql = fs.readFileSync(path.join(root, "supabase/63-provisional-rental-workflow.sql"), "utf8");
if (!sql.includes("clients_cloud_active_provisional_unit_uq")) throw new Error("Falta protección contra doble asignación.");
if (!sql.includes("for update")) throw new Error("La asignación debe bloquear cliente y auto durante la transacción.");

console.log("OK alquiler provisional: cargos, pagos, crédito, devolución y exclusión doble validados.");
