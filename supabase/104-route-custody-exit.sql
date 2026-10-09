-- Sacar de Ruta en calle tambien cierra una custodia activa en la misma transaccion.
-- Se conserva el historial de custodia, los pagos y los datos de la publicacion.
create or replace function public.remove_active_route_item_from_search(
  p_user_id uuid,
  p_client_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated_count integer;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesion.';
  end if;

  if not public.can_edit_owner_screen(p_user_id, 'route_search') then
    raise exception 'No tienes permiso para editar Ruta en calle.';
  end if;

  update public.active_route_items_cloud
  set
    data = jsonb_set(
      jsonb_set(data, '{removedAt}', to_jsonb(now()), true),
      '{removedReason}',
      to_jsonb('route_editor_removed'::text),
      true
    ),
    in_custody = false,
    custody_since = null,
    custody_changed_at = case when in_custody then now() else custody_changed_at end,
    custody_changed_by = case when in_custody then auth.uid() else custody_changed_by end,
    custody_history = case
      when in_custody then custody_history || jsonb_build_array(jsonb_build_object(
        'inCustody', false,
        'at', now(),
        'by', auth.uid(),
        'unitId', data ->> 'unitId',
        'publishedAt', data ->> 'publishedAt',
        'reason', 'route_removed'
      ))
      else custody_history
    end,
    updated_at = now()
  where user_id = p_user_id
    and client_id = p_client_id
    and coalesce(data ->> 'removedAt', '') = '';

  get diagnostics v_updated_count = row_count;
  if v_updated_count = 0 then
    raise exception 'La unidad ya no esta activa en la ruta.';
  end if;
end;
$$;

revoke all on function public.remove_active_route_item_from_search(uuid, text) from public;
grant execute on function public.remove_active_route_item_from_search(uuid, text) to authenticated;

notify pgrst, 'reload schema';
