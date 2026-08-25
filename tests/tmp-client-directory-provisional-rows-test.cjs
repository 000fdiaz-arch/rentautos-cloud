const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const panel = fs.readFileSync(
  path.join(root, "src/pages/clients/ClientsDirectoryPanel.tsx"),
  "utf8"
);

assert(
  panel.includes('`client-${client.id}-${assignmentKind ?? "unassigned"}-${unitId}`'),
  "Cada asignacion regular o provisional debe tener una clave de fila unica."
);
assert(
  !panel.includes('<tr key={client?.id ?? `fleet-${unitId}`}'),
  "La tabla no debe reutilizar client.id para dos unidades del mismo cliente."
);
assert(
  panel.includes("Unidad principal: {primaryUnitId"),
  "La fila provisional debe identificar la unidad principal del cliente."
);
assert(
  panel.includes("Provisional activo") && panel.includes("activeProvisionalUnitId"),
  "La fila principal debe identificar su unidad provisional activa."
);
assert(
  panel.includes("const visibleClientCount = new Set("),
  "El contador debe contar clientes unicos y no asignaciones."
);

console.log("OK directorio de clientes: filas regular/provisional unicas y relacionadas.");
