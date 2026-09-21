const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "src/pages/receivables/ReceivablesLedgerTable.tsx"), "utf8");

assert.ok(source.includes("RECEIVABLE_ROWS_PAGE_SIZE = 75"), "El bloque inicial debe tener un limite explicito.");
assert.ok(source.includes("const visibleRows = rows.slice(0, visibleRowLimit)"), "La tabla debe renderizar solo el bloque visible.");
assert.equal((source.match(/visibleRows\.map\(/g) ?? []).length, 3, "Escritorio, movil y gestion deben usar el mismo bloque progresivo.");
assert.ok(source.includes("Mostrar más"), "El usuario debe poder revelar todas las filas restantes.");
assert.ok(!source.includes("rows={visibleRows}"), "La paginacion visual no debe cambiar calculos o exportaciones del padre.");

console.log("OK filas progresivas: primer bloque limitado y ampliacion sin alterar datos ni filtros.");
