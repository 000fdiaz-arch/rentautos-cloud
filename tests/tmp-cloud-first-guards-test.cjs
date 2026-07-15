const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const ROOT = path.resolve(__dirname, "..");
const appShellPath = path.join(ROOT, "src", "AppShell.tsx");
const cloudMirrorPath = path.join(ROOT, "src", "cloudMirror.ts");
const clientCloudDataPath = path.join(ROOT, "src", "cloud", "clientCloudData.ts");
const paymentCloudDataPath = path.join(ROOT, "src", "cloud", "paymentCloudData.ts");
const operationsCloudDataPath = path.join(ROOT, "src", "cloud", "operationsCloudData.ts");

const appShell = fs.readFileSync(appShellPath, "utf8");
const cloudMirror = fs.readFileSync(cloudMirrorPath, "utf8");
const clientCloudData = fs.readFileSync(clientCloudDataPath, "utf8");
const paymentCloudData = fs.readFileSync(paymentCloudDataPath, "utf8");
const operationsCloudData = fs.readFileSync(operationsCloudDataPath, "utf8");

function functionBody(source, name) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `No se encontro ${name}.`);
  const braceStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(braceStart, index + 1);
  }
  throw new Error(`No se pudo leer el cuerpo de ${name}.`);
}

// 1) We must flush mirror before sign out to reduce lost writes.
assert.match(
  appShell,
  /async function handleSignOutWithBackup\(\): Promise<void>[\s\S]*await flushCloudMirror\(\);[\s\S]*await runBackup\("signout", false\);[\s\S]*await onSignOut\?\.\(\);/,
  "Debe hacer flush cloud + backup + signout en ese orden."
);

// 2) App must not render operational pages before cloud hydration completes.
assert.match(
  appShell,
  /if \(userId && !cloudReady\)[\s\S]*Cargando data de nube\.\.\./,
  "Debe bloquear UI operativa mientras carga data cloud."
);

// 3) Persist guards should avoid writes while cloud is not ready.
assert.match(
  appShell,
  /async function persistClients\(next: Client\[\]\): Promise<void> \{[\s\S]*if \(userId && !cloudReady\) return;/,
  "persistClients debe proteger contra persistencia antes de cloudReady."
);
assert.match(
  appShell,
  /async function persistPayments\(next: Payment\[\]\): Promise<void> \{[\s\S]*if \(userId && !cloudReady\) return;/,
  "persistPayments debe proteger contra persistencia antes de cloudReady."
);

// 4) Mirror flush function should exist and clear pending timers.
assert.match(
  cloudMirror,
  /export async function flushCloudMirror\(\): Promise<void>/,
  "flushCloudMirror debe existir."
);
assert.match(
  cloudMirror,
  /const keys = Array\.from\(pendingTimers\.keys\(\)\)/,
  "flushCloudMirror debe capturar keys pendientes."
);

// 5) Cloud sync must not delete rows only because a local snapshot is incomplete.
for (const [source, name] of [
  [clientCloudData, "saveCloudClients"],
  [clientCloudData, "syncCloudClientsDelta"],
  [paymentCloudData, "saveCloudPayments"],
  [paymentCloudData, "syncCloudPaymentsDelta"],
  [operationsCloudData, "saveCloudPaymentPromises"],
  [cloudMirror, "saveArrayKey"]
]) {
  assert.doesNotMatch(
    functionBody(source, name),
    /\.delete\s*\(/,
    `${name} no debe borrar filas cloud por sincronizacion automatica.`
  );
}

console.log("OK cloud-first guards: flush + hydration gate + guarded persistence + non-destructive sync.");
