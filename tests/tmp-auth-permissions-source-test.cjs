const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const permissionsSource = fs.readFileSync(path.join(root, "src", "auth", "permissions.ts"), "utf8");
const migrationSource = fs.readFileSync(path.join(root, "supabase", "18-secure-user-profiles-and-role-rls.sql"), "utf8");
const policyResetSource = fs.readFileSync(path.join(root, "supabase", "19-reset-role-rls-policies.sql"), "utf8");
const screenPermissionsSource = fs.readFileSync(path.join(root, "supabase", "20-screen-permissions.sql"), "utf8");
const userAdminPasswordsSource = fs.readFileSync(path.join(root, "supabase", "21-user-admin-passwords.sql"), "utf8");

for (const role of ["admin", "operador", "lectura"]) {
  assert.match(permissionsSource, new RegExp(`${role}: new Set`), `Falta el rol ${role} en permissions.ts`);
}

for (const permission of [
  "operational.read",
  "operational.write",
  "settings.manage",
  "users.manage"
]) {
  assert.match(permissionsSource, new RegExp(`"${permission}"`), `Falta el permiso ${permission}`);
}

for (const screen of ["leads", "clients", "payments", "control_units", "settings", "users"]) {
  assert.match(permissionsSource, new RegExp(`"${screen}"`), `Falta pantalla ${screen} en permissions.ts`);
}

assert.match(
  permissionsSource,
  /lectura:\s*new Set\(\[\s*"operational\.read"\s*\]\)/s,
  "lectura debe quedar limitada a lectura operacional"
);

assert.match(
  migrationSource,
  /prevent_self_privilege_update/,
  "La migracion debe bloquear cambios propios de role/data_owner_user_id"
);

assert.match(
  migrationSource,
  /can_write_owner_data\(target_user_id uuid\)/,
  "La migracion debe definir escritura operacional por rol"
);

assert.match(
  migrationSource,
  /can_manage_owner_settings\(target_user_id uuid\)/,
  "La migracion debe definir administracion de settings por rol"
);

assert.match(
  migrationSource,
  /for select\s+to authenticated\s+using \(public\.can_access_owner_data\(user_id\)\)/i,
  "Las tablas cloud deben conservar lectura por dataset asignado"
);

assert.match(
  policyResetSource,
  /from pg_policies/,
  "La migracion 19 debe eliminar politicas heredadas desde pg_policies"
);

assert.match(
  policyResetSource,
  /with check \(public\.can_write_owner_data\(user_id\)\)/,
  "La migracion 19 debe recrear escritura operacional por rol"
);

assert.match(
  screenPermissionsSource,
  /add column if not exists permissions jsonb/i,
  "La migracion 20 debe agregar permisos por pantalla"
);

assert.match(
  screenPermissionsSource,
  /can_edit_owner_screen\(user_id, %L\)/,
  "La migracion 20 debe aplicar edicion por pantalla en RLS"
);

assert.match(
  screenPermissionsSource,
  /old\.permissions is distinct from new\.permissions/,
  "La migracion 20 debe impedir que usuarios no-admin cambien sus permisos"
);

assert.match(
  screenPermissionsSource,
  /can_manage_users\(\)/,
  "La migracion 20 debe exigir permiso users.edit para gestionar perfiles"
);

assert.match(
  userAdminPasswordsSource,
  /admin_finalize_app_user\(\s*p_user_id uuid/i,
  "La migracion 21 debe finalizar usuarios creados desde la app"
);

assert.match(
  userAdminPasswordsSource,
  /admin_reset_app_user_password\(\s*p_user_id uuid,\s*p_password text\s*\)/i,
  "La migracion 21 debe permitir resetear contrasenas desde la app"
);

assert.match(
  userAdminPasswordsSource,
  /must_change_password/i,
  "La migracion 21 debe marcar cambio obligatorio de contrasena"
);

console.log("auth permissions source test: PASS");
