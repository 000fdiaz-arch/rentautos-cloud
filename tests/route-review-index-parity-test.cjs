const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "route-review-index-"));
const output = path.join(temp, "rules.cjs");
const command = process.platform === "win32" ? "cmd.exe" : "npx";
const args = process.platform === "win32"
  ? ["/c", "npx", "esbuild", "src/routeReviewRules.ts", "--bundle", "--platform=node", "--format=cjs", `--outfile=${output}`]
  : ["esbuild", "src/routeReviewRules.ts", "--bundle", "--platform=node", "--format=cjs", `--outfile=${output}`];

try {
  const built = spawnSync(command, args, { cwd: root, encoding: "utf8", windowsHide: true });
  if (built.status !== 0) throw new Error(built.stderr || built.stdout);
  const rules = require(output);
  const payments = [
    { id: "before", clientId: "c1", dateApplied: "2026-09-21", createdAt: "2026-09-21T10:00:00Z", appliedToRent: 30 },
    { id: "after", clientId: "c1", dateApplied: "2026-09-21", createdAt: "2026-09-21T13:00:00Z", appliedToRent: 40 },
    { id: "other", clientId: "c2", dateApplied: "2026-09-21", createdAt: "2026-09-21T14:00:00Z", appliedToRent: 99 }
  ];
  const item = { clientId: "c1", publishedAt: "2026-09-21T12:00:00Z", routeStartedAt: "2026-09-21T12:00:00Z", releaseAmount: 100 };
  const reports = [{ id: "r1", client_id: "c1", published_at: item.publishedAt, status: "review" }];
  const index = rules.buildRouteReviewIndex(payments, reports);
  assert.equal(rules.routeRentAmountForDay(payments, item, "2026-09-21"), 40);
  assert.equal(rules.routeRentAmountForDay(payments, item, "2026-09-21", index), 40, "El indice debe respetar inicio de ruta y fecha.");
  assert.deepEqual(
    rules.getActiveRouteReviewItems([item], payments, "2026-09-21", reports, index),
    rules.getActiveRouteReviewItems([item], payments, "2026-09-21", reports),
    "La salida indexada debe coincidir con la publica."
  );
  console.log("OK indice de ruta: montos y decisiones conservan la misma logica.");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
