const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function applyClientUnitChange({ fleet, clients, oldClient, newClient }) {
  const nextFleet = fleet.map((unit) => ({ ...unit }));
  const newClients = clients.map((client) => client.id === newClient.id ? newClient : client);
  const oldUnitId = oldClient.unitId.trim().toUpperCase();
  const newUnitId = newClient.unitId.trim().toUpperCase();
  const newStatus = String(newClient.status || "activo").trim().toLowerCase();

  for (const unit of nextFleet) {
    if (unit.unit_id !== oldUnitId) continue;
    const hasActiveClient = newClients.some((client) => (
      client.unitId.trim().toUpperCase() === oldUnitId &&
      String(client.status || "activo").trim().toLowerCase() !== "archivado"
    ));
    if (String(unit.operational_status || "activo").toLowerCase() === "activo" && !hasActiveClient) {
      unit.operational_status = "libre";
    }
  }

  if (newStatus !== "archivado") {
    for (const unit of nextFleet) {
      if (unit.unit_id !== newUnitId) continue;
      unit.operational_status = ["activo", "taller", "chapisteria", "custodia"].includes(newStatus)
        ? newStatus
        : "activo";
    }
  }

  return nextFleet;
}

const beforeClient = { id: "client-1", unitId: "C81", status: "activo" };
const afterClient = { ...beforeClient, unitId: "D93" };
const fleet = [
  { unit_id: "C81", operational_status: "activo" },
  { unit_id: "D93", operational_status: "libre" }
];

const afterFleet = applyClientUnitChange({
  fleet,
  clients: [beforeClient],
  oldClient: beforeClient,
  newClient: afterClient
});

assert.equal(afterFleet.find((unit) => unit.unit_id === "C81").operational_status, "libre");
assert.equal(afterFleet.find((unit) => unit.unit_id === "D93").operational_status, "activo");

const migration = fs.readFileSync(
  path.join(__dirname, "..", "supabase", "44-fleet-unit-client-change-status-sync.sql"),
  "utf8"
);

assert.match(migration, /create or replace function public\.touch_fleet_unit_for_client_change\(\)/);
assert.match(migration, /not exists \(\s*select 1\s*from public\.clients_cloud/s);
assert.match(migration, /then 'libre'/);
assert.match(migration, /update public\.fleet_units_cloud f\s*set operational_status = 'libre'/);

console.log("OK fleet unit client-change status sync");
