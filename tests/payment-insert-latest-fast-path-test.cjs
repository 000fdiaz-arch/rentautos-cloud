const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const migrationPath = path.join(root, "supabase", "migrations", "20260924000200_payment_insert_latest_fast_path.sql");
const manualPath = path.join(root, "supabase", "88-payment-insert-latest-fast-path.sql");
const migration = fs.readFileSync(migrationPath, "utf8");
const manual = fs.readFileSync(manualPath, "utf8");
const errors = fs.readFileSync(path.join(root, "src", "pages", "payments", "paymentPersistenceErrors.ts"), "utf8");

assert.equal(migration, manual, "La migracion y el script manual deben permanecer identicos.");
assert.match(migration, /if tg_op = 'INSERT'[\s\S]*coalesce\(v_new_client_id, ''\) <> ''/);
assert.doesNotMatch(
  migration.slice(migration.indexOf("if tg_op = 'INSERT'"), migration.indexOf("return new;", migration.indexOf("if tg_op = 'INSERT'"))),
  /new\.data->>'source' = 'route'/
);
assert.match(migration, /insert into public\.latest_payments_by_client_cloud/);
assert.match(migration, /on conflict \(user_id, client_id\) do update/);
assert.match(migration, /create index if not exists payments_cloud_user_client_unit_latest_idx/);
assert.match(migration, /create index if not exists payments_cloud_user_receivable_unit_latest_idx/);
assert.match(migration, /UPDATE y DELETE[\s\S]*rebuild_latest_payment_for_client/);

const timeoutBranch = errors.slice(
  errors.indexOf('normalized.includes("57014")'),
  errors.indexOf('normalized.includes("network")')
);
assert.match(timeoutBranch, /Supabase tardo demasiado/);
assert.match(timeoutBranch, /No se aplicaron cambios/);

console.log("OK pagos: INSERT usa cache directa y timeout 57014 informa la causa real.");
