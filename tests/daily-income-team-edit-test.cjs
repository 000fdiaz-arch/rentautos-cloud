const fs = require("node:fs");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const panel = fs.readFileSync("src/pages/payments/DailyIncomePanel.tsx", "utf8");
const storage = fs.readFileSync("src/storage/coreStorage.ts", "utf8");
const types = fs.readFileSync("src/types.ts", "utf8");

assert(panel.includes('<label>Equipo'), "El editor de ingresos debe mostrar el selector de equipo.");
assert(panel.includes('<option value="PTY">PTY</option>') && panel.includes('<option value="WC">WC</option>'), "El selector debe limitarse a PTY y WC.");
assert(panel.includes("collectionTeam: nextTeam || undefined"), "La corrección debe actualizar el equipo del pago.");
assert(panel.includes("previousCollectionTeam: teamChanged"), "La corrección debe auditar el equipo anterior.");
assert(panel.includes("nextCollectionTeam: teamChanged"), "La corrección debe auditar el equipo nuevo.");
assert(panel.includes("Cobro en Ruta · Equipo ${nextTeam}"), "El comentario automático de ruta debe mantenerse sincronizado.");
assert(storage.includes("previousCollectionTeam: raw.previousCollectionTeam === \"PTY\""), "La auditoría del equipo debe conservarse al cargar los pagos.");
assert(types.includes("previousCollectionTeam?: CollectionTeam"), "El modelo debe declarar la auditoría del cambio de equipo.");

console.log("OK ingresos: edición PTY/WC, comentario y auditoría configurados.");
