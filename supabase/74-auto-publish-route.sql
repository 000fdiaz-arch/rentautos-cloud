-- Publicación idempotente desde una preparación guardada.
create or replace function public.publish_prepared_route_item(p_user_id uuid, p_item jsonb, p_expected_updated_at text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_record jsonb; v_existing jsonb; v_client_id text; v_amount numeric; v_item jsonb;
begin
  if not coalesce(public.can_edit_owner_screen(p_user_id, 'receivables'), false) then
    raise exception 'No tienes permiso para enviar unidades a ruta.';
  end if;
  v_client_id := nullif(p_item->>'clientId', '');
  if v_client_id is null then raise exception 'Falta la unidad.'; end if;
  if not exists (select 1 from public.clients_cloud where user_id=p_user_id and id=v_client_id
    and coalesce(data->>'status','activo')='activo' and nullif(data->>'archivedAt','') is null
    and data->>'unitId'=p_item->>'unitId') then
    raise exception 'El cliente o la unidad cambió o ya no está activo. Actualiza las cuentas por cobrar.';
  end if;
  -- Serializa dos publicaciones de la misma preparación, incluso sin ruta previa.
  select data into v_record from public.street_management_items_cloud
    where user_id=p_user_id and client_id=v_client_id for update;
  if v_record is null or v_record->>'isRouteTagged' is distinct from 'true'
    or v_record->>'updatedAt' is distinct from p_expected_updated_at then
    raise exception 'La preparación cambió o no se ha guardado. Reintenta el envío.';
  end if;
  v_amount := coalesce(v_record->>'routeReleaseAmount', v_record->>'managementAmount')::numeric;
  if v_amount is null or v_amount <= 0 or v_amount::text in ('NaN','Infinity','-Infinity')
    or nullif(btrim(v_record->>'routeAssignment'),'') is null then
    raise exception 'Completa el monto para liberar y la ruta asignada.';
  end if;
  select data into v_existing from public.active_route_items_cloud
    where user_id=p_user_id and client_id=v_client_id for update;
  if v_existing is not null and coalesce(v_existing->>'removedAt','')='' then
    return v_existing; -- Conservar publicación, decisiones, reportes y custodia.
  end if;
  if nullif(v_existing->>'removedAt','') is not null and (v_existing->>'removedAt')::timestamptz >= greatest(
    nullif(v_record->>'updatedAt','')::timestamptz,
    nullif(v_record->>'managementUpdatedAt','')::timestamptz,
    nullif(v_record->>'routeReleaseUpdatedAt','')::timestamptz,
    nullif(v_record->>'routeAssignmentUpdatedAt','')::timestamptz) then
    raise exception 'La unidad fue retirada. Vuelve a enviarla a ruta desde Gestión.';
  end if;
  v_item := (p_item - 'removedAt' - 'removedReason' - 'partialDecisionRentAmount' - 'partialDecisionAt') || jsonb_build_object(
    'releaseAmount',v_amount,'routeAssignment',v_record->>'routeAssignment',
    'managementType',coalesce(v_record->>'managementType','solo_cobrar'),
    'urgency',coalesce(v_record->>'routeUrgency','normal'),
    'comment',v_record->>'managementComment','publishedAt',clock_timestamp());
  if v_existing is null then
    insert into public.active_route_items_cloud(user_id,client_id,data,updated_at)
      values(p_user_id,v_client_id,v_item,now()) on conflict(user_id,client_id) do nothing;
  else
    -- La ruta retirada ya está bloqueada y se validó la reasignación más reciente.
    update public.active_route_items_cloud set data=v_item,updated_at=now()
      where user_id=p_user_id and client_id=v_client_id;
  end if;
  select data into v_item from public.active_route_items_cloud where user_id=p_user_id and client_id=v_client_id;
  if nullif(v_item->>'removedAt','') is not null then raise exception 'La unidad fue retirada mientras se enviaba. Actualiza la ruta.'; end if;
  return v_item;
end;
$$;
revoke all on function public.publish_prepared_route_item(uuid,jsonb,text) from public,anon;
grant execute on function public.publish_prepared_route_item(uuid,jsonb,text) to authenticated;
notify pgrst, 'reload schema';
