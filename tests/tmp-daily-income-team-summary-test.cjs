const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const root = path.resolve(__dirname, "..");
const tmp = path.join(root, ".tmp", `income-team-${Date.now()}`);

function transpile(relativePath) {
  const sourcePath = path.join(root, "src", relativePath);
  const outputPath = path.join(tmp, "src", relativePath.replace(/\.ts$/, ".js"));
  const output = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: sourcePath
  }).outputText;
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, output, "utf8");
}

try {
  fs.mkdirSync(tmp, { recursive: true });
  fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify({ type: "commonjs" }));
  transpile("pages/payments/paymentConstants.ts");
  transpile("pages/payments/dailyIncomeRules.ts");
  const { buildPendingCashRowsByTeam } = require(path.join(tmp, "src", "pages", "payments", "dailyIncomeRules.js"));
  const payment = (id, amount, team, moneyDelivered, dateApplied = "2026-08-13", method = "Efectivo") => ({
    id, amountReceived: amount, collectionTeam: team, moneyDelivered, dateApplied, paymentMethod: method, createdAt: `${dateApplied}T12:00:00.000Z`
  });
  const grouped = buildPendingCashRowsByTeam([
    payment("pty-today", 10, "PTY", false),
    payment("pty-previous", 15, "PTY", false, "2026-08-12"),
    payment("wc", 20, "WC", false),
    payment("delivered", 99, "PTY", true),
    payment("bank", 50, "WC", false, "2026-08-13", "ACH Express"),
    payment("future", 40, "WC", false, "2026-08-14"),
    payment("unknown", 5, undefined, false)
  ], "2026-08-13");
  assert(grouped.PTY.reduce((sum, item) => sum + item.amountReceived, 0) === 25, "PTY debe incluir pendientes de hoy y dias anteriores.");
  assert(grouped.WC.reduce((sum, item) => sum + item.amountReceived, 0) === 20, "WC debe incluir solo efectivo pendiente hasta la fecha.");
  assert(grouped.unassigned.reduce((sum, item) => sum + item.amountReceived, 0) === 5, "El efectivo sin equipo debe quedar alertado aparte.");
  const panelSource = fs.readFileSync(path.join(root, "src", "pages", "payments", "DailyIncomePanel.tsx"), "utf8");
  assert(panelSource.includes("filterPendingCashByTeam(item.team)"), "La tarjeta del equipo debe activar su filtro.");
  assert(panelSource.includes("markTeamCashDelivered(item.team)"), "Cada equipo debe permitir marcar todos sus cobros como entregados.");
  assert(panelSource.includes("new Set(pendingCashByTeam[team].map"), "La entrega masiva debe limitarse al efectivo pendiente del equipo.");
  console.log("OK ingresos por equipo: PTY, WC y efectivo sin asignar quedan consolidados.");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
