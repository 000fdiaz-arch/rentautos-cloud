-- Permite deshacer desde Cuentas por cobrar una preparación o publicación de Ruta.
-- La preparación y la ruta activa se bloquean juntas para evitar que una publicación
-- automática termine después de que el usuario haya confirmado la salida.
create or replace function public.remove_active_route_item_from_receivables(
  p_user_id uuid,
  p_client_id text,
  p_expected_updated_at text default ''
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_management jsonb;
  v_removed_at timestamptz := clock_timestamp();
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesion.';
  end if;

  if not coalesce(public.can_edit_owner_screen(p_user_id, 'receivables'), false) then
    raise exception 'No tienes permiso para editar Cuentas por cobrar.';
  end if;

  select data
  into v_management
  from public.street_management_items_cloud
  where user_id = p_user_id
    and client_id = p_client_id
  for update;

  if v_management is null or v_management ->> 'isRouteTagged' is distinct from 'true' then
    raise exception 'La unidad ya no esta preparada para Ruta. Actualiza e intenta nuevamente.';
  end if;

  if nullif(btrim(coalesce(p_expected_updated_at, '')), '') is not null
     and v_management ->> 'updatedAt' is distinct from p_expected_updated_at then
    raise exception 'La gestion de la unidad cambio. Actualiza antes de sacarla de Ruta.';
  end if;

  update public.active_route_items_cloud
  set
    data = jsonb_set(
      jsonb_set(data, '{removedAt}', to_jsonb(v_removed_at), true),
      '{removedReason}',
      to_jsonb('manual_management'::text),
      true
    ),
    in_custody = false,
    custody_since = null,
    custody_changed_at = case when in_custody then v_removed_at else custody_changed_at end,
    custody_changed_by = case when in_custody then auth.uid() else custody_changed_by end,
    custody_history = case
      when in_custody then coalesce(custody_history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'inCustody', false,
        'at', v_removed_at,
        'by', auth.uid(),
        'unitId', data ->> 'unitId',
        'publishedAt', data ->> 'publishedAt',
        'reason', 'route_removed'
      ))
      else custody_history
    end,
    updated_at = v_removed_at
  where user_id = p_user_id
    and client_id = p_client_id
    and coalesce(data ->> 'removedAt', '') = '';

  update public.street_management_items_cloud
  set
    data = (
      data
      - 'routeTaggedAt'
      - 'managementType'
      - 'managementAmount'
      - 'managementUpdatedAt'
      - 'routeReleaseAmount'
      - 'routeReleaseUpdatedAt'
      - 'routeAssignment'
      - 'routeAssignmentUpdatedAt'
      - 'routeUrgency'
      - 'routeUrgencyUpdatedAt'
    ) || jsonb_build_object(
      'status', 'pending',
      'isRouteTagged', false,
      'managementComment', '',
      'updatedAt', v_removed_at::text
    ),
    updated_at = v_removed_at
  where user_id = p_user_id
    and client_id = p_client_id;

  return v_removed_at;
end;
$$;

revoke all on function public.remove_active_route_item_from_receivables(uuid, text, text) from public, anon;
grant execute on function public.remove_active_route_item_from_receivables(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
