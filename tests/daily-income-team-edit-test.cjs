const fs = require("node:fs");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const panel = fs.readFileSync("src/pages/payments/DailyIncomePanel.tsx", "utf8");
const storage = fs.readFileSync("src/storage/coreStorage.ts", "utf8");
const types = fs.readFileSync("src/types.ts", "utf8");

assert(panel.includes('<label>Delta'), "El editor de ingresos debe mostrar el selector de Delta.");
assert(panel.includes('<option value="delta1">Delta 1</option>') && panel.includes('<option value="delta2">Delta 2</option>') && panel.includes('<option value="delta3">Delta 3</option>'), "El selector debe ofrecer los tres Delta.");
assert(panel.includes("collectionDelta: nextTeam || undefined"), "La corrección debe actualizar el Delta del pago.");
assert(panel.includes("previousCollectionTeam: teamChanged"), "La corrección debe auditar el equipo anterior.");
assert(panel.includes("nextCollectionTeam: teamChanged"), "La corrección debe auditar el equipo nuevo.");
assert(panel.includes("Cobro en Ruta · ${collectionDeltaLabel(nextTeam)}"), "El comentario automático de ruta debe mantenerse sincronizado.");
assert(storage.includes("previousCollectionTeam: raw.previousCollectionTeam === \"PTY\""), "La auditoría del equipo debe conservarse al cargar los pagos.");
assert(types.includes("previousCollectionDelta?: CollectionDelta"), "El modelo debe declarar la auditoría del cambio de Delta.");

console.log("OK ingresos: edición Delta 1/2/3, comentario y auditoría configurados.");
