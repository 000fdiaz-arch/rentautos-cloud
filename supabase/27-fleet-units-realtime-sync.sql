-- Rentautos: realtime de Autos y puente desde cambios de Clientes.
-- Ejecutar despues de 25-fleet-unit-status-rpc.sql.

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'fleet_units_cloud'
  ) then
    alter publication supabase_realtime add table public.fleet_units_cloud;
  end if;
end $$;

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
begin
  v_old_user_id := case when tg_op in ('UPDATE', 'DELETE') then old.user_id else null end;
  v_new_user_id := case when tg_op in ('INSERT', 'UPDATE') then new.user_id else null end;
  v_old_unit_id := case when tg_op in ('UPDATE', 'DELETE') then upper(trim(coalesce(old.data->>'unitId', ''))) else '' end;
  v_new_unit_id := case when tg_op in ('INSERT', 'UPDATE') then upper(trim(coalesce(new.data->>'unitId', ''))) else '' end;

  if v_old_user_id is not null and v_old_unit_id <> '' then
    update public.fleet_units_cloud
    set updated_at = now()
    where user_id = v_old_user_id
      and unit_id = v_old_unit_id;
  end if;

  if v_new_user_id is not null
    and v_new_unit_id <> ''
    and (v_old_user_id is distinct from v_new_user_id or v_old_unit_id is distinct from v_new_unit_id)
  then
    update public.fleet_units_cloud
    set updated_at = now()
    where user_id = v_new_user_id
      and unit_id = v_new_unit_id;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists clients_cloud_touch_fleet_units on public.clients_cloud;
create trigger clients_cloud_touch_fleet_units
after insert or update or delete on public.clients_cloud
for each row execute function public.touch_fleet_unit_for_client_change();

grant execute on function public.touch_fleet_unit_for_client_change() to authenticated;
