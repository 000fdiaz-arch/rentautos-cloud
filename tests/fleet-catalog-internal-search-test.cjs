const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const page = fs.readFileSync(path.join(root, "src/pages/ControlUnitsPage.tsx"), "utf8");
const publicPage = fs.readFileSync(path.join(root, "src/pages/PublicFleetCatalogPage.tsx"), "utf8");
const publicMigration = fs.readFileSync(
  path.join(root, "supabase/migrations/20261028000300_public_fleet_catalog.sql"),
  "utf8"
);

const catalogFilterStart = page.indexOf("const catalogRows = useMemo");
const catalogFilterEnd = page.indexOf("const pieData", catalogFilterStart);
const catalogFilter = page.slice(catalogFilterStart, catalogFilterEnd);

assert.match(catalogFilter, /\[row\.unit_id, row\.brand_model/,
  "El catálogo interno debe permitir filtrar por nomenclatura.");
assert.match(page, /Buscar por nomenclatura, modelo, año o transmisión/,
  "El buscador interno debe indicar que acepta nomenclaturas.");
assert.match(page, /placeholder="Ejemplo: A01 o Kia Picanto"/,
  "El buscador interno debe dar un ejemplo de nomenclatura.");
assert.doesNotMatch(publicPage, /row\.unit_id/,
  "El catálogo público no debe filtrar ni mostrar la nomenclatura privada.");
assert.doesNotMatch(publicMigration.match(/returns table \([\s\S]*?\n\)/)?.[0] ?? "", /unit_id/,
  "La función pública no debe devolver la nomenclatura.");

console.log("OK Catálogo: búsqueda interna por nomenclatura sin exponerla en el catálogo público.");
