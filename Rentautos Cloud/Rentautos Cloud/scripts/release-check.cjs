const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function readDotEnvFile() {
  const envPath = path.join(process.cwd(), ".env");
  const map = {};
  if (!fs.existsSync(envPath)) return map;
  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex <= 0) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    if (!key) continue;
    const value = trimmed.slice(eqIndex + 1).trim().replace(/^['"]|['"]$/g, "");
    map[key] = value;
  }
  return map;
}

function runStep(command, args) {
  const isWin = process.platform === "win32";
  const cmd = isWin ? "cmd.exe" : command;
  const cmdArgs = isWin ? ["/c", command, ...args] : args;
  const result = spawnSync(cmd, cmdArgs, {
    stdio: "inherit",
    cwd: process.cwd(),
    shell: false
  });
  if (result.error) return false;
  return result.status === 0;
}

function getBin(name) {
  const ext = process.platform === "win32" ? ".cmd" : "";
  return path.join(process.cwd(), "node_modules", ".bin", `${name}${ext}`);
}

function missingEnv(name, dotEnvMap) {
  const value = process.env[name] ?? dotEnvMap[name];
  return !value || !String(value).trim();
}

const requiredEnv = [
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_ANON_KEY"
];

const dotEnvMap = readDotEnvFile();
const missing = requiredEnv.filter((name) => missingEnv(name, dotEnvMap));
if (missing.length > 0) {
  console.error(`NO PUBLICABLE: faltan variables requeridas -> ${missing.join(", ")}`);
  process.exit(1);
}

console.log("PUBLICABLE (configuracion minima OK)");
