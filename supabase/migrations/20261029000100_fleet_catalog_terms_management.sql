-- Duración del contrato y cobro de gestión por plan en el catálogo de autos.
begin;
set local lock_timeout = '5s';

alter table public.fleet_units_cloud
  add column if not exists catalog_contract_months integer,
  add column if not exists catalog_daily_management_fee numeric(12,2),
  add column if not exists catalog_weekly_management_fee numeric(12,2),
  add column if not exists catalog_biweekly_management_fee numeric(12,2);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'fleet_units_catalog_contract_months_range'
      and conrelid = 'public.fleet_units_cloud'::regclass
  ) then
    alter table public.fleet_units_cloud
      add constraint fleet_units_catalog_contract_months_range
      check (catalog_contract_months is null or catalog_contract_months between 1 and 120) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'fleet_units_catalog_management_fees_nonnegative'
      and conrelid = 'public.fleet_units_cloud'::regclass
  ) then
    alter table public.fleet_units_cloud
      add constraint fleet_units_catalog_management_fees_nonnegative
      check (
        (catalog_daily_management_fee is null or catalog_daily_management_fee >= 0)
        and (catalog_weekly_management_fee is null or catalog_weekly_management_fee >= 0)
        and (catalog_biweekly_management_fee is null or catalog_biweekly_management_fee >= 0)
      ) not valid;
  end if;
end;
$$;

drop function if exists public.save_fleet_catalog_settings(uuid, uuid, numeric, numeric, numeric, text);
drop function if exists public.save_fleet_catalog_settings(uuid, uuid, integer, numeric, numeric, numeric, numeric, numeric, numeric, text);

create function public.save_fleet_catalog_settings(
  p_owner_user_id uuid,
  p_fleet_id uuid,
  p_contract_months integer,
  p_daily_rate numeric,
  p_weekly_rate numeric,
  p_biweekly_rate numeric,
  p_daily_management_fee numeric,
  p_weekly_management_fee numeric,
  p_biweekly_management_fee numeric,
  p_photo_path text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not coalesce(public.can_edit_owner_screen(p_owner_user_id, 'control_units'), false) then
    raise exception 'No autorizado para editar el catalogo de autos';
  end if;
  if p_contract_months is not null and (p_contract_months < 1 or p_contract_months > 120) then
    raise exception 'La duracion del contrato debe estar entre 1 y 120 meses';
  end if;
  if coalesce(p_daily_rate, 0) < 0 or coalesce(p_weekly_rate, 0) < 0 or coalesce(p_biweekly_rate, 0) < 0 then
    raise exception 'Las tarifas del catalogo no pueden ser negativas';
  end if;
  if coalesce(p_daily_management_fee, 0) < 0 or coalesce(p_weekly_management_fee, 0) < 0 or coalesce(p_biweekly_management_fee, 0) < 0 then
    raise exception 'Los cobros de gestion no pueden ser negativos';
  end if;
  if p_photo_path is not null and p_photo_path not like p_owner_user_id::text || '/%' then
    raise exception 'La foto no pertenece al owner indicado';
  end if;

  update public.fleet_units_cloud
  set catalog_contract_months = p_contract_months,
      catalog_daily_rate = p_daily_rate,
      catalog_weekly_rate = p_weekly_rate,
      catalog_biweekly_rate = p_biweekly_rate,
      catalog_daily_management_fee = p_daily_management_fee,
      catalog_weekly_management_fee = p_weekly_management_fee,
      catalog_biweekly_management_fee = p_biweekly_management_fee,
      catalog_photo_path = p_photo_path,
      updated_at = now()
  where user_id = p_owner_user_id
    and fleet_id = p_fleet_id
    and retired_at is null;

  if not found then
    raise exception 'No se encontro el auto activo solicitado';
  end if;
end;
$$;

revoke all on function public.save_fleet_catalog_settings(uuid, uuid, integer, numeric, numeric, numeric, numeric, numeric, numeric, text) from public;
grant execute on function public.save_fleet_catalog_settings(uuid, uuid, integer, numeric, numeric, numeric, numeric, numeric, numeric, text) to authenticated;

drop function if exists public.get_public_fleet_catalog(uuid);
create function public.get_public_fleet_catalog(p_owner_user_id uuid)
returns table (
  fleet_id uuid,
  brand_model text,
  model_year integer,
  transmission_type text,
  catalog_contract_months integer,
  catalog_daily_rate numeric,
  catalog_weekly_rate numeric,
  catalog_biweekly_rate numeric,
  catalog_daily_management_fee numeric,
  catalog_weekly_management_fee numeric,
  catalog_biweekly_management_fee numeric,
  catalog_photo_path text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    fleet.fleet_id,
    fleet.brand_model,
    fleet.model_year,
    fleet.transmission_type,
    fleet.catalog_contract_months,
    fleet.catalog_daily_rate,
    fleet.catalog_weekly_rate,
    fleet.catalog_biweekly_rate,
    fleet.catalog_daily_management_fee,
    fleet.catalog_weekly_management_fee,
    fleet.catalog_biweekly_management_fee,
    fleet.catalog_photo_path
  from public.fleet_units_cloud fleet
  where fleet.user_id = p_owner_user_id
    and fleet.retired_at is null
    and (
      lower(btrim(coalesce(fleet.operational_status, ''))) = 'libre'
      or exists (
        select 1
        from public.active_route_items_cloud route
        where route.user_id = fleet.user_id
          and upper(btrim(coalesce(route.data->>'unitId', ''))) = upper(btrim(fleet.unit_id))
          and route.in_custody
          and route.custody_since <= now() - interval '24 hours'
          and coalesce(route.data->>'removedAt', '') = ''
      )
    )
  order by fleet.brand_model nulls last, fleet.model_year desc nulls last, fleet.fleet_id;
$$;

revoke all on function public.get_public_fleet_catalog(uuid) from public;
grant execute on function public.get_public_fleet_catalog(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
