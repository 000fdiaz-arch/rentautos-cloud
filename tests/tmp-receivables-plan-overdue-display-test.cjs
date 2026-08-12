const fs = require("node:fs");
const path = require("node:path");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function read(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, "..", relativePath), "utf8");
}

const row = read("src/pages/receivables/ReceivableTableRow.tsx");
const ledger = read("src/pages/receivables/ReceivablesLedgerTable.tsx");
const page = read("src/pages/ReceivablesPage.tsx");
const rules = read("src/pages/receivables/receivablesPageRules.ts");

assert(row.includes('className="ar-plan-chip-name"'), "El nombre del plan debe tener un renglon propio.");
assert(row.includes('className="ar-plan-chip-rent"'), "La letra debe mostrarse en un renglon compacto.");
assert(row.includes("Letra {formatCurrency(row.rentAmount)}"), "Plan debe mostrar el monto de la letra.");
assert(!row.includes("`Letra: ${formatCurrency(row.rentAmount)}`"), "La letra no debe repetirse fuera del cuadro Plan.");
assert(row.includes('className="ar-overdue-chip-installments"'), "Las cuotas vencidas deben mostrarse en un renglon compacto.");
assert(row.includes('className="ar-unit-client-name"'), "El nombre debe mostrarse debajo de la unidad.");
assert(row.includes('className="ar-unit-collection-meta"'), "El ultimo pago y el estado deben agruparse debajo de la unidad.");
assert(row.includes('className="ar-unit-heading"'), "El estado operativo debe mostrarse junto a la unidad.");
assert(row.includes('className="ar-unit-quick-actions"'), "Copiar estado y Sugerido deben mostrarse encima de la unidad.");
assert(row.includes("<span>Compartir estado</span>"), "La accion de estado de cuenta debe ser clara y visible.");
assert(row.includes("{!isRouteWorkflow && showStatementSuggestion ? ("), "Sugerido debe conservar su regla de visibilidad.");
assert(!row.includes('{!isRouteWorkflow ? (\n                      <div className="ar-unit-quick-actions">'), "Copiar estado de cuenta debe estar disponible para todas las cuentas.");
assert(
  (row.match(/overdueInstallmentsText\(row\.overdueBalance, row\.rentAmount\)/g) || []).length >= 2,
  "Gestion y Ruta deben mostrar monto y cuotas en Renta vencida."
);
assert(ledger.includes("overdueInstallmentsText(row.overdueBalance, row.rentAmount)"), "La tabla de ruta debe mostrar las cuotas vencidas.");
assert(page.includes("overdueInstallmentsText(item.overdueBalance, item.rentAmount)"), "Ruta en calle publicada debe mostrar las cuotas vencidas.");
assert(rules.includes('"cuota vencida" : "cuotas vencidas"'), "El conteo debe identificar claramente las cuotas como vencidas.");

console.log("OK receivables display: Plan muestra letra y Renta vencida muestra cuotas.");
