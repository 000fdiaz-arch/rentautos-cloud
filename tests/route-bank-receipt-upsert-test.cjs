const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const manual = read("supabase/105-route-bank-receipt-upsert.sql");
const migration = read("supabase/migrations/20261010000200_route_bank_receipt_upsert.sql");

assert.equal(manual, migration, "El script manual y la migración deben coincidir.");

const existingRowCheck = migration.indexOf("from public.payments_cloud existing");
const adminConfirmationCheck = migration.indexOf("public.is_valid_admin_route_bank_confirmation");
assert(existingRowCheck >= 0, "El UPSERT debe reconocer pagos existentes.");
assert(adminConfirmationCheck > existingRowCheck, "La fila existente debe alcanzar UPDATE antes de exigir una confirmación nueva.");
assert(migration.includes("existing.user_id = new.user_id"), "La coincidencia debe estar limitada al negocio actual.");
assert(migration.includes("existing.id = new.id"), "La coincidencia debe exigir el mismo pago.");
assert(migration.includes("public.can_edit_owner_screen(new.user_id, 'payments')"), "La fase UPDATE debe conservar el permiso normal de Pagos.");
assert(migration.includes("Solo el administrador puede confirmar pagos bancarios de Ruta"), "Una confirmación nueva debe seguir protegida.");

console.log("OK recibos de Ruta: el UPSERT existente puede actualizar metadatos sin habilitar confirmaciones nuevas.");
