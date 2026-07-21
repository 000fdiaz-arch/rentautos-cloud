import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { loadDotEnv } from "./migration-common.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function nowStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

const OPERATOR_PERMISSIONS = {
  leads: { view: true, edit: true },
  clients: { view: true, edit: true },
  payments: { view: true, edit: true },
  control_units: { view: true, edit: true },
  settings: { view: false, edit: false },
  users: { view: false, edit: false }
};

const READER_PERMISSIONS = {
  leads: { view: false, edit: false },
  clients: { view: true, edit: false },
  payments: { view: true, edit: false },
  control_units: { view: true, edit: false },
  settings: { view: false, edit: false },
  users: { view: false, edit: false }
};

async function ensureUser(admin, profileClient, email, role, ownerId, permissions) {
  const { data: list, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listError) throw listError;
  let user = list.users.find((candidate) => candidate.email?.toLowerCase() === email);
  const password = `Rentautos-${role}-${crypto.randomBytes(8).toString("base64url")}!9`;
  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw error;
    user = data.user;
  } else {
    const { data, error } = await admin.auth.admin.updateUserById(user.id, { password, email_confirm: true });
    if (error) throw error;
    user = data.user;
  }

  const { error: profileError } = await profileClient
    .from("user_profiles")
    .upsert({ id: user.id, email, role, data_owner_user_id: ownerId, permissions }, { onConflict: "id" });
  if (profileError) throw profileError;

  return { user, password };
}

async function signIn(url, anonKey, email, password) {
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return client;
}

async function expectAllowed(label, task) {
  const { error } = await task();
  assert(!error, `${label} debia permitir, pero fallo: ${error?.message}`);
  return label;
}

async function expectDenied(label, task) {
  const { error } = await task();
  assert(error, `${label} debia denegar, pero permitio`);
  return `${label}: ${error.message}`;
}

function readAdminPassword() {
  const backupDir = path.join(process.env.USERPROFILE ?? process.cwd(), "Desktop", "rentautos-backups");
  if (!fs.existsSync(backupDir)) return "";
  const loginFile = fs.readdirSync(backupDir)
    .filter((name) => name.startsWith("rentautos-test-admin-login-") && name.endsWith(".txt"))
    .sort()
    .pop();
  if (!loginFile) return "";
  const loginText = fs.readFileSync(path.join(backupDir, loginFile), "utf8");
  return loginText.match(/^Password: (.+)$/m)?.[1] ?? "";
}

const env = { ...loadDotEnv(".env"), ...process.env };
const supabaseUrl = env.VITE_SUPABASE_URL ?? "";
const anonKey = env.VITE_SUPABASE_ANON_KEY ?? "";
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY ?? "";

if (!supabaseUrl || !anonKey || !serviceRoleKey) {
  console.error("Faltan VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY o SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const ownerEmail = process.env.RENTAUTOS_RLS_OWNER_EMAIL ?? "admin@auth.rentautos.local";
const adminPassword = process.env.RENTAUTOS_RLS_OWNER_PASSWORD ?? readAdminPassword();
if (!adminPassword) {
  console.error("Falta password admin. Define RENTAUTOS_RLS_OWNER_PASSWORD o usa el archivo local de login de prueba.");
  process.exit(1);
}

const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
const { data: users, error: usersError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
if (usersError) throw usersError;
const owner = users.users.find((user) => user.email?.toLowerCase() === ownerEmail);
assert(owner, `No existe owner ${ownerEmail}`);

const ownerId = owner.id;
const adminClient = await signIn(supabaseUrl, anonKey, ownerEmail, adminPassword);
const operator = await ensureUser(admin, adminClient, "operador@auth.rentautos.local", "operador", ownerId, OPERATOR_PERMISSIONS);
const reader = await ensureUser(admin, adminClient, "lectura@auth.rentautos.local", "lectura", ownerId, READER_PERMISSIONS);

const operatorClient = await signIn(supabaseUrl, anonKey, operator.user.email, operator.password);
const readerClient = await signIn(supabaseUrl, anonKey, reader.user.email, reader.password);

const testClientId = `rls-client-${Date.now()}`;
const testSettingId = `rls-setting-${Date.now()}`;
const testLeadId = `rls-lead-${Date.now()}`;
const results = [];

results.push(await expectAllowed(
  "lectura lee clientes",
  () => readerClient.from("clients_cloud").select("id").eq("user_id", ownerId).limit(1)
));
results.push(await expectDenied(
  "lectura no inserta clientes",
  () => readerClient.from("clients_cloud").insert({ user_id: ownerId, id: testClientId, data: { id: testClientId, name: "RLS Reader" } })
));
results.push(await expectDenied(
  "lectura no cambia role",
  () => readerClient.from("user_profiles").update({ role: "admin" }).eq("id", reader.user.id)
));

results.push(await expectAllowed(
  "operador inserta cliente",
  () => operatorClient.from("clients_cloud").insert({ user_id: ownerId, id: testClientId, data: { id: testClientId, name: "RLS Operator" } })
));
results.push(await expectAllowed(
  "operador actualiza cliente",
  () => operatorClient.from("clients_cloud").update({ data: { id: testClientId, name: "RLS Operator Updated" } }).eq("user_id", ownerId).eq("id", testClientId)
));
results.push(await expectDenied(
  "operador no administra settings",
  () => operatorClient.from("bank_rules_cloud").insert({ user_id: ownerId, id: testSettingId, data: { id: testSettingId } })
));
results.push(await expectAllowed(
  "operador inserta lead",
  () => operatorClient.from("lead_evaluations_cloud").insert({ user_id: ownerId, id: testLeadId, data: { id: testLeadId, updatedAt: new Date().toISOString() } })
));
results.push(await expectAllowed(
  "admin administra settings",
  () => adminClient.from("bank_rules_cloud").insert({ user_id: ownerId, id: testSettingId, data: { id: testSettingId } })
));

await admin.from("clients_cloud").delete().eq("user_id", ownerId).eq("id", testClientId);
await admin.from("bank_rules_cloud").delete().eq("user_id", ownerId).eq("id", testSettingId);
await admin.from("lead_evaluations_cloud").delete().eq("user_id", ownerId).eq("id", testLeadId);

const backupDir = path.join(process.env.USERPROFILE ?? process.cwd(), "Desktop", "rentautos-backups");
fs.mkdirSync(backupDir, { recursive: true });
const credentialPath = path.join(backupDir, `rentautos-role-test-users-${nowStamp()}.txt`);
fs.writeFileSync(credentialPath, [
  `Owner: ${ownerId}`,
  "Operador ID: operador",
  `Operador email: ${operator.user.email}`,
  `Operador password: ${operator.password}`,
  "Lectura ID: lectura",
  `Lectura email: ${reader.user.email}`,
  `Lectura password: ${reader.password}`
].join("\n"), "utf8");

console.log(JSON.stringify({ ok: true, ownerId, results, credentialPath }, null, 2));
