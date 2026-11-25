-- Las cuentas Delta conservan sus acciones operativas, pero no pueden retirar
-- unidades de Ruta en calle. Cada retiro autorizado guarda su autor.
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

  if coalesce(public.current_user_role()::text = 'buscador', false) then
    raise exception 'Las cuentas Delta no pueden sacar autos de Ruta en calle.';
  end if;

  if not coalesce(public.can_edit_owner_screen(p_user_id, 'route_search'), false) then
    raise exception 'No tienes permiso para editar Ruta en calle.';
  end if;

  update public.active_route_items_cloud
  set
    data = jsonb_set(
      jsonb_set(
        jsonb_set(data, '{removedAt}', to_jsonb(clock_timestamp()), true),
        '{removedReason}',
        to_jsonb('route_editor_removed'::text),
        true
      ),
      '{removedBy}',
      to_jsonb(auth.uid()),
      true
    ),
    in_custody = false,
    custody_since = null,
    custody_changed_at = case when in_custody then clock_timestamp() else custody_changed_at end,
    custody_changed_by = case when in_custody then auth.uid() else custody_changed_by end,
    custody_history = case
      when in_custody then custody_history || jsonb_build_array(jsonb_build_object(
        'inCustody', false,
        'at', clock_timestamp(),
        'by', auth.uid(),
        'unitId', data ->> 'unitId',
        'publishedAt', data ->> 'publishedAt',
        'reason', 'route_removed'
      ))
      else custody_history
    end,
    updated_at = clock_timestamp()
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
