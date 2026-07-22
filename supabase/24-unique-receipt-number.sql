-- Rentautos: evita recibos duplicados por owner.
-- Ejecutar despues de 15-receipt-sequence-resync.sql y 22-payment-deltas.sql.

create or replace function public.parse_payment_receipt_sequence(receipt_number text)
returns integer
language sql
immutable
as $$
  select nullif(substring(upper(coalesce(receipt_number, '')) from '^REC-([0-9]+)$'), '')::integer;
$$;

do $$
begin
  if exists (
    select 1
    from (
      select
        user_id,
        upper(trim(data->>'receiptNumber')) as receipt_number,
        count(*) as total
      from public.payments_cloud
      where nullif(trim(data->>'receiptNumber'), '') is not null
      group by user_id, upper(trim(data->>'receiptNumber'))
      having count(*) > 1
    ) duplicated
  ) then
    raise exception 'Existen recibos duplicados en payments_cloud. Resolver antes de crear indice unico.';
  end if;
end $$;

create unique index if not exists payments_cloud_user_receipt_number_uq
on public.payments_cloud (
  user_id,
  upper(trim(data->>'receiptNumber'))
)
where nullif(trim(data->>'receiptNumber'), '') is not null;

insert into public.receipt_sequences_cloud (user_id, seq)
select user_id, max(public.parse_payment_receipt_sequence(data->>'receiptNumber')) as seq
from public.payments_cloud
where public.parse_payment_receipt_sequence(data->>'receiptNumber') is not null
group by user_id
on conflict (user_id) do update
set seq = greatest(public.receipt_sequences_cloud.seq, excluded.seq),
    updated_at = now();
