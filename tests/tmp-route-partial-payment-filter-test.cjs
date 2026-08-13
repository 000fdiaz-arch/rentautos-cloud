const fs = require("node:fs");
const path = require("node:path");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const source = fs.readFileSync(path.resolve(__dirname, "..", "src", "pages", "RouteSearchPage.tsx"), "utf8");

assert(source.includes('useState<"all" | "partial">("all")'), "Debe existir el estado del filtro de pagos parciales.");
assert(source.includes("payment.dateApplied === dateKey"), "El filtro debe considerar solamente pagos aplicados en el dia.");
assert(source.includes("payment.clientId === item.clientId"), "La suma diaria debe pertenecer al cliente de la ruta.");
assert(source.includes("sum + Math.max(0, payment.appliedToRent)"), "El filtro debe sumar solamente lo aplicado a renta.");
assert(source.includes("confirmedRentAmount > 0 && confirmedRentAmount < item.releaseAmount"), "La suma parcial debe ser mayor a cero y menor al minimo para liberar.");
assert(source.includes("routeRentAmountForDay(payments, item, businessDateKey) < item.releaseAmount"), "La salida debe comparar el minimo con la suma diaria aplicada a renta.");
assert(!source.includes("sum + payment.amountReceived"), "El total recibido no debe contar como renta.");
assert(source.includes('paymentFilter === "all" || hasPartialRoutePayment(payments, item, businessDateKey)'), "El filtro debe limitar la lista visible.");
assert(source.includes("Pagos parciales ({partialPaymentCount})"), "El boton debe mostrar el nombre y la cantidad de pagos parciales.");
assert(source.includes('aria-label="Filtrar por estado de pago"'), "El filtro debe ser accesible.");

console.log("OK ruta: el filtro suma lo aplicado a renta en los pagos del dia.");
