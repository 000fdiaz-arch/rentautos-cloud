const fs = require("node:fs");
const path = require("node:path");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const source = fs.readFileSync(path.resolve(__dirname, "..", "src", "pages", "RouteSearchPage.tsx"), "utf8");
const rules = fs.readFileSync(path.resolve(__dirname, "..", "src", "routeReviewRules.ts"), "utf8");

assert(source.includes('useState<RouteWorkflowView>("work")'), "Los pagos parciales deben tener su propia pestaña.");
assert(rules.includes("payment.dateApplied === dateKey"), "El filtro debe considerar solamente pagos aplicados en el dia.");
assert(rules.includes("payment.clientId === item.clientId"), "La suma diaria debe pertenecer al cliente de la ruta.");
assert(rules.includes("sum + Math.max(0, payment.appliedToRent)"), "El filtro debe sumar solamente lo aplicado a renta.");
assert(rules.includes("confirmedRentAmount <= 0 || confirmedRentAmount >= item.releaseAmount"), "Solo deben revisarse montos mayores a cero y menores al minimo para liberar.");
assert(source.includes("routeRentAmountForDay(payments, item, businessDateKey) < item.releaseAmount"), "La salida debe comparar el minimo con la suma diaria aplicada a renta.");
assert(!rules.includes("sum + payment.amountReceived"), "El total recibido no debe contar como renta.");
assert(source.includes('getActiveRouteReviewItems(items, payments, businessDateKey)'), "Los parciales deben usar toda la ruta, no solo Trabajo.");
assert(source.includes("'Pagos parciales a revisar', partialReviewItems.length"), "La pestaña debe contar las decisiones pendientes.");
assert(rules.includes("item.partialDecisionRentAmount"), "Una decision ya tomada debe sacar la unidad del conteo de revision.");
assert(source.includes('aria-label="Estado de las unidades"'), "Las pestañas deben ser accesibles.");

console.log("OK ruta: el filtro suma lo aplicado a renta en los pagos del dia.");
