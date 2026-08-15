-- Rentautos: valida pagos provisionales contra el saldo del alquiler,
-- sin comparar ni modificar el saldo regular pausado del cliente.

create or replace function public.register_client_payment_deltas(
  p_owner_user_id uuid,
  p_client_id text,
  p_expected_balance_before numeric,
  p_next_client jsonb,
  p_payments jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_client jsonb;
  v_current_balance numeric;
  v_payment jsonb;
  v_payment_id text;
  v_payment_count integer;
  v_existing_count integer;
  v_inserted_payments jsonb := '[]'::jsonb;
  v_previous_balance numeric;
  v_payment_balance_before numeric;
  v_payment_balance_after numeric;
  v_payment_context text;
  v_rental_id text;
  v_rental jsonb;
  v_balance_label text;
  v_now timestamptz := now();
begin
  if not public.can_access_owner_data(p_owner_user_id) then
    raise exception 'No autorizado para registrar pagos de este owner';
  end if;

  if coalesce(p_client_id, '') = '' then
    raise exception 'Cliente es requerido';
  end if;

  if p_next_client is null or jsonb_typeof(p_payments) <> 'array' then
    raise exception 'Payload de cliente y pagos es requerido';
  end if;

  if coalesce(p_next_client->>'id', '') <> p_client_id then
    raise exception 'El cliente actualizado no coincide con el cliente solicitado';
  end if;

  select count(*) into v_payment_count from jsonb_array_elements(p_payments);
  if v_payment_count <= 0 then
    raise exception 'Debe enviar al menos un pago';
  end if;

  select count(*)
    into v_existing_count
  from jsonb_array_elements(p_payments) item(payment)
  join public.payments_cloud existing
    on existing.user_id = p_owner_user_id
   and existing.id = item.payment->>'id';

  if v_existing_count = v_payment_count then
    select data into v_current_client
    from public.clients_cloud
    where user_id = p_owner_user_id and id = p_client_id;

    select coalesce(jsonb_agg(existing.data order by existing.id), '[]'::jsonb)
      into v_inserted_payments
    from jsonb_array_elements(p_payments) item(payment)
    join public.payments_cloud existing
      on existing.user_id = p_owner_user_id
     and existing.id = item.payment->>'id';

    return jsonb_build_object(
      'client', v_current_client,
      'payments', v_inserted_payments,
      'idempotent', true
    );
  elsif v_existing_count > 0 then
    raise exception 'Algunos pagos ya existen y otros no. Refresca antes de reintentar.';
  end if;

  select data into v_current_client
  from public.clients_cloud
  where user_id = p_owner_user_id and id = p_client_id
  for update;

  if v_current_client is null then
    raise exception 'Cliente no encontrado para registrar pago';
  end if;

  v_payment_context := coalesce(p_payments->0->>'paymentContext', 'regular');
  v_balance_label := coalesce(v_current_client->>'unitId', p_client_id);

  if v_payment_context = 'provisional_rental' then
    v_rental_id := coalesce(p_payments->0->>'provisionalRentalId', '');
    if v_rental_id = '' then
      raise exception 'El pago provisional no identifica el alquiler';
    end if;

    if coalesce(v_current_client #>> '{activeProvisionalRental,id}', '') = v_rental_id then
      v_rental := v_current_client->'activeProvisionalRental';
    else
      select item.rental into v_rental
      from jsonb_array_elements(
        coalesce(v_current_client->'provisionalRentalHistory', '[]'::jsonb)
      ) as item(rental)
      where coalesce(item.rental->>'id', '') = v_rental_id
      limit 1;
    end if;

    if v_rental is null then
      raise exception 'El alquiler provisional del pago no existe en el cliente';
    end if;

    v_current_balance := nullif(v_rental->>'balance', '')::numeric;
    v_balance_label := coalesce(v_rental->>'unitId', v_balance_label);
  else
    v_current_balance := nullif(v_current_client->>'balance', '')::numeric;
  end if;

  if p_expected_balance_before is not null
     and abs(coalesce(v_current_balance, 0) - p_expected_balance_before) > 0.005 then
    raise exception 'Saldo desactualizado para %. Actual: %, esperado: %',
      v_balance_label,
      coalesce(v_current_balance, 0),
      p_expected_balance_before;
  end if;

  v_previous_balance := coalesce(v_current_balance, 0);

  for v_payment in
    select value
    from jsonb_array_elements(p_payments) with ordinality as item(value, ord)
    order by ord
  loop
    v_payment_id := coalesce(v_payment->>'id', '');
    if v_payment_id = '' then
      raise exception 'Todos los pagos deben tener id';
    end if;

    if coalesce(v_payment->>'clientId', '') <> p_client_id then
      raise exception 'Todos los pagos deben pertenecer al cliente solicitado';
    end if;

    if coalesce(v_payment->>'paymentContext', 'regular') <> v_payment_context then
      raise exception 'No se pueden mezclar pagos regulares y provisionales en una transaccion';
    end if;

    if v_payment_context = 'provisional_rental'
       and coalesce(v_payment->>'provisionalRentalId', '') <> v_rental_id then
      raise exception 'No se pueden mezclar alquileres provisionales en una transaccion';
    end if;

    v_payment_balance_before := nullif(v_payment->>'balanceBefore', '')::numeric;
    v_payment_balance_after := nullif(v_payment->>'balanceAfter', '')::numeric;

    if v_payment_balance_before is not null
       and abs(v_previous_balance - v_payment_balance_before) > 0.005 then
      raise exception 'Secuencia de pagos desactualizada para %. Actual: %, esperado por pago: %',
        v_balance_label,
        v_previous_balance,
        v_payment_balance_before;
    end if;

    insert into public.payments_cloud (user_id, id, data, updated_at)
    values (p_owner_user_id, v_payment_id, v_payment, v_now);

    v_inserted_payments := v_inserted_payments || jsonb_build_array(v_payment);
    v_previous_balance := coalesce(v_payment_balance_after, v_previous_balance);
  end loop;

  update public.clients_cloud
  set data = p_next_client,
      updated_at = v_now
  where user_id = p_owner_user_id and id = p_client_id;

  return jsonb_build_object(
    'client', p_next_client,
    'payments', v_inserted_payments,
    'idempotent', false
  );
end;
$$;

grant execute on function public.register_client_payment_deltas(uuid, text, numeric, jsonb, jsonb) to authenticated;
