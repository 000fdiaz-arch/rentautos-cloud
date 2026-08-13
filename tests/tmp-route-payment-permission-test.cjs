const fs = require("node:fs");
const path = require("node:path");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "src", "AppShell.tsx"), "utf8");
const cloud = fs.readFileSync(path.join(root, "src", "cloud", "operationsCloudData.ts"), "utf8");
const paymentCloud = fs.readFileSync(path.join(root, "src", "cloud", "paymentCloudData.ts"), "utf8");
const migration = fs.readFileSync(path.join(root, "supabase", "60-route-payment-scope.sql"), "utf8");

assert(app.includes('if (!canEditRouteSearch) {'), "Ruta debe autorizar por su propio permiso de edicion.");
assert(app.includes('readOnly={!canEditRouteSearch}'), "La interfaz de Ruta no debe depender de Editar Pagos.");
assert(app.includes('source: "payments" | "route" = "payments"'), "El guardado debe distinguir el origen del pago.");
assert(app.includes('source === "route" ? !canEditRouteSearch : !canEditPayments'), "Pagos generales deben conservar su permiso independiente.");
assert(app.includes('transaction.payment.source = "route"'), "El efectivo de Ruta debe quedar identificado por origen.");
assert(app.includes("registerCloudRouteBankNotice(cloudDataUserId, notice)"), "El aviso bancario debe guardarse por una ruta dedicada.");
assert(cloud.includes('.from("notified_payments_cloud")') && cloud.includes(".insert("), "La nube debe insertar el ACH de Ruta sin sincronizar toda la bandeja.");
assert(migration.includes('data ->> \'source\' = \'route\''), "Supabase debe limitar la excepcion a registros originados en Ruta.");
assert(migration.includes("guard_payment_write_scope"), "Los pagos atomicos deben respetar el alcance especial de Ruta.");
const modernReceiptFlow = paymentCloud.slice(
  paymentCloud.indexOf('if (!Array.isArray(data))'),
  paymentCloud.indexOf("export async function saveCloudPayments")
);
assert(!modernReceiptFlow.includes("await loadCloudMaxReceiptSequence(userId)"), "La reserva moderna no debe volver a recorrer todo el historial de pagos.");

console.log("OK permisos de cobro en ruta: Ruta puede registrar sin habilitar la edicion general de Pagos.");
