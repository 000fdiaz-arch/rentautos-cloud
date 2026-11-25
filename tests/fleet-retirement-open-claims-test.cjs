const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const migration = fs.readFileSync(
  path.join(root, "supabase/migrations/20261124000100_allow_fleet_retirement_with_open_incidents.sql"),
  "utf8"
);
const modal = fs.readFileSync(
  path.join(root, "src/pages/controlUnits/FleetLifecycleModals.tsx"),
  "utf8"
);

if (!migration.includes("create or replace function public.retire_fleet_unit")) {
  throw new Error("La migración debe reemplazar el flujo atómico de baja.");
}
if (migration.includes("v_impact->>'openInsuranceClaims'")) {
  throw new Error("Los reclamos de seguro no deben bloquear la baja.");
}
if (migration.includes("v_impact->>'openCollisionCases'")) {
  throw new Error("Los expedientes de colisión no deben bloquear la baja.");
}
if (modal.includes("pendingPromises + impact.openInsuranceClaims")) {
  throw new Error("La interfaz todavía cuenta los reclamos como bloqueadores.");
}
if (!modal.includes("(no impiden la baja)")) {
  throw new Error("La interfaz debe explicar que los reclamos se conservan sin bloquear la baja.");
}

const compiled = ts.transpileModule(modal, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX }
}).outputText;
const loaded = { exports: {} };
new Function("require", "module", "exports", compiled)(require, loaded, loaded.exports);
const { RetireFleetUnitModal } = loaded.exports;
const emptyImpact = { activeClients: 0, activeRoutes: 0, pendingPromises: 0, openInsuranceClaims: 0, openCollisionCases: 0 };
const props = { target: { unit_id: "D94" }, reason: "Retirado", note: "", impact: emptyImpact, saving: false };

function flatten(node) {
  if (node == null || typeof node === "boolean") return [];
  if (Array.isArray(node)) return node.flatMap(flatten);
  if (typeof node !== "object") return [node];
  if (typeof node.type === "function") return flatten(node.type(node.props));
  return [node, ...flatten(node.props.children)];
}
function render(overrides = {}) {
  return flatten(RetireFleetUnitModal({ ...props, ...overrides }));
}
function confirm(nodes) {
  return nodes.find((node) => node?.type === "button" && node.props.className === "button primary");
}

for (const counts of [emptyImpact, { ...emptyImpact, openInsuranceClaims: 2 }, { ...emptyImpact, openCollisionCases: 1 }, { ...emptyImpact, openInsuranceClaims: 2, openCollisionCases: 3 }]) {
  const nodes = render({ impact: counts });
  assert.equal(confirm(nodes).props.disabled, false, "Los siniestros abiertos permiten confirmar la baja.");
  assert.match(nodes.filter((node) => typeof node === "string").join(" "), /conservarán sus datos y su estado actual/);
}
for (const field of ["activeClients", "activeRoutes", "pendingPromises"]) {
  assert.equal(confirm(render({ impact: { ...emptyImpact, [field]: 1 } })).props.disabled, true, `${field} debe bloquear la baja.`);
}
for (const overrides of [{ impact: null }, { reason: "" }, { saving: true }]) {
  assert.equal(confirm(render(overrides)).props.disabled, true);
}

console.log("OK: la interfaz permite la baja con reclamos y colisiones, conservando las validaciones operativas.");
