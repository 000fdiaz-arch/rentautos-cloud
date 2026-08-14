const fs = require("node:fs");
const path = require("node:path");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const source = fs.readFileSync(path.resolve(__dirname, "..", "src", "pages", "RouteSearchPage.tsx"), "utf8");
const rules = fs.readFileSync(path.resolve(__dirname, "..", "src", "routeReviewRules.ts"), "utf8");

assert(source.includes('useState<"all" | "review">("all")'), "Debe existir el estado del filtro de unidades por revisar.");
assert(rules.includes("payment.dateApplied === dateKey"), "El filtro debe considerar solamente pagos aplicados en el dia.");
assert(rules.includes("payment.clientId === item.clientId"), "La suma diaria debe pertenecer al cliente de la ruta.");
assert(rules.includes("sum + Math.max(0, payment.appliedToRent)"), "El filtro debe sumar solamente lo aplicado a renta.");
assert(rules.includes("confirmedRentAmount <= 0 || confirmedRentAmount >= item.releaseAmount"), "Solo deben revisarse montos mayores a cero y menores al minimo para liberar.");
assert(source.includes("routeRentAmountForDay(payments, item, businessDateKey) < item.releaseAmount"), "La salida debe comparar el minimo con la suma diaria aplicada a renta.");
assert(!rules.includes("sum + payment.amountReceived"), "El total recibido no debe contar como renta.");
assert(source.includes('paymentFilter === "all" || hasPendingPartialRouteDecision(payments, item, businessDateKey)'), "El filtro debe limitar la lista a decisiones pendientes.");
assert(source.includes("Unidades a revisar ({reviewUnitCount})"), "El boton debe indicar claramente las unidades que requieren accion.");
assert(rules.includes("item.partialDecisionRentAmount"), "Una decision ya tomada debe sacar la unidad del conteo de revision.");
assert(source.includes('aria-label="Filtrar por estado de pago"'), "El filtro debe ser accesible.");

console.log("OK ruta: el filtro suma lo aplicado a renta en los pagos del dia.");
