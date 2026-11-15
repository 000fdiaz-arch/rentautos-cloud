const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const intake = fs.readFileSync(
  path.join(root, "src/pages/controlUnits/FleetDocumentIntake.tsx"),
  "utf8"
);

assert.match(
  intake,
  /<small>Opcional · PDF o fotografía/,
  "La interfaz debe indicar que cargar documentos es opcional."
);
assert.match(
  intake,
  /disabled=\{saving \|\| isAnalyzing\} onClick=\{onSave\}/,
  "Guardar auto solo debe bloquearse mientras se analiza o guarda."
);
assert.doesNotMatch(
  intake,
  /disabled=\{saving \|\| isAnalyzing \|\| completedCount === 0\}/,
  "La ausencia de documentos no debe bloquear Guardar auto."
);

console.log("OK alta de auto permite guardar sin documentos.");
