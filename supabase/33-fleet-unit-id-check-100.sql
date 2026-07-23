-- Rentautos: actualizar restriccion de formato/rango de unidad a 1-100 por grupo.
-- Ejecutar despues de 32-fleet-unit-range-100.sql.

alter table public.fleet_units_cloud
  drop constraint if exists fleet_units_cloud_unit_id_format_chk;

alter table public.fleet_units_cloud
  add constraint fleet_units_cloud_unit_id_format_chk
  check (
    unit_id ~ '^[ABCDT]([1-9][0-9]?|100)$'
  );

notify pgrst, 'reload schema';
