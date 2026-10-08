import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const card = readFileSync(join(root, "src/pages/RouteCollectionCard.tsx"), "utf8");
const page = readFileSync(join(root, "src/pages/RouteSearchPage.tsx"), "utf8");

assert.match(card, /⏱ En ruta · \{routeElapsedSince\(item\.publishedAt, props\.elapsedNow\)\}/,
  "La tarjeta debe mostrar el tiempo transcurrido desde la publicación vigente.");
assert.match(card, /title=\{`Desde \$\{when\(item\.publishedAt\)\}`\}/,
  "El indicador debe conservar la fecha y hora exactas como ayuda.");
assert.match(card, /if \(minutes < 60\) return `\$\{minutes\} min`/,
  "El tiempo debe expresarse en minutos durante la primera hora.");
assert.match(card, /return `\$\{days\} d\$\{remainingHours/,
  "El tiempo debe expresarse en días para rutas prolongadas.");
assert.match(page, /setInterval\(\(\) => setElapsedNow\(Date\.now\(\)\), 30_000\)/,
  "El contador visible debe actualizarse automáticamente cada 30 segundos.");

console.log("OK ruta: tiempo visible desde la publicación y actualización automática.");
