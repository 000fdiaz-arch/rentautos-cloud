const fs = require("node:fs");
const path = require("node:path");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const source = fs.readFileSync(
  path.resolve(__dirname, "..", "src", "pages", "clients", "ClientFormDialogs.tsx"),
  "utf8"
);

assert(!source.includes("value={form.installmentsIssued} onChange="), "Cuotas emitidas no debe tener control editable.");
assert(!source.includes("errorFields.has(\"installmentsIssued\")"), "Cuotas emitidas no debe participar como campo editable del formulario.");
assert(source.includes("Sumatoria registrada por el sistema. Este valor no se puede editar."), "Debe explicar que el dato es automático y no editable.");
assert((source.match(/<IssuedInstallmentsSummary value=\{form\.installmentsIssued\} \/>/g) ?? []).length === 2, "El resumen debe mostrarse separado al crear y editar clientes.");

console.log("OK cuotas emitidas: resumen automático separado y sin control editable.");
