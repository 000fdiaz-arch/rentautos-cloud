const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const page = fs.readFileSync(path.join(root, "src/pages/ReceivablesPage.tsx"), "utf8");
const row = fs.readFileSync(path.join(root, "src/pages/receivables/ReceivableTableRow.tsx"), "utf8");

assert.ok(page.includes("STREET_MANAGEMENT_SAVE_DEBOUNCE_MS = 650"), "El guardado debe agrupar escritura continua.");
assert.ok(page.includes("streetPersistQueueRef.current.catch(() => undefined).then(run)"), "Los guardados deben ejecutarse en orden.");
assert.ok(page.includes("if (!streetPersistPendingRef.current) return;"), "Un desmontaje sin cambios no debe guardar un estado vacio.");
assert.ok(page.includes('window.addEventListener("pagehide", flushStreetManagementPersist)'), "Debe guardar al abandonar la pagina.");
assert.ok(page.includes('document.addEventListener("visibilitychange", flushWhenHidden)'), "Debe guardar al ocultar la pagina.");
assert.equal((row.match(/onBlur=\{onPersistPendingChanges\}/g) ?? []).length, 2, "Ambos editores de notas deben guardar al perder foco.");
assert.ok(row.includes("onPersistPendingChanges();"), "La hora de contacto debe guardar al perder foco.");

console.log("OK persistencia: debounce, cola serial y vaciado al salir o perder foco protegidos.");
