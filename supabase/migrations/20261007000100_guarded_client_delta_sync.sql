-- Rentautos: evita que una sesion desactualizada reemplace saldos o datos de clientes.
-- Todas las filas se validan y bloquean antes de escribir; el lote es atomico.

create or replace function public.client_write_guard_state(p_client jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select coalesce(p_client, '{}'::jsonb)
    - 'installmentsIssued'
    - 'installmentsIssuedEstimateNeedsReview';
$$;

create or replace function public.sync_client_deltas_guarded(
  p_owner_user_id uuid,
  p_changes jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_change jsonb;
  v_client_id text;
  v_previous_client jsonb;
  v_next_client jsonb;
  v_current_client jsonb;
  v_count integer := 0;
  v_now timestamptz := now();
begin
  if not public.can_access_owner_data(p_owner_user_id) then
    raise exception 'No autorizado para actualizar clientes de este owner';
  end if;

  if jsonb_typeof(p_changes) <> 'array' then
    raise exception 'Los cambios de clientes deben ser un arreglo';
  end if;

  -- Lock every existing row in a stable order and validate the complete client
  -- state before changing anything. Any conflict rolls back the whole batch.
  for v_change in
    select value
    from jsonb_array_elements(p_changes) item(value)
    order by value->>'clientId'
  loop
    v_client_id := coalesce(v_change->>'clientId', '');
    v_previous_client := v_change->'previousClient';
    v_next_client := v_change->'nextClient';

    if v_client_id = '' or v_next_client is null then
      raise exception 'Cada cambio requiere cliente y payload actualizado';
    end if;
    if coalesce(v_next_client->>'id', '') <> v_client_id then
      raise exception 'El cliente actualizado no coincide con el cambio solicitado';
    end if;

    v_current_client := null;
    select data
      into v_current_client
    from public.clients_cloud
    where user_id = p_owner_user_id
      and id = v_client_id
    for update;

    if v_previous_client is null or jsonb_typeof(v_previous_client) = 'null' then
      if v_current_client is not null then
        raise exception 'Cliente desactualizado para %. Actualiza y vuelve a intentar.',
          coalesce(v_current_client->>'unitId', v_client_id);
      end if;
    elsif v_current_client is null then
      raise exception 'El cliente % ya no existe. Actualiza y vuelve a intentar.', v_client_id;
    elsif public.client_write_guard_state(v_current_client)
          is distinct from public.client_write_guard_state(v_previous_client) then
      raise exception 'Cliente desactualizado para %. Actualiza y vuelve a intentar.',
        coalesce(v_current_client->>'unitId', v_client_id);
    end if;
  end loop;

  for v_change in
    select value
    from jsonb_array_elements(p_changes) item(value)
    order by value->>'clientId'
  loop
    v_client_id := v_change->>'clientId';
    v_previous_client := v_change->'previousClient';
    v_next_client := v_change->'nextClient';

    if v_previous_client is null or jsonb_typeof(v_previous_client) = 'null' then
      insert into public.clients_cloud (user_id, id, data, updated_at)
      values (p_owner_user_id, v_client_id, v_next_client, v_now);
    else
      update public.clients_cloud
      set data = v_next_client,
          updated_at = v_now
      where user_id = p_owner_user_id
        and id = v_client_id;
    end if;
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('updated', v_count);
end;
$$;

revoke all on function public.sync_client_deltas_guarded(uuid, jsonb) from public;
grant execute on function public.sync_client_deltas_guarded(uuid, jsonb) to authenticated;
