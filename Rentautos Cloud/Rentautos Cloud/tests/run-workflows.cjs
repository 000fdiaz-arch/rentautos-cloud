const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const TESTS_DIR = path.join(ROOT, "tests");
const REPORT_DIR = path.join(TESTS_DIR, "validation-output");
const REPORT_PATH = path.join(REPORT_DIR, "workflows-report.txt");

fs.mkdirSync(REPORT_DIR, { recursive: true });

const allFiles = fs.readdirSync(TESTS_DIR).filter((name) => name.startsWith("tmp-") && name.endsWith(".cjs"));
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
lines.push("");

for (const testFile of tests) {
  const fullPath = path.join(TESTS_DIR, testFile);
  const result = spawnSync("cmd.exe", ["/c", "node", fullPath], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 120000,
    windowsHide: true
  });

  const ok = result.status === 0;
  if (ok) {
    passed += 1;
    lines.push(`[PASS] ${testFile}`);
  } else {
    failed += 1;
    lines.push(`[FAIL] ${testFile}`);
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
process.exit(failed > 0 ? 1 : 0);
