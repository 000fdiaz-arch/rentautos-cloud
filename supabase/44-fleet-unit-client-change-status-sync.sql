-- Rentautos: sincronizar estado operativo de Autos al cambiar unidad en Clientes.
-- Ejecutar despues de 40-receivables-fleet-read.sql.
--
-- Caso cubierto: si un cliente pasa de C81 a D93, C81 debe quedar LIBRE de
-- inmediato para todo el equipo. El trigger existente solo tocaba updated_at,
-- lo que disparaba Realtime pero dejaba operational_status='activo' en la
-- unidad anterior cuando ya no habia cliente asociado.

create or replace function public.touch_fleet_unit_for_client_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_user_id uuid;
  v_new_user_id uuid;
  v_old_unit_id text;
  v_new_unit_id text;
  v_new_status text;
  v_now timestamptz := now();
begin
  v_old_user_id := case when tg_op in ('UPDATE', 'DELETE') then old.user_id else null end;
  v_new_user_id := case when tg_op in ('INSERT', 'UPDATE') then new.user_id else null end;
  v_old_unit_id := case when tg_op in ('UPDATE', 'DELETE') then upper(trim(coalesce(old.data->>'unitId', ''))) else '' end;
  v_new_unit_id := case when tg_op in ('INSERT', 'UPDATE') then upper(trim(coalesce(new.data->>'unitId', ''))) else '' end;
  v_new_status := lower(trim(coalesce(case when tg_op in ('INSERT', 'UPDATE') then new.data->>'status' else null end, 'activo')));

  if v_old_user_id is not null and v_old_unit_id <> '' then
    update public.fleet_units_cloud f
    set operational_status = case
          when lower(coalesce(f.operational_status, 'activo')) = 'activo'
            and not exists (
              select 1
              from public.clients_cloud c
              where c.user_id = v_old_user_id
                and upper(trim(coalesce(c.data->>'unitId', ''))) = v_old_unit_id
                and lower(coalesce(c.data->>'status', 'activo')) <> 'archivado'
            )
          then 'libre'
          else f.operational_status
        end,
        updated_at = v_now
    where f.user_id = v_old_user_id
      and f.unit_id = v_old_unit_id;
  end if;

  if v_new_user_id is not null
    and v_new_unit_id <> ''
    and v_new_status <> 'archivado'
  then
    update public.fleet_units_cloud
    set operational_status = case
          when v_new_status in ('activo', 'taller', 'chapisteria', 'custodia') then v_new_status
          else 'activo'
        end,
        updated_at = v_now
    where user_id = v_new_user_id
      and unit_id = v_new_unit_id;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- Reparacion puntual de estados partidos ya existentes: unidades marcadas como
-- activo sin ningun cliente no archivado quedan libres. No toca taller,
-- chapisteria, custodia ni archivado para preservar estados operativos manuales.
update public.fleet_units_cloud f
set operational_status = 'libre',
    updated_at = now()
where lower(coalesce(f.operational_status, 'activo')) = 'activo'
  and not exists (
    select 1
    from public.clients_cloud c
    where c.user_id = f.user_id
      and upper(trim(coalesce(c.data->>'unitId', ''))) = upper(trim(f.unit_id))
      and lower(coalesce(c.data->>'status', 'activo')) <> 'archivado'
  );

grant execute on function public.touch_fleet_unit_for_client_change() to authenticated;

notify pgrst, 'reload schema';
