-- Catálogo público y sanitizado: no expone nomenclatura, placa, seriales ni clientes.
begin;

update storage.buckets
set public = true
where id = 'fleet-catalog-photos';

create or replace function public.get_public_fleet_catalog(p_owner_user_id uuid)
returns table (
  fleet_id uuid,
  brand_model text,
  model_year integer,
  transmission_type text,
  catalog_daily_rate numeric,
  catalog_weekly_rate numeric,
  catalog_biweekly_rate numeric,
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
    fleet.catalog_daily_rate,
    fleet.catalog_weekly_rate,
    fleet.catalog_biweekly_rate,
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
