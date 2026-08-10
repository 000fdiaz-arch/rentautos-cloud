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
  "async function handleExportCobroEnRuta",
  "async function handleSaveCollectionCut"
);
assert(sendFlow.includes("loadCloudStreetManagement(dataOwnerUserId)"), "El envio debe releer la gestion vigente.");
assert(sendFlow.includes("loadCloudActiveRouteItems(dataOwnerUserId)"), "El envio debe releer las salidas vigentes.");
assert(
  sendFlow.includes("!routeRemovalBlocksRecord(record, removedItemByClientForSend.get(row.id))"),
  "Una salida antigua no debe excluir una reasignacion nueva."
);
assert(sendFlow.includes("const routeRowsForSend = baseRows.filter"), "Descarga y publicacion deben compartir una sola lista.");
assert(sendFlow.includes("rows: routeRowsForSend"), "El archivo debe contener exactamente la lista que se publica.");

const publishIndex = sendFlow.indexOf("await publishCloudActiveRouteItems");
const verifyIndex = sendFlow.indexOf("const verifiedActiveRouteItems = await loadCloudActiveRouteItems", publishIndex);
const exportIndex = sendFlow.indexOf("const exported = await exportRouteCollection", verifyIndex);
assert(publishIndex >= 0, "El flujo debe publicar la ruta.");
assert(verifyIndex > publishIndex, "El flujo debe verificar la nube despues de publicar.");
assert(exportIndex > verifyIndex, "La descarga solo debe iniciar despues de verificar la publicacion.");
assert(
  sendFlow.includes("No se pudo confirmar la publicacion de la ruta. No se descargo ningun archivo"),
  "Una falla de publicacion debe explicar que no hubo descarga."
);

console.log("OK reenvio a ruta: una salida por pago antigua no bloquea la reasignacion y la descarga ocurre tras verificar.");
