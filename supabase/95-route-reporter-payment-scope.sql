-- Rentautos: permite que los usuarios autorizados para notificar cobros en Ruta
-- emitan el recibo de efectivo sin otorgarles edicion general de Pagos.
-- Ejecutar despues de 94-route-cash-receipt-delete-cancels-report.sql.

drop policy if exists "payments_cloud_route_insert" on public.payments_cloud;
create policy "payments_cloud_route_insert"
on public.payments_cloud
for insert
to authenticated
with check (
  (select public.can_report_route_payment(user_id))
  and data ->> 'source' = 'route'
);

drop policy if exists "notified_payments_cloud_route_insert" on public.notified_payments_cloud;
create policy "notified_payments_cloud_route_insert"
on public.notified_payments_cloud
for insert
to authenticated
with check (
  (select public.can_report_route_payment(user_id))
  and data ->> 'source' = 'route'
  and data ->> 'paymentMethod' = 'bank'
);

create or replace function public.guard_payment_write_scope()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if public.can_edit_owner_screen(new.user_id, 'payments') then
    return new;
  end if;

  if tg_op = 'INSERT'
     and public.can_report_route_payment(new.user_id)
     and new.data ->> 'source' = 'route' then
    return new;
  end if;

  raise exception 'No autorizado para modificar pagos de este owner';
end;
$$;

drop trigger if exists guard_payment_write_scope on public.payments_cloud;
create trigger guard_payment_write_scope
before insert or update on public.payments_cloud
for each row
execute function public.guard_payment_write_scope();

revoke all on function public.guard_payment_write_scope() from public, anon, authenticated;
