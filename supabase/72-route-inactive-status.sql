-- Estado operativo limitado para indicar que una unidad no esta encendida.
create or replace function public.set_active_route_inactive_status(
  p_user_id uuid,
  p_client_id text,
  p_published_at text,
  p_inactive boolean
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed_at timestamptz := case when p_inactive then now() else null end;
  v_count integer;
begin
  if not coalesce(public.can_report_route_payment(p_user_id), false) then
    raise exception 'No tienes permiso para cambiar el estado de la unidad.';
  end if;

  update public.active_route_items_cloud
  set
    data = case when p_inactive then
      jsonb_set(
        jsonb_set(data, '{routeInactiveAt}', to_jsonb(v_changed_at), true),
        '{routeInactiveBy}', to_jsonb(auth.uid()), true
      )
    else data - 'routeInactiveAt' - 'routeInactiveBy' end,
    updated_at = now()
  where user_id = p_user_id
    and client_id = p_client_id
    and data ->> 'publishedAt' = p_published_at
    and coalesce(data ->> 'removedAt', '') = '';

  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'La unidad cambio o ya no esta activa. Actualiza e intenta nuevamente.';
  end if;
  return v_changed_at;
end;
$$;

revoke all on function public.set_active_route_inactive_status(uuid,text,text,boolean) from public, anon;
grant execute on function public.set_active_route_inactive_status(uuid,text,text,boolean) to authenticated;
