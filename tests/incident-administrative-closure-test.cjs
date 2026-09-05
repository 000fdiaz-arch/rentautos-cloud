const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const collisions = fs.readFileSync(path.join(root, "src/pages/CollisionsPage.tsx"), "utf8");
const unified = fs.readFileSync(path.join(root, "src/pages/UnifiedIncidentsFollowUp.tsx"), "utf8");
const cloud = fs.readFileSync(path.join(root, "src/cloud/operationsCloudData.ts"), "utf8");
const lifecycle = fs.readFileSync(path.join(root, "supabase/migrations/20260831000100_fleet_unit_lifecycle.sql"), "utf8");

if (!collisions.includes("Cierre administrativo") || !collisions.includes("Razón del cierre")) {
  throw new Error("Falta la acción visible de cierre administrativo con razón obligatoria.");
}
if (!collisions.includes('status: "CIERRE ADMINISTRATIVO"') || !collisions.includes("administrativeClosureHistory")) {
  throw new Error("El cierre administrativo debe persistir estado, razón e historial.");
}
if (!collisions.includes("Reabrir expediente") || !collisions.includes("Razón de la reapertura")) {
  throw new Error("El expediente debe poder reabrirse con una razón obligatoria.");
}
if (!unified.includes('label: "Cierre administrativo", finalized: true')) {
  throw new Error("El control unificado debe tratar el cierre administrativo como finalizado.");
}
if (!cloud.includes('rawStatus === "CIERRE ADMINISTRATIVO"')) {
  throw new Error("La normalización debe conservar el cierre administrativo al recargar.");
}
if (!lifecycle.includes("'ABSUELTO', 'CULPABLE', 'CIERRE ADMINISTRATIVO'")) {
  throw new Error("El ciclo de vida de la unidad no debe contar el cierre administrativo como abierto.");
}

console.log("OK cierre administrativo: razón obligatoria, finalización, historial y reapertura.");
