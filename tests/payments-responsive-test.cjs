const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const tabs = fs.readFileSync(path.join(root, "src/pages/payments/PaymentsTabs.tsx"), "utf8");
const page = fs.readFileSync(path.join(root, "src/pages/PaymentsPage.tsx"), "utf8");
const styles = fs.readFileSync(path.join(root, "src/styles.css"), "utf8");

assert.match(page, /page-inner payments-page/, "Pagos debe tener un alcance CSS responsivo propio.");
assert.match(tabs, /payment-tab-select/, "La navegacion debe incluir un selector compacto para tablet y celular.");
assert.match(tabs, /aria-label="Sección de pagos"/, "El selector movil debe conservar un nombre accesible.");
assert.match(styles, /@media \(max-width: 900px\)[\s\S]*?\.payment-tabs[\s\S]*?display: none;/,
  "Las pestañas anchas deben reemplazarse en pantallas estrechas.");
assert.match(styles, /#payment-panel-history[\s\S]*?\.table-scroll tbody tr[\s\S]*?border-radius: 14px;/,
  "El historial debe convertirse en tarjetas en tablet y celular.");
assert.match(styles, /#payment-panel-notified[\s\S]*?content: "Unidad";/,
  "Los pagos notificados deben conservar etiquetas al transformarse en tarjetas.");
assert.match(styles, /#payment-panel-cards[\s\S]*?content: "Folio";/,
  "La conciliacion de tarjetas debe conservar etiquetas al transformarse en tarjetas.");
assert.match(styles, /\.payments-page button:not\(\.sort-button\)[\s\S]*?min-height: 44px;/,
  "Los controles tactiles de Pagos deben medir al menos 44px.");

console.log("OK pagos: selector movil, tarjetas responsivas y objetivos tactiles.");
