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
  const { buildPendingCashRowsByDelta } = require(path.join(tmp, "src", "pages", "payments", "dailyIncomeRules.js"));
  const payment = (id, amount, delta, moneyDelivered, dateApplied = "2026-08-13", method = "Efectivo") => ({
    id, amountReceived: amount, collectionDelta: delta, moneyDelivered, dateApplied, paymentMethod: method, createdAt: `${dateApplied}T12:00:00.000Z`
  });
  const grouped = buildPendingCashRowsByDelta([
    payment("delta1-today", 10, "delta1", false),
    payment("delta1-previous", 15, "delta1", false, "2026-08-12"),
    payment("delta2", 20, "delta2", false),
    payment("delta3", 30, "delta3", false),
    payment("delivered", 99, "delta1", true),
    payment("bank", 50, "delta2", false, "2026-08-13", "ACH Express"),
    payment("future", 40, "delta2", false, "2026-08-14"),
    payment("unknown", 5, undefined, false)
  ], "2026-08-13", (item) => item.collectionDelta);
  assert(grouped.delta1.reduce((sum, item) => sum + item.amountReceived, 0) === 25, "Delta 1 debe incluir pendientes de hoy y dias anteriores.");
  assert(grouped.delta2.reduce((sum, item) => sum + item.amountReceived, 0) === 20, "Delta 2 debe incluir solo efectivo pendiente hasta la fecha.");
  assert(grouped.delta3.reduce((sum, item) => sum + item.amountReceived, 0) === 30, "Delta 3 debe incluir sus pendientes.");
  assert(grouped.unassigned.reduce((sum, item) => sum + item.amountReceived, 0) === 5, "El efectivo sin Delta debe quedar alertado aparte.");
  const panelSource = fs.readFileSync(path.join(root, "src", "pages", "payments", "DailyIncomePanel.tsx"), "utf8");
  assert(panelSource.includes("filterPendingCashByTeam(item.team)"), "La tarjeta del equipo debe activar su filtro.");
  assert(panelSource.includes("markTeamCashDelivered(item.team)"), "Cada equipo debe permitir marcar todos sus cobros como entregados.");
  assert(panelSource.includes("openDelivery(pendingCashByTeam[team])"), "La entrega masiva debe limitarse al efectivo pendiente del equipo.");
  assert(panelSource.includes("buildPendingCashRows(filteredPayments, dateKey)"), "Falta entregar debe usar la misma regla de pendientes que Ruta en calle.");
  console.log("OK ingresos por Delta: Delta 1, Delta 2, Delta 3 y efectivo sin asignar quedan consolidados.");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
