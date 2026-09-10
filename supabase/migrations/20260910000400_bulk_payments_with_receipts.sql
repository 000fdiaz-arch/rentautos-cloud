-- Registra todos los grupos de pagos, reserva sus recibos y actualiza clientes
-- en una sola solicitud/transaccion. Un reintento completo no consume recibos nuevos.
create or replace function public.register_client_payment_groups_with_receipts(
  p_owner_user_id uuid,
  p_groups jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group jsonb;
  v_payment jsonb;
  v_payment_with_receipt jsonb;
  v_group_payments jsonb;
  v_group_result jsonb;
  v_results jsonb := '[]'::jsonb;
  v_existing_payments jsonb;
  v_current_client jsonb;
  v_client_id text;
  v_payment_id text;
  v_group_count integer;
  v_group_payment_count integer;
  v_total_payment_count integer := 0;
  v_existing_count integer;
  v_receipt_index integer := 0;
  v_receipts text[];
  v_receipt_number text;
begin
  if not public.can_access_owner_data(p_owner_user_id) then
    raise exception 'No autorizado para registrar pagos de este owner';
  end if;

  if p_groups is null or jsonb_typeof(p_groups) <> 'array' then
    raise exception 'Los grupos de pagos son requeridos';
  end if;

  select count(*) into v_group_count from jsonb_array_elements(p_groups);
  if v_group_count <= 0 then
    raise exception 'Debe enviar al menos un grupo de pagos';
  end if;

  -- Serializa por owner tanto la reserva como la escritura del lote.
  perform pg_advisory_xact_lock(hashtextextended(p_owner_user_id::text, 0));

  for v_group in
    select value
    from jsonb_array_elements(p_groups) with ordinality as item(value, ord)
    order by ord
  loop
    v_client_id := coalesce(v_group->>'clientId', '');
    if v_client_id = '' then
      raise exception 'Todos los grupos deben identificar un cliente';
    end if;
    if v_group->'nextClient' is null
       or coalesce(v_group #>> '{nextClient,id}', '') <> v_client_id then
      raise exception 'El cliente actualizado no coincide con el grupo';
    end if;
    if jsonb_typeof(v_group->'payments') <> 'array' then
      raise exception 'Todos los grupos deben incluir pagos';
    end if;

    select count(*) into v_group_payment_count
    from jsonb_array_elements(v_group->'payments');
    if v_group_payment_count <= 0 then
      raise exception 'Todos los grupos deben incluir al menos un pago';
    end if;
    v_total_payment_count := v_total_payment_count + v_group_payment_count;

    for v_payment in
      select value
      from jsonb_array_elements(v_group->'payments') with ordinality as item(value, ord)
      order by ord
    loop
      v_payment_id := coalesce(v_payment->>'id', '');
      if v_payment_id = '' then
        raise exception 'Todos los pagos deben tener id';
      end if;
      if coalesce(v_payment->>'clientId', '') <> v_client_id then
        raise exception 'Todos los pagos deben pertenecer al cliente de su grupo';
      end if;
    end loop;
  end loop;

  select count(*)
    into v_existing_count
  from jsonb_array_elements(p_groups) grouped
  cross join lateral jsonb_array_elements(grouped.value->'payments') item(payment)
  join public.payments_cloud existing
    on existing.user_id = p_owner_user_id
   and existing.id = item.payment->>'id';

  if v_existing_count > 0 and v_existing_count < v_total_payment_count then
    raise exception 'Algunos pagos ya existen y otros no. Refresca antes de reintentar.';
  end if;

  if v_existing_count = v_total_payment_count then
    for v_group in
      select value
      from jsonb_array_elements(p_groups) with ordinality as item(value, ord)
      order by ord
    loop
      v_client_id := v_group->>'clientId';

      select data into v_current_client
      from public.clients_cloud
      where user_id = p_owner_user_id and id = v_client_id;

      select coalesce(jsonb_agg(existing.data order by item.ord), '[]'::jsonb)
        into v_existing_payments
      from jsonb_array_elements(v_group->'payments') with ordinality as item(payment, ord)
      join public.payments_cloud existing
        on existing.user_id = p_owner_user_id
       and existing.id = item.payment->>'id';

      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'client', v_current_client,
        'payments', v_existing_payments,
        'idempotent', true
      ));
    end loop;

    return jsonb_build_object(
      'groups', v_results,
      'groupCount', v_group_count,
      'paymentCount', v_total_payment_count,
      'idempotent', true
    );
  end if;

  v_receipts := public.next_receipt_numbers(p_owner_user_id, v_total_payment_count);

  for v_group in
    select value
    from jsonb_array_elements(p_groups) with ordinality as item(value, ord)
    order by ord
  loop
    v_client_id := v_group->>'clientId';
    v_group_payments := '[]'::jsonb;

    for v_payment in
      select value
      from jsonb_array_elements(v_group->'payments') with ordinality as item(value, ord)
      order by ord
    loop
      v_receipt_index := v_receipt_index + 1;
      v_receipt_number := v_receipts[v_receipt_index];
      if coalesce(v_receipt_number, '') = '' then
        raise exception 'No se pudo reservar el numero de recibo';
      end if;
      v_payment_with_receipt := jsonb_set(
        v_payment,
        '{receiptNumber}',
        to_jsonb(v_receipt_number),
        true
      );
      v_group_payments := v_group_payments || jsonb_build_array(v_payment_with_receipt);
    end loop;

    v_group_result := public.register_client_payment_deltas(
      p_owner_user_id,
      v_client_id,
      nullif(v_group->>'expectedBalanceBefore', '')::numeric,
      v_group->'nextClient',
      v_group_payments
    );
    v_results := v_results || jsonb_build_array(v_group_result);
  end loop;

  return jsonb_build_object(
    'groups', v_results,
    'groupCount', v_group_count,
    'paymentCount', v_total_payment_count,
    'idempotent', false
  );
end;
$$;

grant execute on function public.register_client_payment_groups_with_receipts(uuid, jsonb) to authenticated;

