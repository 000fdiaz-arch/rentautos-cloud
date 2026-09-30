const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const panel = fs.readFileSync(path.join(root, "src/pages/clients/ClientsDirectoryPanel.tsx"), "utf8");
const cards = fs.readFileSync(path.join(root, "src/pages/clients/ClientsDirectoryCards.tsx"), "utf8");
const styles = fs.readFileSync(path.join(root, "src/styles.css"), "utf8");

assert.match(panel, /const DIRECTORY_PAGE_SIZE = 15;/, "Clientes debe paginar el directorio para limitar el DOM.");
assert.match(panel, /sortedRows\.slice\(pageStart, pageStart \+ DIRECTORY_PAGE_SIZE\)/, "La tabla actual debe usar solo la pagina visible.");
assert.match(panel, /<ClientsDirectoryCards/, "El directorio debe incluir una presentacion responsiva por tarjetas.");
assert.match(cards, /client-card-actions/, "Las tarjetas deben conservar las acciones del cliente.");
assert.match(cards, /client-card-details/, "Las tarjetas deben plegar los datos secundarios para mejorar el escaneo.");
assert.match(cards, /client-card-actions-menu/, "Las acciones secundarias deben agruparse en un menu.");
assert.match(cards, /onBalanceChange/, "Las tarjetas deben conservar la edicion rapida de saldo.");
assert.match(styles, /@media \(max-width: 1500px\)[\s\S]*?\.clients-luxury-page \.client-directory-desktop[\s\S]*?display: none;/,
  "La tabla ancha debe ocultarse cuando el espacio de laptop es insuficiente.");
assert.match(styles, /\.clients-luxury-page \.client-card-actions \.button[\s\S]*?min-height: 44px;/,
  "Las acciones tactiles deben medir al menos 44px.");
assert.match(styles, /grid-template-columns: repeat\(6, minmax\(125px, 1fr\)\) auto auto;/,
  "Los filtros de escritorio deben usar una cuadricula explicita valida.");
assert.match(styles, /client-directory-filter-toggle[\s\S]*?min-height: 48px;/,
  "Los filtros deben poder plegarse desde una superficie tactil comoda.");

console.log("OK directorio de clientes: paginacion, tarjetas compactas, filtros y controles tactiles.");
