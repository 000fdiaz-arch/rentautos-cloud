const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const navigation = fs.readFileSync(path.join(root, "src/app/AppNavigation.tsx"), "utf8");
const styles = fs.readFileSync(path.join(root, "src/styles.css"), "utf8");

assert(navigation.includes("app-nav-mobile-tabs"), "Debe existir una navegacion dedicada para celulares.");
assert(navigation.includes("primaryOrder"), "Los accesos operativos principales deben permanecer visibles.");
assert(navigation.includes('<b>Más</b>'), "Las opciones secundarias deben estar disponibles desde Mas.");
assert(navigation.includes("app-nav-mobile-signout"), "Cerrar sesion debe seguir accesible en celular.");
assert(navigation.includes("tab.badge"), "Las notificaciones deben conservarse en la barra inferior.");
assert(styles.includes("bottom: 0;"), "La navegacion movil debe fijarse en la parte inferior.");
assert(styles.includes("env(safe-area-inset-bottom)"), "La barra debe respetar el area segura de celulares.");
assert(styles.includes("padding-bottom: calc(84px"), "El contenido no debe quedar tapado por la barra inferior.");

console.log("tmp-mobile-bottom-navigation-test: ok");
