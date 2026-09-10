-- Registra un pago individual y reserva su recibo en una sola transaccion.
-- Evita tres viajes consecutivos desde el navegador y conserva idempotencia.
create or replace function public.register_client_payment_with_receipt(
  p_owner_user_id uuid,
  p_client_id text,
  p_expected_balance_before numeric,
  p_next_client jsonb,
  p_payment jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment_id text := coalesce(p_payment->>'id', '');
  v_existing_payment jsonb;
  v_current_client jsonb;
  v_receipts text[];
  v_receipt_number text;
  v_payment jsonb;
  v_result jsonb;
begin
  if not public.can_access_owner_data(p_owner_user_id) then
    raise exception 'No autorizado para registrar pagos de este owner';
  end if;

  if coalesce(p_client_id, '') = '' or v_payment_id = '' then
    raise exception 'Cliente y pago son requeridos';
  end if;

  if coalesce(p_payment->>'clientId', '') <> p_client_id then
    raise exception 'El pago no pertenece al cliente solicitado';
  end if;

  -- El mismo lock de la secuencia hace seguro un reintento concurrente.
  perform pg_advisory_xact_lock(hashtextextended(p_owner_user_id::text, 0));

  select data
    into v_existing_payment
  from public.payments_cloud
  where user_id = p_owner_user_id
    and id = v_payment_id;

  if v_existing_payment is not null then
    if coalesce(v_existing_payment->>'clientId', '') <> p_client_id then
      raise exception 'El pago existente pertenece a otro cliente';
    end if;

    select data
      into v_current_client
    from public.clients_cloud
    where user_id = p_owner_user_id
      and id = p_client_id;

    return jsonb_build_object(
      'client', v_current_client,
      'payment', v_existing_payment,
      'idempotent', true
    );
  end if;

  v_receipts := public.next_receipt_numbers(p_owner_user_id, 1);
  v_receipt_number := v_receipts[1];
  if coalesce(v_receipt_number, '') = '' then
    raise exception 'No se pudo reservar el numero de recibo';
  end if;

  v_payment := jsonb_set(p_payment, '{receiptNumber}', to_jsonb(v_receipt_number), true);
  v_result := public.register_client_payment_deltas(
    p_owner_user_id,
    p_client_id,
    p_expected_balance_before,
    p_next_client,
    jsonb_build_array(v_payment)
  );

  return jsonb_build_object(
    'client', v_result->'client',
    'payment', v_payment,
    'idempotent', coalesce((v_result->>'idempotent')::boolean, false)
  );
end;
$$;

grant execute on function public.register_client_payment_with_receipt(uuid, text, numeric, jsonb, jsonb) to authenticated;
