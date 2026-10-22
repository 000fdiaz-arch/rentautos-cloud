-- Rentautos: elimina pagos y revierte sus clientes en una sola transaccion idempotente.
-- Evita que dobles clics o reintentos apliquen la reversion mas de una vez.

create or replace function public.delete_client_payments_atomic(
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
  v_requested_count integer;
  v_distinct_payment_count integer;
  v_existing_count integer;
  v_client_count integer;
  v_distinct_client_count integer;
  v_deleted_count integer;
  v_clients jsonb;
begin
  if not coalesce(public.can_edit_owner_screen(p_owner_user_id, 'payments'), false) then
    raise exception 'No autorizado para eliminar pagos de este owner';
  end if;

  if jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) = 0 then
    raise exception 'Los cambios de eliminacion deben ser un arreglo no vacio';
  end if;

  for v_change in select value from jsonb_array_elements(p_changes) item(value)
  loop
    v_client_id := coalesce(v_change->>'clientId', '');
    v_previous_client := v_change->'previousClient';
    v_next_client := v_change->'nextClient';

    if v_client_id = ''
       or v_previous_client is null
       or jsonb_typeof(v_previous_client) = 'null'
       or v_next_client is null
       or jsonb_typeof(v_change->'paymentIds') <> 'array'
       or jsonb_array_length(v_change->'paymentIds') = 0 then
      raise exception 'Cada cambio requiere cliente, estado anterior, estado nuevo y pagos';
    end if;
    if coalesce(v_previous_client->>'id', '') <> v_client_id
       or coalesce(v_next_client->>'id', '') <> v_client_id then
      raise exception 'El cliente actualizado no coincide con el cambio solicitado';
    end if;
  end loop;

  select count(*), count(distinct change->>'clientId')
    into v_client_count, v_distinct_client_count
  from jsonb_array_elements(p_changes) item(change);

  if v_client_count <> v_distinct_client_count then
    raise exception 'Cada cliente debe aparecer una sola vez en la eliminacion';
  end if;

  select count(*), count(distinct payment_id)
    into v_requested_count, v_distinct_payment_count
  from jsonb_array_elements(p_changes) item(change)
  cross join lateral jsonb_array_elements_text(change->'paymentIds') requested(payment_id);

  if v_requested_count <> v_distinct_payment_count then
    raise exception 'Cada pago debe aparecer una sola vez en la eliminacion';
  end if;

  -- Los pagos se bloquean primero y en orden estable. Una solicitud duplicada
  -- espera a la original y despues observa que ya no quedan filas por eliminar.
  perform payment_row.id
  from public.payments_cloud payment_row
  join (
    select payment_id
    from jsonb_array_elements(p_changes) item(change)
    cross join lateral jsonb_array_elements_text(change->'paymentIds') requested(payment_id)
  ) requested on requested.payment_id = payment_row.id
  where payment_row.user_id = p_owner_user_id
  order by payment_row.id
  for update of payment_row;

  select count(*)
    into v_existing_count
  from public.payments_cloud payment_row
  join (
    select payment_id
    from jsonb_array_elements(p_changes) item(change)
    cross join lateral jsonb_array_elements_text(change->'paymentIds') requested(payment_id)
  ) requested on requested.payment_id = payment_row.id
  where payment_row.user_id = p_owner_user_id;

  if v_existing_count = 0 then
    select coalesce(jsonb_agg(client_row.data order by client_row.id), '[]'::jsonb)
      into v_clients
    from public.clients_cloud client_row
    join (
      select change->>'clientId' as client_id
      from jsonb_array_elements(p_changes) item(change)
    ) requested on requested.client_id = client_row.id
    where client_row.user_id = p_owner_user_id;

    return jsonb_build_object(
      'clients', v_clients,
      'deletedPaymentIds', '[]'::jsonb,
      'idempotent', true
    );
  end if;

  if v_existing_count <> v_requested_count then
    raise exception 'Algunos pagos ya fueron eliminados y otros no. Actualiza el historial antes de reintentar.';
  end if;

  -- Bloquea tambien los clientes en orden estable antes de validar o escribir.
  perform client_row.id
  from public.clients_cloud client_row
  join (
    select change->>'clientId' as client_id
    from jsonb_array_elements(p_changes) item(change)
  ) requested on requested.client_id = client_row.id
  where client_row.user_id = p_owner_user_id
  order by client_row.id
  for update of client_row;

  for v_change in
    select value
    from jsonb_array_elements(p_changes) item(value)
    order by value->>'clientId'
  loop
    v_client_id := v_change->>'clientId';
    v_previous_client := v_change->'previousClient';
    v_next_client := v_change->'nextClient';

    select data
      into v_current_client
    from public.clients_cloud
    where user_id = p_owner_user_id
      and id = v_client_id;

    if v_current_client is null then
      raise exception 'El cliente % ya no existe. Actualiza y vuelve a intentar.', v_client_id;
    end if;

    if public.client_write_guard_state(v_current_client)
       is distinct from public.client_write_guard_state(v_previous_client) then
      raise exception 'Cliente desactualizado para %. Actualiza y vuelve a intentar.',
        coalesce(v_current_client->>'unitId', v_client_id);
    end if;

    if exists (
      select 1
      from public.payments_cloud payment_row
      where payment_row.user_id = p_owner_user_id
        and payment_row.id in (
          select payment_id
          from jsonb_array_elements_text(v_change->'paymentIds') requested(payment_id)
        )
        and coalesce(payment_row.data->>'clientId', '') <> v_client_id
    ) then
      raise exception 'Un pago no pertenece al cliente indicado para la reversion';
    end if;

    update public.clients_cloud
    set data = v_next_client,
        updated_at = now()
    where user_id = p_owner_user_id
      and id = v_client_id;
  end loop;

  delete from public.payments_cloud payment_row
  using (
    select payment_id
    from jsonb_array_elements(p_changes) item(change)
    cross join lateral jsonb_array_elements_text(change->'paymentIds') requested(payment_id)
  ) requested
  where payment_row.user_id = p_owner_user_id
    and payment_row.id = requested.payment_id;

  get diagnostics v_deleted_count = row_count;
  if v_deleted_count <> v_requested_count then
    raise exception 'No se eliminaron todos los pagos solicitados';
  end if;

  select coalesce(jsonb_agg(client_row.data order by client_row.id), '[]'::jsonb)
    into v_clients
  from public.clients_cloud client_row
  join (
    select change->>'clientId' as client_id
    from jsonb_array_elements(p_changes) item(change)
  ) requested on requested.client_id = client_row.id
  where client_row.user_id = p_owner_user_id;

  return jsonb_build_object(
    'clients', v_clients,
    'deletedPaymentIds', (
      select coalesce(jsonb_agg(payment_id order by payment_id), '[]'::jsonb)
      from jsonb_array_elements(p_changes) item(change)
      cross join lateral jsonb_array_elements_text(change->'paymentIds') requested(payment_id)
    ),
    'idempotent', false
  );
end;
$$;

revoke all on function public.delete_client_payments_atomic(uuid, jsonb) from public, anon;
grant execute on function public.delete_client_payments_atomic(uuid, jsonb) to authenticated;

