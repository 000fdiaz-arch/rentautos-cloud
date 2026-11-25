-- Historial de pagos por cliente para la pantalla guiada de Cuentas por Cobrar.
-- Agrega una ruta de lectura indexada; no modifica pagos ni saldos.

create index if not exists payments_cloud_user_client_history_idx
on public.payments_cloud (
  user_id,
  (data->>'clientId'),
  (data->>'dateApplied') desc,
  (data->>'createdAt') desc,
  id desc
)
where nullif(data->>'clientId', '') is not null;

create index if not exists payments_cloud_user_unit_history_idx
on public.payments_cloud (
  user_id,
  (data->>'clientUnit'),
  (data->>'dateApplied') desc,
  (data->>'createdAt') desc,
  id desc
)
where nullif(data->>'clientUnit', '') is not null;

create or replace function public.payment_history_for_receivable_target(
  p_owner_user_id uuid,
  p_client_id text,
  p_unit_id text default null
)
returns table(id text, data jsonb)
language sql
stable
security definer
set search_path = public
as $$
  with direct_history as (
    select payment.id, payment.data
    from public.payments_cloud payment
    where payment.user_id = p_owner_user_id
      and payment.data->>'clientId' = nullif(trim(p_client_id), '')
      and coalesce(payment.data->>'paymentMethod', '') <> 'Descuento'
      and public.can_access_owner_data(p_owner_user_id)
  ),
  unit_history as (
    select payment.id, payment.data
    from public.payments_cloud payment
    where payment.user_id = p_owner_user_id
      and payment.data->>'clientUnit' = nullif(trim(p_unit_id), '')
      and coalesce(payment.data->>'paymentMethod', '') <> 'Descuento'
      and public.can_access_owner_data(p_owner_user_id)
      and not exists (select 1 from direct_history)
  )
  select history.id, history.data
  from (
    select * from direct_history
    union all
    select * from unit_history
  ) history
  order by
    history.data->>'dateApplied' desc nulls last,
    history.data->>'createdAt' desc nulls last,
    history.id desc;
$$;

revoke execute on function public.payment_history_for_receivable_target(uuid, text, text) from public;
revoke execute on function public.payment_history_for_receivable_target(uuid, text, text) from anon;
grant execute on function public.payment_history_for_receivable_target(uuid, text, text) to authenticated;

analyze public.payments_cloud;
