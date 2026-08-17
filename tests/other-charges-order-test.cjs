const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "src/otherCharges.ts"), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText;
const target = path.join(os.tmpdir(), `other-charges-order-${Date.now()}.cjs`);
fs.writeFileSync(target, output);
const { otherChargeDateKey, sortOtherChargesOldestFirst } = require(target);

const charges = [
  { id: "new", label: "NUEVO", amount: 10, createdAt: "2026-08-17T10:00:00Z" },
  { id: "legacy-1", label: "HISTÓRICO 1", amount: 20 },
  { id: "old", label: "ANTIGUO", amount: 30, createdAt: "2026-06-01" },
  { id: "legacy-2", label: "HISTÓRICO 2", amount: 40 },
  { id: "middle", label: "INTERMEDIO", amount: 50, createdAt: "2026-07-10" }
];

const ordered = sortOtherChargesOldestFirst(charges);
const ids = ordered.map((charge) => charge.id).join(",");
if (ids !== "legacy-1,legacy-2,old,middle,new") {
  throw new Error(`Orden inesperado: ${ids}`);
}
if (otherChargeDateKey(ordered[2]) !== "2026-06-01") throw new Error("No se obtuvo la fecha visible del cargo.");
if (otherChargeDateKey(ordered[0]) !== "") throw new Error("Un cargo histórico no debe inventar una fecha.");

console.log("OK otros cargos: históricos conservan prioridad y los fechados se ordenan del más antiguo al más nuevo.");
