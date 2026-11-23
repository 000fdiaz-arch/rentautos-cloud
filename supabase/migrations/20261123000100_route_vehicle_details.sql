-- Consulta de identificación del auto desde una tarjeta de Ruta.
-- No concede acceso al catálogo de Autos ni permite modificarlo.
create or replace function public.read_route_vehicle_details(
  p_user_id uuid,
  p_client_id text,
  p_published_at text,
  p_version text default 'legacy'
) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_profile public.user_profiles%rowtype;
  v_route jsonb;
  v_delta text;
  v_details jsonb;
begin
  select * into v_profile from public.user_profiles where id = auth.uid();
  if auth.uid() is null or v_profile.id is null or not coalesce(v_profile.is_active, false)
    or coalesce(v_profile.data_owner_user_id, v_profile.id) is distinct from p_user_id
    or not (
      coalesce(public.can_view_owner_screen(p_user_id, 'route_search'), false)
      or coalesce(public.can_view_owner_screen(p_user_id, 'receivables'), false)
    ) then
    raise exception 'No tienes permiso para consultar los datos del auto de esta ruta.';
  end if;

  if p_version = 'legacy' then
    select data into v_route from public.active_route_items_cloud
    where user_id = p_user_id and client_id = p_client_id;
  elsif p_version = 'v2' then
    select data into v_route from public.cxc_v2_active_route_items_cloud
    where user_id = p_user_id and client_id = p_client_id;
  else
    raise exception 'Versión de ruta no válida.';
  end if;

  if v_route is null or coalesce(v_route->>'removedAt', '') <> ''
    or (v_route->>'publishedAt') is distinct from p_published_at then
    raise exception 'La unidad cambió o ya no está en ruta. Actualiza la lista.';
  end if;

  if lower(btrim(v_profile.email)) in (
    'delta1@auth.rentautos.local', 'delta2@auth.rentautos.local', 'delta3@auth.rentautos.local'
  ) then
    v_delta := split_part(lower(btrim(v_profile.email)), '@', 1);
  end if;
  if (v_profile.role::text = 'buscador' and v_delta is null)
    or (v_delta is not null and lower(btrim(coalesce(v_route->>'assignedDelta', ''))) <> v_delta) then
    raise exception 'Solo puedes consultar los autos asignados a tu Delta.';
  end if;

  select jsonb_build_object('plate', nullif(btrim(f.plate), ''),
    'color', nullif(btrim(f.color), ''), 'brandModel', nullif(btrim(f.brand_model), ''))
  into v_details from public.fleet_units_cloud f
  where f.user_id = p_user_id and f.retired_at is null
    and upper(btrim(f.unit_id)) = upper(btrim(v_route->>'unitId'));

  return coalesce(v_details, jsonb_build_object('plate', null, 'color', null, 'brandModel', null));
end;
$$;

revoke all on function public.read_route_vehicle_details(uuid, text, text, text) from public, anon;
grant execute on function public.read_route_vehicle_details(uuid, text, text, text) to authenticated;
notify pgrst, 'reload schema';
