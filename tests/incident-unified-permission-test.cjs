const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const root = process.cwd();
const permissions = readFileSync(join(root, "src/auth/permissions.ts"), "utf8");
const shell = readFileSync(join(root, "src/AppShell.tsx"), "utf8");
const settings = readFileSync(join(root, "src/pages/settings/UserPermissionsSettingsPanel.tsx"), "utf8");
const migration = readFileSync(join(root, "supabase/migrations/20260831000300_unify_incidents_permission.sql"), "utf8");

assert.match(permissions, /\{ id: "incidents", label: "Control de siniestros" \}/);
assert.doesNotMatch(permissions, /\{ id: "collisions", label:/);
assert.doesNotMatch(permissions, /\{ id: "insurance_workflow", label:/);
assert.match(permissions, /legacyCollisions\.view \|\| legacyInsurance\.view/);
assert.match(permissions, /legacyCollisions\.edit \|\| legacyInsurance\.edit/);
assert.match(shell, /canViewScreen\(permissions, "incidents"\)/);
assert.match(shell, /canEditScreen\(permissions, "incidents"\)/);
assert.doesNotMatch(shell, /canViewScreen\(permissions, "collisions"\)/);
assert.doesNotMatch(shell, /canViewScreen\(permissions, "insurance_workflow"\)/);
assert.match(settings, /return APP_SCREENS\.map/);
assert.match(migration, /permissions.*- 'collisions' - 'insurance_workflow'/s);
assert.match(migration, /p_screen in \('collisions', 'insurance_workflow'\) then 'incidents'/);

console.log("OK permiso unificado: Configuraciones, navegación y compatibilidad con permisos anteriores.");
