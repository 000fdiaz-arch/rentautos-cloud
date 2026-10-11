const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const app = read("src/App.tsx");
const shell = read("src/AppShell.tsx");
const page = read("src/pages/RouteSearchPage.tsx");
const card = read("src/pages/RouteCollectionCard.tsx");
const migration = read("supabase/migrations/20261011000100_visual_route_bank_confirmation.sql");
assert.equal(migration, read("supabase/107-visual-route-bank-confirmation.sql"), "El script manual y la migración deben coincidir.");

assert(app.includes('isAdmin={authProfile.role === "admin"}'), "La confirmación debe depender del rol admin real.");
assert(shell.includes("async function confirmRouteBankPayment"), "El admin debe confirmar visualmente desde Ruta.");
const confirmationFlow = shell.slice(shell.indexOf("async function confirmRouteBankPayment"), shell.indexOf("async function persistDeletedPayments"));
assert(confirmationFlow.includes("confirmRouteBankReport(input.reportId)"), "La confirmación debe usar la RPC visual.");
assert(!confirmationFlow.includes("buildManualPaymentTransaction"), "La confirmación visual no debe construir un pago.");
assert(!confirmationFlow.includes("receiptNumber"), "La confirmación visual no debe reservar un recibo.");
assert(card.includes('Confirmado en banco'), "La tarjeta debe ofrecer la confirmación bancaria.");
assert(card.includes('>No confirmado</button>'), "El admin debe poder rechazar la notificación.");
assert(card.includes('view !== "review"'), "Una notificación pendiente no debe ofrecer custodia.");
assert(shell.includes("canConfirmBankPayment={isAdmin && canEditPayments && canReportRoutePayments}"), "Solo el admin con acceso a Pagos y Ruta debe recibir la acción.");
assert(migration.includes("p.role::text = 'admin'"), "La base de datos debe comprobar el rol admin.");
assert(migration.includes("confirm_route_bank_report"), "La base debe confirmar el reporte sin insertar pagos.");
assert(migration.includes("bank_confirmed_visually_at"), "La base debe conservar la auditoría visual.");
assert(migration.includes("bank_confirmed_amount_met"), "La base debe sacar de Ruta cuando el monto cubre lo solicitado.");
assert(migration.includes("no genera recibo"), "El servidor debe bloquear clientes antiguos que intenten generar el recibo.");

console.log("OK ruta: la confirmación bancaria es visual, sin pago ni recibo.");
