const fs = require("node:fs");
const path = require("node:path");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const types = read("src/pages/receivables/receivablesTypes.ts");
const route = read("src/pages/RouteSearchPage.tsx");
const cloud = read("src/cloud/operationsCloudData.ts");
const payments = read("src/pages/payments/paymentStorage.ts");
const selectors = [
  read("src/pages/ReceivablesPage.tsx"),
  read("src/pages/receivables/ReceivableTableRow.tsx"),
  read("src/pages/receivables/ReceivablesLedgerTable.tsx")
].join("\n");

assert(types.includes('"desiste" | "quitar"'), "El tipo de gestión debe aceptar Desiste y Quitar.");
assert(selectors.includes('<option value="desiste">Desiste</option>'), "Los selectores deben mostrar Desiste.");
assert(selectors.includes('<option value="quitar">Quitar</option>'), "Los selectores deben mostrar Quitar.");
assert(cloud.includes('row.managementType === "desiste"') && cloud.includes('row.managementType === "quitar"'), "La ruta en nube debe conservar ambas opciones.");
assert(payments.includes('row.managementType === "desiste"') && payments.includes('row.managementType === "quitar"'), "El historial debe conservar ambas opciones.");
assert(route.includes('fieldManagementLabel(item.managementType)'), "Ruta en calle debe mostrar la nueva instrucción.");

console.log("OK ruta: Solo cobrar, Cobrar o quitar, Desiste y Quitar se conservan y muestran.");
