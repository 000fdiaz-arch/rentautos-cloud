-- Ultimo pago real de varios clientes en una sola consulta.
-- Los registros con paymentMethod = Descuento se excluyen desde la base.

create or replace function public.latest_non_discount_payments_for_receivable_targets(
  p_owner_user_id uuid,
  p_client_ids text[],
  p_unit_ids text[] default array[]::text[]
)
returns table(id text, data jsonb)
language sql
stable
security definer
set search_path = public
as $$
  with direct_latest as (
    select distinct on (payment.data->>'clientId')
      payment.id,
      payment.data
    from public.payments_cloud payment
    where payment.user_id = p_owner_user_id
      and payment.data->>'clientId' = any(coalesce(p_client_ids, array[]::text[]))
      and coalesce(payment.data->>'paymentMethod', '') <> 'Descuento'
      and public.can_access_owner_data(p_owner_user_id)
    order by
      payment.data->>'clientId',
      payment.data->>'dateApplied' desc nulls last,
      payment.data->>'createdAt' desc nulls last,
      payment.id desc
  ),
  unit_latest as (
    select distinct on (payment.data->>'clientUnit')
      payment.id,
      payment.data
    from public.payments_cloud payment
    where payment.user_id = p_owner_user_id
      and payment.data->>'clientUnit' = any(coalesce(p_unit_ids, array[]::text[]))
      and coalesce(payment.data->>'paymentMethod', '') <> 'Descuento'
      and public.can_access_owner_data(p_owner_user_id)
    order by
      payment.data->>'clientUnit',
      payment.data->>'dateApplied' desc nulls last,
      payment.data->>'createdAt' desc nulls last,
      payment.id desc
  )
  select distinct on (candidate.id) candidate.id, candidate.data
  from (
    select * from direct_latest
    union all
    select * from unit_latest
  ) candidate
  order by candidate.id;
$$;

revoke execute on function public.latest_non_discount_payments_for_receivable_targets(uuid, text[], text[]) from public;
revoke execute on function public.latest_non_discount_payments_for_receivable_targets(uuid, text[], text[]) from anon;
grant execute on function public.latest_non_discount_payments_for_receivable_targets(uuid, text[], text[]) to authenticated;
