const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "priority-payment-index-"));
const output = path.join(temp, "priority.cjs");
const command = process.platform === "win32" ? "cmd.exe" : "npx";
const args = process.platform === "win32"
  ? ["/c", "npx", "esbuild", "src/pages/receivables/receivablesPriority.ts", "--bundle", "--platform=node", "--format=cjs", `--outfile=${output}`]
  : ["esbuild", "src/pages/receivables/receivablesPriority.ts", "--bundle", "--platform=node", "--format=cjs", `--outfile=${output}`];

try {
  const built = spawnSync(command, args, { cwd: root, encoding: "utf8", windowsHide: true });
  if (built.status !== 0) throw new Error(built.stderr || built.stdout);
  const { buildPriorityReceivables } = require(output);
  const now = new Date("2026-09-21T12:00:00");
  const client = {
    id: "c1", unitId: "A-10", name: "María Pérez", cedula: "8-123-456", rentAmount: 35,
    frequency: "daily", installmentsPaid: 20, balance: 70, status: "activo", otherCharges: [],
    advanceBalance: 0, savings: 0, createdAt: "2026-08-01T12:00:00", installmentsAgreed: 100,
    installmentsIssued: 22, installmentsRemaining: 80
  };
  const row = {
    id: "c1", unitId: "A-10", name: "María Pérez", cedula: "8-123-456", hasActiveClient: true,
    operationalStatus: "activo", overdueBalance: 70, totalPending: 70, rentAmount: 35, daysLate: 2,
    plan: "daily", recentPayments: []
  };
  const payments = [
    { id: "old", clientId: "c1", clientUnit: "A-10", clientName: "María Pérez", clientCedula: "8-123-456", createdAt: "2026-09-18T10:00:00", dateApplied: "2026-09-18", amountReceived: 20, appliedToRent: 20 },
    { id: "wrong-person", clientId: "other", clientUnit: "A10", clientName: "Otra Persona", clientCedula: "8-999-999", createdAt: "2026-09-21T10:00:00", dateApplied: "2026-09-21", amountReceived: 99, appliedToRent: 99 },
    { id: "historical", clientId: "legacy", clientUnit: "A10", clientName: "Maria Perez", clientCedula: "8-123-456", createdAt: "2026-09-20T10:00:00", dateApplied: "2026-09-20", amountReceived: 35, appliedToRent: 35 }
  ];
  const result = buildPriorityReceivables([row], [client], payments, {}, now);
  assert.equal(result.length, 1);
  assert.equal(result[0].lastPayment.dateApplied, "2026-09-20", "Debe conservar la coincidencia historica por unidad e identidad.");
  assert.equal(result[0].lastPayment.amountReceived, 35, "No debe tomar un pago mas nuevo de otra persona en la misma unidad.");
  console.log("OK prioridad indexada: conserva coincidencia por cliente, unidad e identidad.");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
