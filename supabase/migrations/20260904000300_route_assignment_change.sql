-- Permiso limitado para buscadores activos y editores de Ruta en calle.
create or replace function public.change_active_route_assignment(
  p_user_id uuid, p_client_id text, p_published_at text,
  p_previous_route text, p_route text
) returns void language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  if not coalesce(public.can_report_route_payment(p_user_id), false) then
    raise exception 'No tienes permiso para cambiar la ruta.';
  end if;
  if p_route is null or p_route not in ('WC','PTY') or p_previous_route is null or p_previous_route not in ('WC','PTY') then
    raise exception 'Solo puedes cambiar entre WC y PTY.';
  end if;
  update public.active_route_items_cloud
  set data = jsonb_set(jsonb_set(jsonb_set(data, '{routeAssignment}', to_jsonb(p_route)),
      '{routeChangedBy}', to_jsonb(auth.uid())), '{routeChangedAt}', to_jsonb(now())),
      updated_at = now()
  where user_id = p_user_id and client_id = p_client_id
    and data->>'publishedAt' = p_published_at
    and data->>'routeAssignment' = p_previous_route
    and coalesce(data->>'removedAt','') = '';
  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'La ruta cambió o la unidad ya no está activa. Actualiza e intenta nuevamente.';
  end if;
end;
$$;
revoke all on function public.change_active_route_assignment(uuid,text,text,text,text) from public, anon;
grant execute on function public.change_active_route_assignment(uuid,text,text,text,text) to authenticated;
