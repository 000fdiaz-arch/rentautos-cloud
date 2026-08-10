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

const pendingBuilder = sourceSection(
  "function buildPendingRouteRecord",
  "export default function ReceivablesPage"
);
assert(pendingBuilder.includes('status: "pending"'), "La salida de ruta debe construir estado Pendiente.");
assert(!source.includes("buildCoveredRouteRecord"), "No debe existir una salida de ruta que construya estado Cubierto.");

const paymentExit = sourceSection(
  "const routeEntries = Object.entries(collectionStatusByClient)",
  "const filteredRows = useMemo"
);
assert(
  paymentExit.includes("buildPendingRouteRecord(previous"),
  "El pago del monto minimo debe sacar de ruta y dejar Pendiente."
);

const realtimeRemoval = sourceSection(
  "if (removedRouteClientIds.size === 0 || isCollectionLocked) return",
  "const routeWorkflowRowsCount = useMemo"
);
assert(
  realtimeRemoval.includes("buildPendingRouteRecord(previous"),
  "La reconciliacion en tiempo real de una salida de ruta debe conservar Pendiente."
);
assert(
  realtimeRemoval.includes("routeRemovalBlocksRecord(previous, removedItem)"),
  "Una salida antigua de ruta no debe revertir una reasignacion nueva a Cobro en ruta."
);

const routeDraftRemoval = sourceSection(
  "function handleRemoveFromRoute(clientId: string)",
  "async function handleRemoveFromPublishedRoute"
);
assert(
  routeDraftRemoval.includes("buildPendingRouteRecord(previous"),
  "Sacar desde la lista de ruta debe dejar Pendiente."
);

const publishedRouteRemoval = sourceSection(
  "async function handleRemoveFromPublishedRoute(clientId: string)",
  "function updatePublishedRouteItem"
);
assert(
  publishedRouteRemoval.includes("buildPendingRouteRecord(previous"),
  "Sacar de Ruta en calle debe dejar Pendiente."
);

console.log("OK receivables route exit: pago, sacar y sincronizacion dejan estado Pendiente.");
