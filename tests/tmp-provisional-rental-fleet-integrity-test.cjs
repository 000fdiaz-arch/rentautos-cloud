const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const clientsPage = fs.readFileSync(path.join(root, "src/pages/ClientsPage.tsx"), "utf8");
const directory = fs.readFileSync(path.join(root, "src/pages/clients/ClientsDirectoryPanel.tsx"), "utf8");
const migration = fs.readFileSync(path.join(root, "supabase/migrations/20260926000100_provisional_rental_fleet_integrity.sql"), "utf8");

const persistStart = clientsPage.indexOf("async function persistProvisionalRentalState");
const persistEnd = clientsPage.indexOf("async function handleAssignProvisionalRental", persistStart);
const persistBlock = clientsPage.slice(persistStart, persistEnd);

assert.match(persistBlock, /const savedClient = await saveProvisionalRentalState/);
assert.match(persistBlock, /if \(onClientsRefresh\) await onClientsRefresh\(\)/);
assert.equal(
  (persistBlock.match(/client\.id === current\.id \? nextClient : client/g) || []).length,
  1,
  "nextClient solo debe persistirse en modo local, no despues de la RPC cloud."
);

assert.match(directory, /fleetStatus = String\(vehicle\?\.operational_status/);
assert.match(directory, /Provisional sin cliente/);
assert.match(directory, /isUnassignedUnitAvailable/);
assert.doesNotMatch(directory, /\) : \(\s*<span className="badge badge-warning">Libre<\/span>/);

assert.match(migration, /sync_provisional_rental_fleet_state/);
assert.match(migration, /activeProvisionalRental,unitId/);
assert.match(migration, /not exists \([\s\S]*from public\.clients_cloud/);
assert.match(migration, /then lower\(coalesce\(c\.data->>'status', 'activo'\)\)/);

console.log("OK alquiler provisional: guardado unico, estado real visible y reconciliacion automatica presentes.");
