const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const app = read("src/App.tsx");
const shell = read("src/AppShell.tsx");
const page = read("src/pages/RouteSearchPage.tsx");
const card = read("src/pages/RouteCollectionCard.tsx");
const migration = read("supabase/migrations/20261010000100_admin_route_bank_confirmation.sql");
assert.equal(migration, read("supabase/101-admin-route-bank-confirmation.sql"), "El script manual y la migración deben coincidir.");

assert(app.includes('isAdmin={authProfile.role === "admin"}'), "La confirmación debe depender del rol admin real.");
assert(shell.includes("async function confirmRouteBankPayment"), "El admin debe generar el pago regular desde Ruta.");
assert(shell.includes('paymentMethod: "Transferencia Bancaria"'), "La confirmación debe crear un pago bancario regular.");
assert(shell.includes("transaction.payment.bankConfirmation"), "El pago debe conservar la auditoría de la confirmación.");
assert(card.includes('Confirmado en banco'), "La tarjeta debe ofrecer la confirmación bancaria.");
assert(card.includes('>No confirmado</button>'), "El admin debe poder rechazar la notificación.");
assert(card.includes('view !== "review"'), "Una notificación pendiente no debe ofrecer custodia.");
assert(shell.includes("canConfirmBankPayment={isAdmin && canEditPayments && canReportRoutePayments}"), "Solo el admin con acceso a Pagos y Ruta debe recibir la acción.");
assert(migration.includes("p.role::text = 'admin'"), "La base de datos debe comprobar el rol admin.");
assert(migration.includes("is_valid_admin_route_bank_confirmation"), "La base debe validar el reporte bancario pendiente.");
assert(migration.includes("Solo el administrador puede confirmar pagos bancarios de Ruta"), "El servidor debe rechazar confirmaciones no autorizadas.");

console.log("OK ruta: solo admin confirma o rechaza pagos notificados de banca.");
