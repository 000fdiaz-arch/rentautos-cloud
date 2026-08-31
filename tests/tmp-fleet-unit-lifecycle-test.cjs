const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const migration = fs.readFileSync(path.join(root, "supabase/migrations/20260831000100_fleet_unit_lifecycle.sql"), "utf8");
const bankRuleFix = fs.readFileSync(path.join(root, "supabase/migrations/20260831000200_fix_optional_bank_rule_name.sql"), "utf8");
const page = fs.readFileSync(path.join(root, "src/pages/ControlUnitsPage.tsx"), "utf8");
const form = fs.readFileSync(path.join(root, "src/pages/controlUnits/UnitFormModal.tsx"), "utf8");
const fleetActions = ["FleetTable.tsx", "FleetMobileList.tsx"]
  .map((name) => fs.readFileSync(path.join(root, "src/pages/controlUnits", name), "utf8"))
  .join("\n");

function requireText(source, text, message) {
  if (!source.includes(text)) throw new Error(message);
}

requireText(migration, "fleet_id uuid", "Falta identidad permanente del vehículo.");
requireText(migration, "fleet_units_cloud_active_unit_uq", "Falta unicidad de nomenclatura solo para autos activos.");
requireText(migration, "where retired_at is null", "La flota activa debe excluir autos dados de baja.");
requireText(migration, "create or replace function public.retire_fleet_unit", "Falta flujo atómico de baja.");
requireText(migration, "create or replace function public.rename_fleet_unit", "Falta flujo atómico de cambio de nomenclatura.");
requireText(migration, "create or replace function public.restore_fleet_unit", "Falta reactivación segura.");
requireText(migration, "destinationCompany", "La previsualización debe exponer la regla bancaria destino.");
requireText(migration, "El grupo % no tiene una regla bancaria activa", "La regla bancaria destino debe ser obligatoria.");
requireText(migration, "fleet_unit_events_cloud", "Falta auditoría de eventos del vehículo.");
requireText(migration, "active_route_items_cloud", "El cambio debe actualizar rutas vigentes.");
requireText(migration, "payment_promises_cloud", "El cambio debe actualizar promesas vigentes.");
requireText(migration, "insurance_claims_cloud", "El cambio debe contemplar reclamos abiertos.");
requireText(migration, "collision_cases_cloud", "El cambio debe contemplar colisiones abiertas.");
requireText(migration, "preserve_retired_fleet_unit", "Falta proteger fichas históricas cuando se reutiliza una nomenclatura.");
requireText(bankRuleFix, "v_destination_rule_found := found", "La regla activa debe reconocerse aunque su nombre opcional esté vacío.");
requireText(bankRuleFix, "if not v_rule_found", "El cambio debe validar la existencia de la regla, no su nombre opcional.");
requireText(bankRuleFix, "coalesce(v_company, v_unit.company)", "Sin nombre de cuenta debe conservarse la empresa actual.");

requireText(page, "Autos dados de baja", "Falta la vista de autos dados de baja.");
requireText(fleetActions, "Cambiar nomenclatura", "Falta el flujo visible de cambio de nomenclatura.");
requireText(fleetActions, "Dar de baja", "Falta el flujo visible de baja.");
requireText(page, "FleetUnitHistoryModal", "Falta consulta de historial.");
requireText(form, "disabled={Boolean(editTarget)}", "La edición normal no debe permitir cambiar la nomenclatura.");

console.log("OK ciclo de vida de autos: identidad, baja, reutilización, cambio, regla bancaria e historial validados.");
