import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { formatUserLogin } from "../src/pages/settings/userSettingsRules";

assert.equal(formatUserLogin("ambar@auth.rentautos.local"), "ambar");
assert.equal(formatUserLogin("ADMIN@AUTH.RENTAUTOS.APP"), "ADMIN");
assert.equal(formatUserLogin("persona@gmail.com"), "persona@gmail.com");
assert.equal(formatUserLogin(null), "");

const root = process.cwd();
const panel = readFileSync(join(root, "src/pages/settings/UserPermissionsSettingsPanel.tsx"), "utf8");
const cloud = readFileSync(join(root, "src/cloud/userProfileCloudData.ts"), "utf8");
const migration = readFileSync(
  join(root, "supabase/migrations/20260828000100_user_profile_active_status.sql"),
  "utf8"
);

assert.match(panel, /Activos <span>\{activeProfiles\.length\}<\/span>/);
assert.match(panel, /Inactivos <span>\{inactiveProfiles\.length\}<\/span>/);
assert.match(panel, /profile\.is_active \? "Desactivar" : "Reactivar"/);
assert.match(cloud, /admin_set_app_user_active/);
assert.match(migration, /add column if not exists is_active boolean not null default true/);
assert.match(migration, /banned_until = case when p_active then null/);
assert.match(migration, /No puedes desactivar tu propia sesion/);
assert.match(migration, /ultimo administrador activo/);
assert.match(migration, /current_profile\.is_active/);

console.log("OK usuarios: dominios internos ocultos y estados activos/inactivos protegidos.");
