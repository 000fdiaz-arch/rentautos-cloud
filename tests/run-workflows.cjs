const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const TESTS_DIR = path.join(ROOT, "tests");
const REPORT_DIR = path.join(TESTS_DIR, "validation-output");
const REPORT_PATH = path.join(REPORT_DIR, "workflows-report.txt");
const BASE_URL = process.env.RENTAUTOS_WORKFLOWS_BASE_URL ?? "http://127.0.0.1:5174/";
const TEST_TIMEOUT_MS = Number(process.env.RENTAUTOS_WORKFLOWS_TEST_TIMEOUT_MS ?? 60000);
const SERVER_BOOT_TIMEOUT_MS = Number(process.env.RENTAUTOS_WORKFLOWS_SERVER_BOOT_TIMEOUT_MS ?? 20000);

fs.mkdirSync(REPORT_DIR, { recursive: true });

const allFiles = fs.readdirSync(TESTS_DIR).filter((name) => name.startsWith("tmp-") && (name.endsWith(".cjs") || name.endsWith(".mjs")));
const tests = allFiles.sort((a, b) => a.localeCompare(b));

if (tests.length === 0) {
  console.log("No se encontraron tests tmp-*.cjs.");
  process.exit(1);
}

let passed = 0;
let failed = 0;
const lines = [];
lines.push("RENTAUTOS WORKFLOWS REPORT");
lines.push(`Fecha: ${new Date().toLocaleString("es-PA")}`);
lines.push(`Total tests detectados: ${tests.length}`);
lines.push(`Base URL: ${BASE_URL}`);
lines.push("");

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function canReachServer(url) {
  return new Promise((resolve) => {
    const request = http.get(url, (response) => {
      response.resume();
      resolve(response.statusCode && response.statusCode >= 200 && response.statusCode < 500);
    });
    request.setTimeout(1500, () => {
      request.destroy();
      resolve(false);
    });
    request.on("error", () => resolve(false));
  });
}

async function ensureServer() {
  if (await canReachServer(BASE_URL)) {
    console.log(`Servidor disponible en ${BASE_URL}`);
    return null;
  }

  console.log("Levantando servidor Vite para workflows...");
  const isWin = process.platform === "win32";
  const child = spawn(isWin ? "cmd.exe" : "npm", isWin
    ? ["/c", "npm", "run", "dev", "--", "--host", "127.0.0.1", "--port", "5174", "--strictPort"]
    : ["run", "dev", "--", "--host", "127.0.0.1", "--port", "5174", "--strictPort"], {
    cwd: ROOT,
    env: {
      ...process.env,
      VITE_PERSISTENCE_MODE: "LOCAL_ONLY",
      VITE_RENTAUTOS_TEST_BYPASS_AUTH: "1",
      VITE_RENTAUTOS_TEST_LEGACY_LOCAL_STORAGE: "1"
    },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", (chunk) => process.stdout.write(String(chunk)));
  child.stderr.on("data", (chunk) => process.stderr.write(String(chunk)));

  const startedAt = Date.now();
  while (Date.now() - startedAt < SERVER_BOOT_TIMEOUT_MS) {
    if (await canReachServer(BASE_URL)) {
      console.log(`Servidor listo en ${BASE_URL}`);
      return child;
    }
    await wait(500);
  }

  child.kill();
  throw new Error(`No se pudo levantar el servidor de workflows en ${BASE_URL}.`);
}

async function main() {
  const ownedServer = await ensureServer();

  for (const testFile of tests) {
    const fullPath = path.join(TESTS_DIR, testFile);
    const startedAt = Date.now();
    console.log(`\n[RUN] ${testFile}`);
    const isWin = process.platform === "win32";
    const result = spawnSync(isWin ? "cmd.exe" : "node", isWin ? ["/c", "node", fullPath] : [fullPath], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: TEST_TIMEOUT_MS,
      windowsHide: true,
      env: {
        ...process.env,
        VITE_PERSISTENCE_MODE: "LOCAL_ONLY",
        VITE_RENTAUTOS_TEST_BYPASS_AUTH: "1",
        VITE_RENTAUTOS_TEST_LEGACY_LOCAL_STORAGE: "1"
      }
    });
    const elapsed = Date.now() - startedAt;

    const ok = result.status === 0;
    if (ok) {
      passed += 1;
      console.log(`[PASS] ${testFile} (${elapsed}ms)`);
      lines.push(`[PASS] ${testFile} (${elapsed}ms)`);
    } else {
      failed += 1;
      console.log(`[FAIL] ${testFile} (${elapsed}ms)`);
      lines.push(`[FAIL] ${testFile} (${elapsed}ms)`);
    }

    const stdout = (result.stdout || "").trim();
    const stderr = (result.stderr || "").trim();
    if (stdout) lines.push(`  stdout: ${stdout}`);
    if (stderr) lines.push(`  stderr: ${stderr}`);
    if (result.error) lines.push(`  error: ${result.error.message}`);
    lines.push("");
  }

  lines.push(`RESUMEN: ${passed} pasados, ${failed} fallidos, ${tests.length} ejecutados.`);
  fs.writeFileSync(REPORT_PATH, lines.join("\n"), "utf8");

  console.log(lines.join("\n"));
  console.log(`\nReporte guardado en: ${REPORT_PATH}`);
  if (ownedServer) ownedServer.kill();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  lines.push(`[FAIL] preflight -> ${error.message}`);
  fs.writeFileSync(REPORT_PATH, lines.join("\n"), "utf8");
  console.error(error.message);
  process.exit(1);
});
