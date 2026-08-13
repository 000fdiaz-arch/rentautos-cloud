const fs = require("node:fs");
const path = require("node:path");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const root = path.resolve(__dirname, "..");
const shell = fs.readFileSync(path.join(root, "src", "AppShell.tsx"), "utf8");
const route = fs.readFileSync(path.join(root, "src", "pages", "RouteSearchPage.tsx"), "utf8");
const cloud = fs.readFileSync(path.join(root, "src", "cloud", "clientCloudData.ts"), "utf8");

assert(cloud.includes("export async function loadCloudClient"), "Debe poder cargar un cliente individual actualizado.");
assert(shell.includes("await loadCloudClient(cloudDataUserId, input.clientId)"), "El cobro en ruta debe usar el saldo fresco de nube.");
assert(shell.includes("clients: paymentClients"), "La transacción debe calcularse con el cliente actualizado.");
assert(route.includes('buildCloudErrorMessage("No se pudo registrar el pago."'), "El formulario debe mostrar el motivo real devuelto por Supabase.");

console.log("OK cobro en ruta: usa cliente fresco y muestra el motivo real de guardado.");
