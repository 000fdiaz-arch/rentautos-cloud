const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const source = fs.readFileSync(
  path.resolve(__dirname, "..", "src", "cloud", "clientCloudData.ts"),
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

for (const name of ["saveCloudClients", "syncCloudClientsDelta"]) {
  const body = functionBody(name);
  assert.match(
    body,
    /withCloudRetry\(\(\) =>[\s\S]*\.upsert\([\s\S]*\.throwOnError\(\)[\s\S]*\);/,
    `${name} debe lanzar los errores de Supabase dentro de withCloudRetry.`
  );
}

console.log("OK client cloud writes: Supabase errors are retried before surfacing.");
