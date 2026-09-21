const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const operations = fs.readFileSync(path.join(root, "src/cloud/operationsCloudData.ts"), "utf8");
const reports = fs.readFileSync(path.join(root, "src/cloud/routeReportCloudData.ts"), "utf8");
const client = fs.readFileSync(path.join(root, "src/cloud/cloudClient.ts"), "utf8");

assert.ok(client.includes("const inflightLoads = new Map"), "La deduplicacion debe limitarse a solicitudes en curso.");
assert.ok(client.includes("inflightLoads.delete(key)"), "Una solicitud terminada no debe dejar datos en cache.");
assert.ok(
  operations.includes("`array-rows:${table}:${userId}`"),
  "Las colecciones deben separarse por tabla y propietario."
);
assert.ok(
  operations.includes("`active-route-items:${userId}`"),
  "La ruta activa debe separarse por propietario."
);
assert.ok(
  reports.includes('`route-payment-reports:${ownerId}:') && reports.includes('reviewOnly ? "review" : "all"'),
  "Los reportes deben separar propietario y modalidad."
);

console.log("OK deduplicacion: solo comparte lecturas simultaneas y conserva aislamiento por propietario.");
