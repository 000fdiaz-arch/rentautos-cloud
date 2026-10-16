const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const ledger = fs.readFileSync(path.join(root, "src/pages/receivables/ReceivablesLedgerTable.tsx"), "utf8");
const styles = fs.readFileSync(path.join(root, "src/styles.css"), "utf8");

assert.match(ledger, /RECEIVABLE_ROWS_COMPACT_PAGE_SIZE = 15/, "La vista compacta debe limitar las tarjetas visibles.");
assert.match(ledger, /RECEIVABLE_COMPACT_VIEW_QUERY = "\(max-width: 900px\)"/, "La paginación debe cubrir tablet vertical y celular.");
assert.match(ledger, /rows\.slice\(compactPageStart, compactPageStart \+ RECEIVABLE_ROWS_COMPACT_PAGE_SIZE\)/, "La vista compacta debe renderizar solo la página actual.");
assert.match(ledger, /aria-label="Páginas de clientes en cuentas por cobrar"/, "La paginación debe ser identificable para tecnologías de asistencia.");
assert.match(ledger, /Página \{currentCompactPage \+ 1\} de \{compactPageCount\}/, "La pantalla debe informar la página actual.");
assert.match(ledger, /scrollIntoView\(\{ block: "start" \}\)/, "Cambiar de página debe devolver al inicio de la lista.");
assert.match(styles, /\.ar-ledger-pagination-button[\s\S]*?min-height: 44px/, "Los controles de paginación deben tener un objetivo táctil suficiente.");

console.log("OK responsive de cuentas por cobrar: paginación compacta, estado visible y objetivos táctiles.");
