const fs = require("node:fs");
const path = require("node:path");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const pageSource = fs.readFileSync(path.resolve(__dirname, "../src/pages/ReceivablesPage.tsx"), "utf8");
const rowSource = fs.readFileSync(path.resolve(__dirname, "../src/pages/receivables/ReceivableTableRow.tsx"), "utf8");
const ledgerSource = fs.readFileSync(path.resolve(__dirname, "../src/pages/receivables/ReceivablesLedgerTable.tsx"), "utf8");

assert(pageSource.includes("function statementCedulaKey"), "Debe normalizarse la cedula para consolidar estados de cuenta.");
assert(pageSource.includes("cedula:"), "El consolidado debe agrupar principalmente por cedula.");
assert(pageSource.includes("? `phone:${phone}`"), "El consolidado debe usar el telefono como identidad principal.");
assert(pageSource.includes("baseRows.filter((row) => row.hasActiveClient)"), "El consolidado solo debe incluir autos con cliente activo.");
assert(pageSource.includes("statementGroupRowsByClient"), "Debe construirse un grupo de unidades para cada cliente.");

assert(rowSource.includes("function ConsolidatedStatementBalanceCard"), "Debe renderizarse una tarjeta consolidada.");
assert(
  rowSource.includes("rows.reduce((sum, item) => sum + Math.max(0, item.totalPending), 0)"),
  "El total consolidado debe sumar el saldo pendiente de todas las unidades."
);
assert(rowSource.includes('"AL DÍA"'), "Las unidades sin saldo deben mostrarse como AL DÍA.");
assert(rowSource.includes("Último pago:"), "Cada unidad debe mostrar su último pago.");
assert(rowSource.includes("ConsolidatedStatementBalanceCard rows={rows}"), "La imagen exportada debe utilizar la tarjeta consolidada.");
assert(ledgerSource.includes("statementGroupRows={getStatementGroupRows(row)}"), "La tabla debe entregar todas las unidades al estado de cuenta.");

console.log("OK estado de cuenta consolidado: identidad, suma, unidades al dia y exportacion validadas.");
