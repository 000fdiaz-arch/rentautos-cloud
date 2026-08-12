const fs = require("node:fs");
const path = require("node:path");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function read(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, "..", relativePath), "utf8");
}

function section(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert(start >= 0, `No se encontro: ${startMarker}`);
  assert(end > start, `No se encontro el final de: ${startMarker}`);
  return source.slice(start, end);
}

const rules = read("src/pages/receivables/receivablesPageRules.ts");
const page = read("src/pages/ReceivablesPage.tsx");
const row = read("src/pages/receivables/ReceivableTableRow.tsx");
const ledger = read("src/pages/receivables/ReceivablesLedgerTable.tsx");
const cloud = read("src/cloud/operationsCloudData.ts");
const routeSearch = read("src/pages/RouteSearchPage.tsx");

const dailyOptions = section(rules, "export const DAILY_COLLECTION_STATUS_OPTIONS", "export const ROUTE_COLLECTION_STATUS_OPTIONS");
assert(!dailyOptions.includes('option.value === "route"'), "Cobro en ruta no debe seguir siendo un estado diario.");

const routeOptions = section(rules, "export const ROUTE_COLLECTION_STATUS_OPTIONS", "export const REGULAR_COLLECTION_STATUS_OPTIONS");
assert(routeOptions.includes('{ value: "pending"'), "Ruta en calle debe mostrar Pendiente.");
assert(!routeOptions.includes('value: "paid"'), "Cobrado no debe estar disponible mientras tenga la etiqueta En ruta.");
assert(!routeOptions.includes('value: "call_later"'), "Reprogramado no debe estar disponible mientras tenga la etiqueta En ruta.");

const parser = section(rules, "function parseStoredCollectionRecord", "export function parseCollectionStatusMapFromStorage");
assert(parser.includes('const normalizedStatus: CollectionStatus = isRouteTagged ? "pending" : status'), "Los estados antiguos de ruta deben migrar a Pendiente.");
assert(parser.includes("legacyRouteStatus"), "La migracion debe reconocer registros antiguos de ruta.");

const routeRemoval = section(page, "function buildPendingRouteRecord", "function routeRemovalBlocksRecord");
assert(routeRemoval.includes('status: "pending"'), "Salir de ruta debe dejar Pendiente.");
assert(routeRemoval.includes("isRouteTagged: false"), "Salir de ruta debe quitar la etiqueta.");

const routeActivation = section(page, "function handleRouteTagChange", "function handleRouteWorkflowStatusChange");
assert(routeActivation.includes('status: "pending"'), "Agregar la etiqueta debe forzar Pendiente.");
assert(routeActivation.includes("isRouteTagged: true"), "Agregar a ruta debe guardar la etiqueta.");
assert(routeActivation.includes("hasActiveOperationalClient(routeCandidate)"), "Una cuenta no activa no debe poder recibir la etiqueta En ruta.");

const activeRouteSync = section(page, "function buildManagementRecordFromActiveRouteItem", "function syncActiveRouteItemsToManagement");
assert(activeRouteSync.includes('status: "pending"'), "Ruta en calle debe sincronizarse como Pendiente.");
assert(activeRouteSync.includes("isRouteTagged: true"), "Ruta en calle debe conservar la etiqueta.");

const clearManagement = section(page, "async function clearLiveCollectionStatusAfterClosure", "async function handleClearCollectionManagement");
assert(clearManagement.includes("if (!record.isRouteTagged) continue"), "Limpiar gestion debe conservar las cuentas etiquetadas En ruta.");
assert(clearManagement.includes('status: "pending"'), "Limpiar gestion debe conservar las rutas como Pendiente.");

assert(row.includes("disabled={isTodayCollectionClosed || isRouteTagged}"), "Los otros estados deben bloquearse mientras tenga la etiqueta.");
assert(row.includes('En ruta{routeUrgency !== "normal"') && row.includes("Enviar a ruta"), "La gestion debe ofrecer un control de etiqueta independiente.");
assert(row.includes("ar-route-tag-toggle--${routeUrgency}"), "La urgencia debe integrarse visualmente en la etiqueta En ruta.");
assert(row.includes("isRouteTagged || canSendToRoute"), "Enviar a ruta debe ocultarse para las cuentas no activas.");
assert(row.includes("ar-route-compact-summary"), "La tarjeta debe mostrar un resumen compacto de la ruta.");
assert(row.includes("Libera con") && row.includes("routeAssignment") && row.includes("routeUrgencyLabel"), "El resumen debe mostrar saldo, ruta y urgencia.");
assert(row.includes("ar-route-preparation-modal"), "La preparacion completa debe abrirse en un modal.");
assert(row.includes("Saldo para liberar de ${row.unitId}"), "El saldo para liberar debe poder editarse desde el modal.");
assert(ledger.includes("Pendiente · En ruta"), "Ruta en calle debe mostrar Pendiente y la etiqueta sin selector de resultados.");
assert(page.includes("routeTagFilter"), "Gestion debe incluir un filtro directo por la etiqueta En ruta.");
assert(page.includes("routeTaggedManagementCount"), "El filtro directo debe mostrar el total de cuentas en ruta.");
assert(!page.includes("Ruta para enviar"), "La vista redundante Ruta para enviar debe desaparecer.");
assert(page.includes("Publicar ruta (${routeWorkflowRowsCount})"), "Gestion debe permitir publicar las cuentas preparadas para ruta.");
assert(page.includes('workflowTab === "route" ? ('), "La pestaña de ruta debe abrir directamente Ruta en calle.");
assert(row.includes('isRoutePreparationComplete ? "Ver detalles" : "Completar ruta"'), "El acceso al modal debe indicar si falta completar la ruta.");
assert(row.includes("onRouteAssignmentChange") && row.includes("onRouteUrgencyChange"), "Gestion debe permitir definir ruta y urgencia.");
assert(row.includes("onRouteManagementTypeChange") && row.includes("onRouteManagementCommentChange"), "Gestion debe permitir definir tipo y comentario de ruta.");

const releaseAmountChange = section(page, "function handleRouteReleaseAmountChange", "function handleCollectionCutCommentChange");
assert(releaseAmountChange.includes("const nextAmount = parsedAmount ?? undefined;"), "Borrar Libera con no debe recuperar el monto publicado anterior.");
assert(releaseAmountChange.includes("releaseAmount: nextAmount ?? 0"), "Ruta en calle debe conservar la cuenta con el monto marcado como pendiente.");
assert(cloud.includes("releaseAmount < 0"), "La nube debe aceptar cero como marcador temporal de monto pendiente.");
assert(routeSearch.includes("item.releaseAmount <= 0"), "Un monto pendiente no debe liberar automaticamente la cuenta por un pago.");
assert(routeSearch.includes('"Monto pendiente"'), "Ruta en calle debe mostrar que el monto sigue pendiente.");
assert(page.includes("hasActiveOperationalClient(row) &&\n          record?.isRouteTagged"), "La publicacion debe excluir cuentas no activas aunque tengan una etiqueta antigua.");

console.log("OK receivables route tag: cuatro estados, Pendiente bloqueado y migracion compatible.");
