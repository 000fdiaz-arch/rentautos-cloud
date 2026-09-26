-- Permite que Ruta en calle use el mismo catálogo flexible de Cuentas por cobrar.
create or replace function public.change_active_route_assignment(
  p_user_id uuid, p_client_id text, p_published_at text,
  p_previous_route text, p_route text
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
  v_previous_route text;
  v_route text;
begin
  if not coalesce(public.can_report_route_payment(p_user_id), false) then
    raise exception 'No tienes permiso para cambiar la ruta.';
  end if;

  v_previous_route := upper(btrim(regexp_replace(coalesce(p_previous_route, ''), '[[:space:]]+', ' ', 'g')));
  v_route := upper(btrim(regexp_replace(coalesce(p_route, ''), '[[:space:]]+', ' ', 'g')));

  if v_route = '' or char_length(v_route) > 12 then
    raise exception 'La ruta debe tener entre 1 y 12 caracteres.';
  end if;

  update public.active_route_items_cloud
  set data = jsonb_set(
        jsonb_set(
          jsonb_set(data, '{routeAssignment}', to_jsonb(v_route)),
          '{routeChangedBy}', to_jsonb(auth.uid())
        ),
        '{routeChangedAt}', to_jsonb(now())
      ),
      updated_at = now()
  where user_id = p_user_id
    and client_id = p_client_id
    and data->>'publishedAt' = p_published_at
    and upper(btrim(regexp_replace(coalesce(data->>'routeAssignment', ''), '[[:space:]]+', ' ', 'g'))) = v_previous_route
    and coalesce(data->>'removedAt','') = '';

  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'La ruta cambió o la unidad ya no está activa. Actualiza e intenta nuevamente.';
  end if;
end;
$$;

revoke all on function public.change_active_route_assignment(uuid,text,text,text,text) from public, anon;
grant execute on function public.change_active_route_assignment(uuid,text,text,text,text) to authenticated;
