-- Rentautos: resincroniza y blinda la secuencia de recibos.
-- Usar cuando Supabase rechaza pagos por recibo duplicado.

create or replace function public.parse_payment_receipt_sequence(receipt_number text)
returns integer
language sql
immutable
as $$
  select nullif(substring(upper(coalesce(receipt_number, '')) from '^REC-([0-9]+)$'), '')::integer;
$$;

create index if not exists payments_cloud_user_receipt_seq_idx
  on public.payments_cloud (
    user_id,
    public.parse_payment_receipt_sequence(data->>'receiptNumber') desc
  )
  where public.parse_payment_receipt_sequence(data->>'receiptNumber') is not null;

insert into public.receipt_sequences_cloud (user_id, seq)
select user_id, max(public.parse_payment_receipt_sequence(data->>'receiptNumber')) as seq
from public.payments_cloud
where public.parse_payment_receipt_sequence(data->>'receiptNumber') is not null
group by user_id
on conflict (user_id) do update
set seq = greatest(public.receipt_sequences_cloud.seq, excluded.seq),
    updated_at = now();

drop function if exists public.next_receipt_number(uuid);

create function public.next_receipt_number(p_owner_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  last_payment_seq integer := 0;
  stored_seq integer := 0;
  base_seq integer;
  next_seq integer;
  next_receipt text;
begin
  if not public.can_access_owner_data(p_owner_user_id) then
    raise exception 'No autorizado para reservar recibo de este owner';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_owner_user_id::text, 0));

  select coalesce(max(public.parse_payment_receipt_sequence(data->>'receiptNumber')), 0)
    into last_payment_seq
  from public.payments_cloud
  where user_id = p_owner_user_id;

  select coalesce(seq, 0)
    into stored_seq
  from public.receipt_sequences_cloud
  where user_id = p_owner_user_id
  for update;

  base_seq := greatest(coalesce(last_payment_seq, 0), coalesce(stored_seq, 0));
  next_seq := base_seq + 1;

  loop
    next_receipt := 'REC-' || lpad(next_seq::text, 4, '0');
    exit when not exists (
      select 1
      from public.payments_cloud
      where user_id = p_owner_user_id
        and upper(coalesce(data->>'receiptNumber', '')) = next_receipt
    );
    next_seq := next_seq + 1;
  end loop;

  update public.receipt_sequences_cloud
  set seq = next_seq,
      updated_at = now()
  where user_id = p_owner_user_id;

  if not found then
    insert into public.receipt_sequences_cloud (user_id, seq)
    values (p_owner_user_id, next_seq);
  end if;

  return next_receipt;
end;
$$;

drop function if exists public.next_receipt_numbers(uuid, integer);

create function public.next_receipt_numbers(p_owner_user_id uuid, p_count integer)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_count integer;
  last_payment_seq integer := 0;
  stored_seq integer := 0;
  next_seq integer;
  receipts text[] := array[]::text[];
  next_receipt text;
begin
  if not public.can_access_owner_data(p_owner_user_id) then
    raise exception 'No autorizado para reservar recibos de este owner';
  end if;

  safe_count := greatest(1, least(500, coalesce(p_count, 1)));
  perform pg_advisory_xact_lock(hashtextextended(p_owner_user_id::text, 0));

  select coalesce(max(public.parse_payment_receipt_sequence(data->>'receiptNumber')), 0)
    into last_payment_seq
  from public.payments_cloud
  where user_id = p_owner_user_id;

  select coalesce(seq, 0)
    into stored_seq
  from public.receipt_sequences_cloud
  where user_id = p_owner_user_id
  for update;

  next_seq := greatest(coalesce(last_payment_seq, 0), coalesce(stored_seq, 0)) + 1;

  while array_length(receipts, 1) is null or array_length(receipts, 1) < safe_count loop
    next_receipt := 'REC-' || lpad(next_seq::text, 4, '0');

    if not exists (
      select 1
      from public.payments_cloud
      where user_id = p_owner_user_id
        and upper(coalesce(data->>'receiptNumber', '')) = next_receipt
    ) then
      receipts := receipts || next_receipt;
    end if;

    next_seq := next_seq + 1;
  end loop;

  update public.receipt_sequences_cloud
  set seq = next_seq - 1,
      updated_at = now()
  where user_id = p_owner_user_id;

  if not found then
    insert into public.receipt_sequences_cloud (user_id, seq)
    values (p_owner_user_id, next_seq - 1);
  end if;

  return receipts;
end;
$$;
