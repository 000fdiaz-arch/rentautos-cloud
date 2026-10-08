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
  assert.match(rules.formatRouteDateTime("2026-09-05T12:00:00Z"), /^05\/09\/2026, /, "La fecha debe mostrarse como día/mes/año en Panamá.");
  assert.equal(rules.routeTimeUrgency(item("B2", 2).publishedAt, now), "upcoming");
  assert.equal(rules.routeTimeUrgency(item("A4", 4).publishedAt, now), "attention");
  assert.equal(rules.routeTimeUrgency(item("R8", 8).publishedAt, now), "urgent");
  assert.ok(rules.routeTimeRedIntensity(item("B2", 2).publishedAt, now) < rules.routeTimeRedIntensity(item("A5", 5).publishedAt, now));
  assert.ok(rules.routeTimeRedIntensity(item("A5", 5).publishedAt, now) < rules.routeTimeRedIntensity(item("R9", 9).publishedAt, now), "El rojo debe intensificarse conforme aumenta el tiempo.");
  assert.equal(rules.effectiveRouteUrgency(item("M1", 1, "urgent"), now), "urgent", "La urgencia manual no debe rebajarse por el tiempo.");
  assert.equal(rules.effectiveRouteUrgency(item("M2", 1, "very_urgent"), now), "urgent", "Muy urgente debe conservar la prioridad máxima.");
  assert.ok(rules.effectiveRouteUrgencyRank(item("M2", 1, "very_urgent"), now) > rules.effectiveRouteUrgencyRank(item("M1", 12, "urgent"), now), "Muy urgente debe salir antes que urgente sin importar la antigüedad.");
  assert.ok(rules.routeVisualRedIntensity(item("M2", 1, "very_urgent"), now) > rules.routeVisualRedIntensity(item("M1", 1, "urgent"), now), "Muy urgente debe usar un rojo visualmente más intenso.");

  const route = [item("N1", 1), item("B3", 3), item("A5", 5), item("R9", 9), item("R10", 10), item("MUY", 1, "very_urgent")];
  const sorted = [...route].sort((left, right) => rules.compareRouteWorkItemsByUrgency(left, right, now));
  assert.deepEqual(sorted.map(row => row.unitId), ["MUY", "R10", "R9", "A5", "B3", "N1"], "Muy urgente debe ir primero; después se ordena por urgencia y antigüedad.");
  assert.deepEqual(rules.summarizeRouteTimeUrgency(route, now), { normal: 1, upcoming: 1, attention: 1, urgent: 3 });

  const card = fs.readFileSync(path.join(root, "src/pages/RouteCollectionCard.tsx"), "utf8");
  const page = fs.readFileSync(path.join(root, "src/pages/RouteSearchPage.tsx"), "utf8");
  const shell = fs.readFileSync(path.join(root, "src/AppShell.tsx"), "utf8");
  assert.match(card, /route-collection-card--time-progress/);
  assert.match(card, /<small>Tiempo en ruta<\/small>[\s\S]*?<strong>\{routeElapsedSince\(item\.publishedAt, props\.elapsedNow\)\}<\/strong>/,
    "La duración debe ser el dato principal de la alerta.");
  assert.match(card, /<small>Desde \{formatRouteDateTime\(item\.publishedAt\)\}<\/small>/,
    "La alerta debe explicar desde cuándo está la unidad en ruta.");
  assert.match(page, /compareRouteWorkItemsByUrgency\(left, right, elapsedNow\)/);
  assert.match(page, /Alertas por tiempo en ruta/);
  assert.doesNotMatch(shell, /countImmediateRouteTimeAlerts/, "El menú no debe sumar las alertas de tiempo.");

  console.log("OK ruta: urgencia progresiva, prioridad manual, orden y contador validados.");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
