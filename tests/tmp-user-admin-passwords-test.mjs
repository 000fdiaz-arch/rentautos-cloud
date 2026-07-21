import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { loadDotEnv } from "../scripts/migration-common.mjs";

const env = { ...loadDotEnv(".env"), ...process.env };
const supabaseUrl = env.VITE_SUPABASE_URL ?? "";
const anonKey = env.VITE_SUPABASE_ANON_KEY ?? "";
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY ?? "";

function readAdminPassword() {
  const backupDir = path.join(process.env.USERPROFILE ?? process.cwd(), "Desktop", "rentautos-backups");
  const loginFile = fs.existsSync(backupDir)
    ? fs.readdirSync(backupDir)
      .filter((name) => name.startsWith("rentautos-test-admin-login-") && name.endsWith(".txt"))
      .sort()
      .pop()
    : "";
  if (!loginFile) return "";
  const loginText = fs.readFileSync(path.join(backupDir, loginFile), "utf8");
  return loginText.match(/^Password: (.+)$/m)?.[1] ?? "";
}

assert.ok(supabaseUrl, "Falta VITE_SUPABASE_URL");
assert.ok(anonKey, "Falta VITE_SUPABASE_ANON_KEY");
assert.ok(serviceRoleKey, "Falta SUPABASE_SERVICE_ROLE_KEY");

const ownerEmail = process.env.RENTAUTOS_RLS_OWNER_EMAIL ?? "admin@auth.rentautos.local";
const adminPassword = process.env.RENTAUTOS_RLS_OWNER_PASSWORD ?? readAdminPassword();
assert.ok(adminPassword, "Falta password admin de prueba");

const stamp = Date.now();
const testLogin = `usuario-prueba-${stamp}`;
const testEmail = `${testLogin}@auth.rentautos.local`;
const tempPassword = `Temp-${stamp}!`;
const changedPassword = `Changed-${stamp}!`;
const resetPassword = `Reset-${stamp}!`;
const permissions = {
  leads: { view: false, edit: false },
  clients: { view: true, edit: false },
  payments: { view: true, edit: false },
  control_units: { view: true, edit: false },
  settings: { view: false, edit: false },
  users: { view: false, edit: false }
};

const service = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
const adminClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: adminSignIn, error: adminSignInError } = await adminClient.auth.signInWithPassword({
  email: ownerEmail,
  password: adminPassword
});
assert.ifError(adminSignInError);
assert.ok(adminSignIn.user?.id, "No se pudo iniciar como admin");

let createdUserId = "";

try {
  const { data: createdProfile, error: createError } = await adminClient.rpc("admin_create_app_user", {
    p_login: testLogin,
    p_password: tempPassword,
    p_role: "lectura",
    p_data_owner_user_id: adminSignIn.user.id,
    p_permissions: permissions
  });
  assert.ifError(createError);
  assert.equal(createdProfile.email, testEmail);
  assert.equal(createdProfile.role, "lectura");
  createdUserId = createdProfile.id;

  const tempClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: tempSignIn, error: tempSignInError } = await tempClient.auth.signInWithPassword({
    email: testEmail,
    password: tempPassword
  });
  assert.ifError(tempSignInError);
  assert.equal(tempSignIn.user.user_metadata?.must_change_password, true);

  const { error: updatePasswordError } = await tempClient.auth.updateUser({ password: changedPassword });
  assert.ifError(updatePasswordError);
  const { error: markChangedError } = await tempClient.rpc("mark_own_password_changed");
  assert.ifError(markChangedError);
  const { data: refreshed, error: refreshError } = await tempClient.auth.refreshSession();
  assert.ifError(refreshError);
  assert.equal(refreshed.user?.user_metadata?.must_change_password, false);

  const { error: resetError } = await adminClient.rpc("admin_reset_app_user_password", {
    p_user_id: createdUserId,
    p_password: resetPassword
  });
  assert.ifError(resetError);

  const resetClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: resetSignIn, error: resetSignInError } = await resetClient.auth.signInWithPassword({
    email: testEmail,
    password: resetPassword
  });
  assert.ifError(resetSignInError);
  assert.equal(resetSignIn.user.user_metadata?.must_change_password, true);

  console.log(JSON.stringify({
    ok: true,
    createdUser: testEmail,
    results: [
      "admin crea usuario desde RPC",
      "usuario inicia con password temporal",
      "primer login exige cambio de password",
      "usuario cambia password y desbloquea app",
      "admin resetea password y vuelve a exigir cambio"
    ]
  }, null, 2));
} finally {
  if (createdUserId) {
    await service.from("user_profiles").delete().eq("id", createdUserId);
    await service.auth.admin.deleteUser(createdUserId);
  }
}
