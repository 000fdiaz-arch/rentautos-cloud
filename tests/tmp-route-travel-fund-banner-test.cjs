const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const routePage = fs.readFileSync(path.join(root, "src/pages/RouteSearchPage.tsx"), "utf8");
const routeCard = fs.readFileSync(path.join(root, "src/pages/RouteCollectionCard.tsx"), "utf8");
const styles = fs.readFileSync(path.join(root, "src/styles.css"), "utf8");

assert(routePage.includes("client.travelFundBalance ?? 0"), "Ruta en calle debe usar el fondo de viaje actual del cliente.");
assert(routePage.includes("travelFundBalance={travelFundBalanceByClient.get(item.clientId) ?? 0}"), "La tarjeta debe recibir el fondo correspondiente al cliente.");
assert(routeCard.includes('view === "work" && props.travelFundBalance > 0'), "El cintillo debe aparecer solo en Trabajo y cuando exista fondo disponible.");
assert(routeCard.includes("Fondo de viaje disponible"), "El cintillo debe identificar claramente el fondo de viaje.");
assert(styles.includes(".route-collection-travel-fund"), "El cintillo debe tener un estilo visual propio.");

console.log("tmp-route-travel-fund-banner-test: ok");
