-- Carga completa y liviana del efectivo pendiente sin recorrer todo el historial.
create index if not exists payments_cloud_pending_cash_date_idx
on public.payments_cloud (
  user_id,
  (coalesce(nullif(data ->> 'fundsReceivedDate', ''), data ->> 'dateApplied'))
)
where data ->> 'paymentMethod' = 'Efectivo'
  and data ->> 'moneyDelivered' = 'false';

create or replace function public.read_pending_cash_payments(
  p_user_id uuid,
  p_through_date date
)
returns setof jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_user_id is null or p_through_date is null then
    raise exception 'Owner y fecha son obligatorios.';
  end if;

  if not (
    coalesce(public.can_view_owner_screen(p_user_id, 'payments'), false)
    or coalesce(public.can_view_owner_screen(p_user_id, 'receivables'), false)
    or coalesce(public.can_view_owner_screen(p_user_id, 'route_search'), false)
  ) then
    raise exception 'No tienes permiso para ver el efectivo pendiente.';
  end if;

  return query
  select payment.data
  from public.payments_cloud payment
  where payment.user_id = p_user_id
    and payment.data ->> 'paymentMethod' = 'Efectivo'
    and payment.data ->> 'moneyDelivered' = 'false'
    and coalesce(
      nullif(payment.data ->> 'fundsReceivedDate', ''),
      payment.data ->> 'dateApplied'
    ) <= p_through_date::text
  order by
    coalesce(
      nullif(payment.data ->> 'fundsReceivedDate', ''),
      payment.data ->> 'dateApplied'
    ),
    payment.id;
end;
$$;

revoke all on function public.read_pending_cash_payments(uuid, date) from public, anon;
grant execute on function public.read_pending_cash_payments(uuid, date) to authenticated;

notify pgrst, 'reload schema';
