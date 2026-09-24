const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const operations = fs.readFileSync(path.join(root, "src/cloud/operationsCloudData.ts"), "utf8");
const page = fs.readFileSync(path.join(root, "src/pages/ControlUnitsPage.tsx"), "utf8");
const rules = fs.readFileSync(path.join(root, "src/pages/controlUnits/controlUnitsRules.ts"), "utf8");
const migration = fs.readFileSync(path.join(root, "supabase/migrations/20260924000100_fleet_status_timeout_fast_path.sql"), "utf8");

const statusFunctionStart = operations.indexOf("export async function setControlUnitStatus");
const statusFunctionEnd = operations.indexOf("export type FleetLifecycleImpact", statusFunctionStart);
const statusFunction = operations.slice(statusFunctionStart, statusFunctionEnd);

assert.match(statusFunction, /withCloudRetry\(async \(\) =>/);
assert.match(statusFunction, /if \(error\)[\s\S]*throw error/);
assert.match(page, /setRows\(\(current\) => current\.map/);
assert.match(page, /void reloadRows\(\)\.catch/);
assert.match(rules, /57014[\s\S]*statement timeout/);

assert.match(migration, /v_identity_changed/);
assert.match(migration, /if not v_identity_changed then/);
assert.match(migration, /v_old_active and not v_new_active[\s\S]*delete from public\.latest_payments_by_client_cloud/);
assert.match(migration, /not v_old_active and v_new_active[\s\S]*perform public\.rebuild_latest_payment_for_client/);

const unchangedIdentityBranch = migration.slice(
  migration.indexOf("if not v_identity_changed then"),
  migration.indexOf("delete from public.latest_payments_by_client_cloud", migration.indexOf("if not v_identity_changed then") + 100)
);
assert.doesNotMatch(unchangedIdentityBranch, /perform public\.rebuild_latest_payment_for_client\(new\.user_id, new\.id\);\s*return new;/);

console.log("OK Autos: timeout 57014 reintentado, refresco no bloqueante y trigger de pagos con ruta rapida.");
