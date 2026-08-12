-- Zonas temporales editables desde Ruta en calle.
-- La funcion permite que cualquier usuario con acceso de lectura a route_search
-- cambie exclusivamente la zona, sin ampliar permisos sobre el resto del registro.

create or replace function public.update_active_route_zone(
  p_user_id uuid,
  p_client_id text,
  p_route_assignment text,
  p_zone text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_zone text := regexp_replace(btrim(coalesce(p_zone, '')), '\s+', ' ', 'g');
  v_updated_count integer;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesion.';
  end if;

  if not public.can_view_owner_screen(p_user_id, 'route_search') then
    raise exception 'No tienes acceso a Ruta en calle.';
  end if;

  if char_length(v_zone) > 40 then
    raise exception 'La zona no puede superar 40 caracteres.';
  end if;

  update public.active_route_items_cloud
  set
    data = case
      when v_zone = '' then data - 'zone'
      else jsonb_set(data, '{zone}', to_jsonb(v_zone), true)
    end,
    updated_at = now()
  where user_id = p_user_id
    and client_id = p_client_id
    and coalesce(data ->> 'removedAt', '') = ''
    and upper(btrim(coalesce(data ->> 'routeAssignment', ''))) = upper(btrim(coalesce(p_route_assignment, '')));

  get diagnostics v_updated_count = row_count;
  if v_updated_count = 0 then
    raise exception 'La ruta cambio o el cliente ya no esta activo.';
  end if;
end;
$$;

revoke all on function public.update_active_route_zone(uuid, text, text, text) from public;
grant execute on function public.update_active_route_zone(uuid, text, text, text) to authenticated;
