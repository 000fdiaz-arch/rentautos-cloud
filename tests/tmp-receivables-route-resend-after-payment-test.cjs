const fs = require("node:fs");
const path = require("node:path");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const sourcePath = path.resolve(__dirname, "../src/pages/ReceivablesPage.tsx");
const source = fs.readFileSync(sourcePath, "utf8");

function sourceSection(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert(start >= 0, `No se encontro el inicio de la seccion: ${startMarker}`);
  assert(end > start, `No se encontro el final de la seccion: ${endMarker}`);
  return source.slice(start, end);
}

const removalRule = sourceSection(
  "function routeRemovalBlocksRecord",
  "export default function ReceivablesPage"
);
assert(removalRule.includes("removedAt > reassignedAt"), "La salida solo debe bloquear una asignacion mas antigua.");
assert(removalRule.includes("record?.routeReleaseUpdatedAt"), "La regla debe considerar la fecha del nuevo minimo de ruta.");
assert(removalRule.includes("record?.routeAssignmentUpdatedAt"), "La regla debe considerar la fecha de reasignacion de ruta.");

const downloadFlow = sourceSection(
  "async function handleDownloadPublishedRoute",
  "async function handleSaveCollectionCut"
);
assert(downloadFlow.includes("exportRouteCollection"), "Descargar ruta debe ser una accion separada.");
assert(downloadFlow.includes("loadCloudActiveRouteItems(dataOwnerUserId)"), "La descarga debe releer la ruta vigente.");
assert(downloadFlow.includes("getRouteWorkItems"), "La descarga debe aplicar las reglas vigentes de trabajo en ruta.");
assert(downloadFlow.includes("loadRoutePaymentReports(dataOwnerUserId, { reviewOnly: true })"), "La descarga debe excluir unidades en revision sin leer todo el historial.");
assert(downloadFlow.includes("exportRouteCollection"), "La descarga debe exportar la lista verificada.");

console.log("OK reenvio a ruta: salidas antiguas no bloquean y la descarga usa la ruta vigente verificada.");
