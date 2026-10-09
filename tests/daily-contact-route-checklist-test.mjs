import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const rowSource = readFileSync("src/pages/receivables/ReceivableTableRow.tsx", "utf8");
const checklistStart = rowSource.indexOf('className="ar-daily-contact-checklist"');
const checklistEnd = rowSource.indexOf("{dailyContactSaveState ?", checklistStart);

assert.ok(checklistStart >= 0 && checklistEnd > checklistStart, "Debe existir el checklist diario de contacto.");

const checklistSource = rowSource.slice(checklistStart, checklistEnd);

assert.match(
  checklistSource,
  /disabled=\{isTodayCollectionClosed \|\| isFutureShift \|\| saveState === "saving"\}/,
  "El checklist debe conservar los bloqueos por cierre, turno futuro y guardado en curso."
);
assert.doesNotMatch(
  checklistSource,
  /isRouteTagged/,
  "Estar en ruta no debe bloquear los ganchos de contacto."
);
assert.match(
  checklistSource,
  /onDailyContactAttemptChange\(row\.id, option\.key, event\.target\.checked \? "contacted" : "pending"\)/,
  "Los tres turnos deben seguir enviando su cambio al guardado en nube."
);

console.log("OK checklist de contacto: una unidad en ruta conserva AM, PM y Noche habilitados.");
