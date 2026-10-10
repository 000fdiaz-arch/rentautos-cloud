-- Confirmación manual de banca para Ruta: solo un administrador puede convertir
-- un reporte bancario pendiente en un pago regular.

create or replace function public.can_confirm_route_bank_payment(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from public.user_profiles p
      where p.id = auth.uid()
        and p.is_active
        and p.role::text = 'admin'
    )
    and coalesce(public.can_access_owner_data(p_user_id), false)
    and coalesce(public.can_edit_owner_screen(p_user_id, 'payments'), false);
$$;

create or replace function public.is_valid_admin_route_bank_confirmation(
  p_user_id uuid,
  p_payment jsonb
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.can_confirm_route_bank_payment(p_user_id), false)
    and coalesce(p_payment->>'source', '') = 'route'
    and coalesce(p_payment->>'paymentMethod', '') in (
      'ACH Express',
      'Deposito Bancario',
      'Transferencia Bancaria'
    )
    and exists (
      select 1
      from public.route_payment_reports r
      where r.id::text = p_payment->'bankConfirmation'->>'routeReportId'
        and r.user_id = p_user_id
        and r.status = 'review'
        and r.bank_amount > r.confirmed_bank_amount
        and public.route_report_matches_payment(r, p_payment)
        and (p_payment->>'createdAt')::timestamptz >= r.reported_at
    );
$$;

drop policy if exists "payments_cloud_route_insert" on public.payments_cloud;
create policy "payments_cloud_route_insert"
on public.payments_cloud
for insert
to authenticated
with check (
  data->>'source' = 'route'
  and (
    (
      data->>'paymentMethod' = 'Efectivo'
      and (select public.can_report_route_payment(user_id))
    )
    or (select public.is_valid_admin_route_bank_confirmation(user_id, data))
  )
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

  if tg_op = 'INSERT'
     and new.data->>'source' = 'route'
     and new.data->>'paymentMethod' in (
       'ACH Express',
       'Deposito Bancario',
       'Transferencia Bancaria'
     ) then
    if public.is_valid_admin_route_bank_confirmation(new.user_id, new.data) then
      return new;
    end if;
    raise exception 'Solo el administrador puede confirmar pagos bancarios de Ruta';
  end if;

  if public.can_edit_owner_screen(new.user_id, 'payments') then
    return new;
  end if;

  if tg_op = 'INSERT'
     and public.can_report_route_payment(new.user_id)
     and new.data->>'source' = 'route'
     and new.data->>'paymentMethod' = 'Efectivo' then
    return new;
  end if;

  raise exception 'No autorizado para modificar pagos de este owner';
end;
$$;

-- Refuerza la limpieza del aviso cuando el reporte deja de estar pendiente y
-- corrige avisos enlazados que hayan quedado de confirmaciones anteriores.
drop trigger if exists route_report_remove_linked_notice on public.route_payment_reports;
create trigger route_report_remove_linked_notice
after update of status on public.route_payment_reports
for each row
when (old.status is distinct from new.status)
execute function public.remove_notified_payment_for_closed_route_report();

delete from public.notified_payments_cloud n
using public.route_payment_reports r
where n.user_id = r.user_id
  and n.data->>'routeReportId' = r.id::text
  and r.status <> 'review';

revoke all on function public.can_confirm_route_bank_payment(uuid) from public, anon, authenticated;
revoke all on function public.is_valid_admin_route_bank_confirmation(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.is_valid_admin_route_bank_confirmation(uuid, jsonb) to authenticated;
revoke all on function public.guard_payment_write_scope() from public, anon, authenticated;
notify pgrst, 'reload schema';
