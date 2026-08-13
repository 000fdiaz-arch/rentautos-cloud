-- Rentautos: permite registrar cobros desde Ruta en calle sin otorgar edicion
-- general de Pagos. Ejecutar despues de 58-route-payment-registration.sql.

drop policy if exists "payments_cloud_route_insert" on public.payments_cloud;
create policy "payments_cloud_route_insert"
on public.payments_cloud
for insert
to authenticated
with check (
  (select public.can_edit_owner_screen(user_id, 'route_search'))
  and data ->> 'source' = 'route'
);

drop policy if exists "notified_payments_cloud_route_insert" on public.notified_payments_cloud;
create policy "notified_payments_cloud_route_insert"
on public.notified_payments_cloud
for insert
to authenticated
with check (
  (select public.can_edit_owner_screen(user_id, 'route_search'))
  and data ->> 'source' = 'route'
  and data ->> 'paymentMethod' = 'bank'
);

-- Las funciones atomicas de pago son security definer. Este trigger conserva
-- el limite de permisos incluso dentro de esas funciones: Ruta solo puede
-- insertar pagos identificados como originados en Ruta, nunca editar o borrar.
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
     and public.can_edit_owner_screen(new.user_id, 'route_search')
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
