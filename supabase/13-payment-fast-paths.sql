-- Rentautos: rutas rapidas para pagos/importacion bancaria.
-- Ejecutar despues de 04-folio-guard.sql y 12-performance-optimization.sql.

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

create or replace function public.find_existing_processed_payment_folios(
  p_owner_user_id uuid,
  p_folios text[]
)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  with input_folios as (
    select distinct nullif(upper(regexp_replace(coalesce(raw_folio, ''), '\s+', '', 'g')), '') as folio
    from unnest(coalesce(p_folios, array[]::text[])) as raw_folio
  )
  select coalesce(array_agg(i.folio order by i.folio), array[]::text[])
  from input_folios i
  where i.folio is not null
    and public.can_access_owner_data(p_owner_user_id)
    and exists (
      select 1
      from public.payments_cloud p
      where p.user_id = p_owner_user_id
        and public.extract_payment_folio(p.data->>'reference') = i.folio
        and (
          p.data->>'paymentMethod' in ('ACH Express', 'Deposito Bancario', 'Transferencia Bancaria')
          or (
            p.data->>'paymentMethod' = 'Tarjeta'
            and upper(coalesce(p.data->>'reference', '')) like '%TARJETA-CONCILIADA%'
          )
        )
    );
$$;

insert into public.receipt_sequences_cloud (user_id, seq)
select user_id, max(public.parse_payment_receipt_sequence(data->>'receiptNumber')) as seq
from public.payments_cloud
where public.parse_payment_receipt_sequence(data->>'receiptNumber') is not null
group by user_id
on conflict (user_id) do update
set seq = greatest(public.receipt_sequences_cloud.seq, excluded.seq),
    updated_at = now();

create or replace function public.next_receipt_number(p_owner_user_id uuid)
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

  last_payment_seq := coalesce(last_payment_seq, 0);
  stored_seq := coalesce(stored_seq, 0);
  base_seq := greatest(last_payment_seq, stored_seq);
  next_seq := base_seq + 1;

  update public.receipt_sequences_cloud
  set seq = next_seq,
      updated_at = now()
  where user_id = p_owner_user_id;

  if not found then
    insert into public.receipt_sequences_cloud (user_id, seq)
    values (p_owner_user_id, next_seq);
  end if;

  return 'REC-' || lpad(next_seq::text, 4, '0');
end;
$$;
