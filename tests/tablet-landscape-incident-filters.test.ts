import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const page = readFileSync(join(root, "src/pages/UnifiedIncidentsFollowUp.tsx"), "utf8");
const css = readFileSync(join(root, "src/pages/incidents/incidentFilters.css"), "utf8");
const globalCss = readFileSync(join(root, "src/styles.css"), "utf8");

assert.match(page, /const \[filtersExpanded, setFiltersExpanded\] = useState\(false\)/);
assert.match(page, /filtersExpanded \? "Ocultar filtros" : `Mostrar filtros/);
assert.match(page, /aria-expanded=\{filtersExpanded\}/);
assert.match(page, /unified-incidents-filter-groups\$\{filtersExpanded \? " is-expanded" : ""\}/);
assert.match(css, /orientation: landscape/);
assert.match(css, /max-height: 820px/);
assert.match(css, /any-pointer: coarse/);
assert.match(css, /\.unified-incidents-toolbar\s*\{[\s\S]*?position: static/);
assert.match(css, /\.unified-incidents-filter-groups\s*\{\s*display: none/);
assert.match(css, /\.unified-incidents-filter-groups\.is-expanded\s*\{\s*display: grid/);
assert.match(page, /const \[actionFiltersExpanded, setActionFiltersExpanded\] = useState\(false\)/);
assert.match(page, /className="incident-action-mobile-toggle"/);
assert.match(page, /incident-action-strip\$\{actionFiltersExpanded \? " is-mobile-expanded" : ""\}/);
assert.match(globalCss, /@media \(max-width: 1220px\)\s*\{[\s\S]*?\.unified-incident-summary/);
assert.match(globalCss, /@media \(max-width: 900px\)\s*\{[\s\S]*?\.app-nav\s*\{/);
assert.match(globalCss, /incident-action-strip:not\(\.is-mobile-expanded\) > \.incident-action-controls/);
assert.match(css, /@media \(any-pointer: coarse\)[\s\S]*?\.unified-claim-copy/);

console.log("OK responsive de siniestros: navegación tablet, tarjetas, filtros plegables y objetivos táctiles.");
