const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "route-time-urgency-"));
const output = path.join(temp, "route-time-urgency.cjs");
const command = process.platform === "win32" ? "cmd.exe" : "npx";
const args = process.platform === "win32"
  ? ["/c", "npx", "esbuild", "src/routeTimeUrgency.ts", "--bundle", "--platform=node", "--format=cjs", `--outfile=${output}`]
  : ["esbuild", "src/routeTimeUrgency.ts", "--bundle", "--platform=node", "--format=cjs", `--outfile=${output}`];

try {
  const built = spawnSync(command, args, { cwd: root, encoding: "utf8", windowsHide: true });
  if (built.status !== 0) throw new Error(built.stderr || built.stdout);
  const rules = require(output);
  const now = Date.parse("2026-10-08T16:00:00Z");
  const item = (unitId, hours, urgency = "normal") => ({
    clientId: unitId,
    unitId,
    publishedAt: new Date(now - hours * 60 * 60 * 1000).toISOString(),
    urgency
  });

  assert.equal(rules.routeTimeUrgency(item("N1", 1).publishedAt, now), "normal");
  assert.equal(rules.routeTimeUrgency(item("B2", 2).publishedAt, now), "upcoming");
  assert.equal(rules.routeTimeUrgency(item("A4", 4).publishedAt, now), "attention");
  assert.equal(rules.routeTimeUrgency(item("R8", 8).publishedAt, now), "urgent");
  assert.equal(rules.effectiveRouteUrgency(item("M1", 1, "urgent"), now), "attention", "La urgencia manual no debe rebajarse por el tiempo.");
  assert.equal(rules.effectiveRouteUrgency(item("M2", 1, "very_urgent"), now), "urgent", "Muy urgente debe conservar la prioridad máxima.");

  const route = [item("N1", 1), item("B3", 3), item("A5", 5), item("R9", 9), item("R10", 10)];
  const sorted = [...route].sort((left, right) => rules.compareRouteWorkItemsByUrgency(left, right, now));
  assert.deepEqual(sorted.map(row => row.unitId), ["R10", "R9", "A5", "B3", "N1"], "Las unidades más urgentes y antiguas deben aparecer primero.");
  assert.equal(rules.countImmediateRouteTimeAlerts(route, now), 3, "La insignia debe contar atención y urgente, no la alerta azul.");
  assert.deepEqual(rules.summarizeRouteTimeUrgency(route, now), { normal: 1, upcoming: 1, attention: 1, urgent: 2 });

  const card = fs.readFileSync(path.join(root, "src/pages/RouteCollectionCard.tsx"), "utf8");
  const page = fs.readFileSync(path.join(root, "src/pages/RouteSearchPage.tsx"), "utf8");
  const shell = fs.readFileSync(path.join(root, "src/AppShell.tsx"), "utf8");
  assert.match(card, /route-collection-card--time-\$\{automaticUrgency\}/);
  assert.match(page, /compareRouteWorkItemsByUrgency\(left, right, elapsedNow\)/);
  assert.match(page, /Alertas por tiempo en ruta/);
  assert.match(shell, /countImmediateRouteTimeAlerts\(workItems, routeAlertNow\)/);

  console.log("OK ruta: urgencia progresiva, prioridad manual, orden y contador validados.");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
