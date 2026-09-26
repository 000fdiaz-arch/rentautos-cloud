const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "..", "src", "pages", "ClientsPage.tsx"),
  "utf8"
);

function functionBody(name) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `No se encontro ${name}.`);
  const braceStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(braceStart, index + 1);
  }
  throw new Error(`No se pudo leer el cuerpo de ${name}.`);
}

const unlinkBody = functionBody("handleUnlinkClient");
const clientsRefreshIndex = unlinkBody.indexOf("await onClientsRefresh()");
const fleetRefreshIndex = unlinkBody.indexOf("setFleetReloadToken((value) => value + 1)");

assert.notEqual(clientsRefreshIndex, -1, "Desvincular debe refrescar los clientes.");
assert.ok(
  fleetRefreshIndex > clientsRefreshIndex,
  "Desvincular debe recargar la flota despues de refrescar los clientes."
);
assert.match(
  source,
  /\}, \[dataOwnerUserId, fleetReloadToken\]\);/,
  "La carga de flota debe depender del token de recarga."
);

console.log("OK client unlink refreshes fleet state without a page reload");
