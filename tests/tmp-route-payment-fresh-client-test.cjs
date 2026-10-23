const fs = require("node:fs");
const path = require("node:path");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const root = path.resolve(__dirname, "..");
const shell = fs.readFileSync(path.join(root, "src", "AppShell.tsx"), "utf8");
const route = fs.readFileSync(path.join(root, "src", "pages", "RouteSearchPage.tsx"), "utf8");
const cloud = fs.readFileSync(path.join(root, "src", "cloud", "clientCloudData.ts"), "utf8");
const routeRegistration = shell.slice(
  shell.indexOf("async function registerRoutePayment"),
  shell.indexOf("async function confirmRouteBankPayment")
);

assert(cloud.includes("export async function loadCloudClient"), "Debe poder cargar un cliente individual actualizado.");
assert(routeRegistration.includes("await Promise.all(["), "El cobro en ruta debe cargar la informacion fresca en paralelo para no aumentar la espera.");
assert(routeRegistration.includes("loadCloudClient(cloudDataUserId, input.clientId)"), "El cobro en ruta debe usar el saldo fresco de nube.");
assert(routeRegistration.includes('input.method === "cash"'), "Solo el efectivo de ruta debe consultar configuracion de retencion.");
assert(routeRegistration.includes("loadCloudOtherChargesRetention(cloudDataUserId).then((settings) => settings ?? {})"), "El cobro en ruta debe consultar la retencion vigente en nube antes de calcular.");
assert(routeRegistration.includes("clients: paymentClients"), "La transacción debe calcularse con el cliente actualizado.");
assert(routeRegistration.includes("retentionByClient: routeRetentionByClient"), "La transacción de ruta debe usar la retencion fresca y no la configuracion vieja de la sesion.");
assert(route.includes('buildCloudErrorMessage("No se pudo registrar el pago."'), "El formulario debe mostrar el motivo real devuelto por Supabase.");

console.log("OK cobro en ruta: cliente y retencion frescos se consultan en paralelo.");
