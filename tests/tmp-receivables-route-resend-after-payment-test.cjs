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

const sendFlow = sourceSection(
  "async function handlePublishCobroEnRuta",
  "async function handleDownloadPublishedRoute"
);
assert(sendFlow.includes("loadCloudStreetManagement(dataOwnerUserId)"), "El envio debe releer la gestion vigente.");
assert(sendFlow.includes("loadCloudActiveRouteItems(dataOwnerUserId)"), "El envio debe releer las salidas vigentes.");
assert(
  sendFlow.includes("!routeRemovalBlocksRecord(record, removedItemByClientForSend.get(row.id))"),
  "Una salida antigua no debe excluir una reasignacion nueva."
);
assert(sendFlow.includes("const routeRowsForSend = baseRows.filter"), "La publicacion debe construir una sola lista.");
assert(sendFlow.includes("setPublishedRouteDownload") && sendFlow.includes("rows: routeRowsForSend"), "La descarga debe conservar exactamente la lista publicada.");
assert(!sendFlow.includes("exportRouteCollection"), "Publicar la ruta no debe descargar archivos automaticamente.");

const publishIndex = sendFlow.indexOf("await publishCloudActiveRouteItems");
const verifyIndex = sendFlow.indexOf("const verifiedActiveRouteItems = await loadCloudActiveRouteItems", publishIndex);
assert(publishIndex >= 0, "El flujo debe publicar la ruta.");
assert(verifyIndex > publishIndex, "El flujo debe verificar la nube despues de publicar.");
assert(
  sendFlow.includes("No se pudo confirmar la publicacion de la ruta; puedes volver a intentar."),
  "Una falla de publicacion debe permitir reintentar."
);

const downloadFlow = sourceSection(
  "async function handleDownloadPublishedRoute",
  "async function handleSaveCollectionCut"
);
assert(downloadFlow.includes("exportRouteCollection"), "Descargar ruta debe ser una accion separada.");
assert(downloadFlow.includes("publishedRouteDownload.rows"), "La descarga debe usar la ruta ya publicada.");

console.log("OK reenvio a ruta: publicacion y descarga son pasos separados y usan la misma lista verificada.");
