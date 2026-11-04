const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const migration = fs.readFileSync(
  path.join(root, "supabase/migrations/20261103000100_allow_fleet_retirement_with_open_claims.sql"),
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
if (!migration.includes("v_impact->>'openCollisionCases'")) {
  throw new Error("Los expedientes de colisión abiertos deben continuar bloqueando la baja.");
}
if (modal.includes("pendingPromises + impact.openInsuranceClaims")) {
  throw new Error("La interfaz todavía cuenta los reclamos como bloqueadores.");
}
if (!modal.includes("(no impiden la baja)")) {
  throw new Error("La interfaz debe explicar que los reclamos se conservan sin bloquear la baja.");
}

console.log("OK: los reclamos se conservan y ya no bloquean la baja del auto.");
