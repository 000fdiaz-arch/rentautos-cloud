const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "src/pages/CollisionsPage.tsx"), "utf8");
const completionGuardMigration = fs.readFileSync(
  path.join(root, "supabase/migrations/20261002000100_collision_completion_guard_after_upsert.sql"),
  "utf8"
);

function section(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) throw new Error(`No se encontró la sección ${startMarker}`);
  return source.slice(start, end);
}

function assertIncludes(value, expected, message) {
  if (!value.includes(expected)) throw new Error(message);
}

function assertExcludes(value, unexpected, message) {
  if (value.includes(unexpected)) throw new Error(message);
}

const outcomeHandler = section(
  "async function applyOutcome(item: CollisionCaseRecord)",
  "function selectOutcomeEvidence"
);
assertIncludes(
  outcomeHandler,
  "El saldo de colisión permanecerá activo hasta adjuntar la resolución judicial",
  "La absolución debe informar que el saldo continúa activo hasta recibir la resolución."
);
assertExcludes(
  outcomeHandler,
  "calculateCollisionCredit",
  "Registrar el resultado del juicio no debe trasladar los abonos de colisión."
);
assertExcludes(
  outcomeHandler,
  "onClientsChange(nextClients)",
  "Registrar ABSUELTO no debe modificar el estado de cuenta del cliente."
);

const resolutionHandler = section(
  "async function saveJudicialResolution(item: CollisionCaseRecord)",
  "function startEditingResolution"
);
assertIncludes(
  resolutionHandler,
  "invoice && !invoice.creditedToRentAt",
  "La resolución debe liberar únicamente saldos que todavía no fueron procesados."
);
assertIncludes(
  resolutionHandler,
  "calculateCollisionCredit",
  "Los abonos de colisión deben trasladarse al guardar la resolución."
);
assertIncludes(
  resolutionHandler,
  "otherCharges: client.otherCharges.filter((charge) => charge.id !== invoice.chargeId)",
  "El cargo pendiente debe retirarse al guardar la resolución."
);
assertIncludes(
  resolutionHandler,
  "creditedToRentAt: now",
  "El expediente debe registrar que el saldo ya fue liberado para evitar duplicados."
);
assertIncludes(
  resolutionHandler,
  "await onClientsChange(nextClients)",
  "La liberación debe persistirse en el estado de cuenta del cliente."
);
assertIncludes(
  resolutionHandler,
  "await saveCollisionCase(dataOwnerUserId, item)",
  "Si falla el estado de cuenta, el expediente debe intentar revertirse."
);
assertIncludes(
  resolutionHandler,
  'let saveStep = "subir el archivo de la resolución"',
  "El guardado debe identificar si el fallo ocurrió durante la carga del archivo."
);
assertIncludes(
  resolutionHandler,
  "judicialResolutionFailureMessage(saveStep, error)",
  "El error de la nube debe convertirse en un mensaje visible y accionable."
);

const deleteHandler = section(
  "async function deleteJudicialResolution(item: CollisionCaseRecord)",
  "async function saveResolutionSearchDate"
);
assertIncludes(
  deleteHandler,
  "item.expenseInvoice?.creditedToRentAt",
  "No debe permitirse eliminar una resolución que ya liberó el saldo de colisión."
);

assertIncludes(
  source,
  "Guardar resolución y retirar saldo",
  "La interfaz debe explicar el efecto financiero antes de guardar la resolución."
);
assertIncludes(
  source,
  "collision-resolution-inline-message",
  "El resultado debe mostrar el progreso o error junto al botón de guardar resolución."
);
assertIncludes(
  completionGuardMigration,
  "after insert or update of data on public.collision_cases_cloud",
  "El guard de cierre debe ejecutarse después de resolver el upsert de un expediente existente."
);

console.log("OK resolución judicial: la absolución conserva el cargo y la resolución libera el saldo una sola vez.");
