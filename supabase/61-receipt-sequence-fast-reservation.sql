-- Rentautos: reserva recibos sin recorrer todo payments_cloud.
-- Ejecutar despues de 60-route-payment-scope.sql.

create or replace function public.next_receipt_numbers(p_owner_user_id uuid, p_count integer)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_count integer := greatest(1, least(500, coalesce(p_count, 1)));
  next_seq integer;
  next_receipt text;
  receipts text[] := array[]::text[];
begin
  if not public.can_access_owner_data(p_owner_user_id) then
    raise exception 'No autorizado para reservar recibos de este owner';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_owner_user_id::text, 0));

  insert into public.receipt_sequences_cloud (user_id, seq)
  values (p_owner_user_id, 0)
  on conflict (user_id) do nothing;

  select seq + 1
    into next_seq
  from public.receipt_sequences_cloud
  where user_id = p_owner_user_id
  for update;

  while coalesce(array_length(receipts, 1), 0) < safe_count loop
    next_receipt := 'REC-' || case
      when next_seq < 10000 then lpad(next_seq::text, 4, '0')
      else next_seq::text
    end;

    if not exists (
      select 1
      from public.payments_cloud
      where user_id = p_owner_user_id
        and nullif(btrim(coalesce(data->>'receiptNumber', '')), '') is not null
        and data->>'receiptNumber' = next_receipt
    ) then
      receipts := receipts || next_receipt;
    end if;

    next_seq := next_seq + 1;
  end loop;

  update public.receipt_sequences_cloud
  set seq = next_seq - 1,
      updated_at = now()
  where user_id = p_owner_user_id;

  return receipts;
end;
$$;

create or replace function public.next_receipt_number(p_owner_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  reserved_receipts text[];
begin
  reserved_receipts := public.next_receipt_numbers(p_owner_user_id, 1);
  return reserved_receipts[1];
end;
$$;

grant execute on function public.next_receipt_numbers(uuid, integer) to authenticated;
grant execute on function public.next_receipt_number(uuid) to authenticated;
