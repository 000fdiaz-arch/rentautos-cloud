-- Pago notificado y En revisión comparten la cola cuando la unidad está en la ruta activa.
drop policy if exists route_report_read on public.route_payment_reports;
create policy route_report_read on public.route_payment_reports for select to authenticated
  using (
    public.can_view_owner_screen(user_id, 'route_search')
    or public.can_view_owner_screen(user_id, 'receivables')
    or public.can_view_owner_screen(user_id, 'payments')
  );

-- Pagos puede crear el reporte bancario vinculado, pero el RPC mantiene la
-- validación de cliente, publicación y ruta activa como fuente de verdad.
create or replace function public.can_report_route_payment(p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
    and exists (
      select 1
      from public.user_profiles p
      where p.id = auth.uid()
        and p.is_active
        and (
          (
            coalesce(public.can_view_owner_screen(p_user_id, 'route_search'), false)
            and (p.role::text = 'buscador' or coalesce(public.can_edit_owner_screen(p_user_id, 'route_search'), false))
          )
          or coalesce(public.can_edit_owner_screen(p_user_id, 'payments'), false)
        )
    );
$$;

create or replace function public.cancel_route_payment_report(p_report_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_report public.route_payment_reports;
  v_can_edit_route boolean;
  v_can_edit_payments boolean;
begin
  select * into v_report from public.route_payment_reports where id = p_report_id for update;
  if not found then raise exception 'No existe el reporte indicado.'; end if;

  v_can_edit_route := coalesce(public.can_edit_owner_screen(v_report.user_id, 'route_search'), false);
  v_can_edit_payments := coalesce(public.can_edit_owner_screen(v_report.user_id, 'payments'), false);
  if not coalesce(public.can_report_route_payment(v_report.user_id), false)
    or (v_report.reported_by <> auth.uid() and not v_can_edit_route and not v_can_edit_payments) then
    raise exception 'No tienes permiso para devolver este reporte.';
  end if;
  if v_report.status <> 'review' then raise exception 'Solo puedes devolver reportes pendientes.'; end if;

  update public.route_payment_reports
  set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = clock_timestamp()
  where id = p_report_id;
end;
$$;

-- Al confirmarse o devolverse el reporte, elimina cualquier aviso persistido
-- que esté enlazado. Las vistas que leen directamente el reporte se actualizan
-- por Realtime y no necesitan una copia adicional.
create or replace function public.remove_notified_payment_for_closed_route_report()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status <> 'review' then
    delete from public.notified_payments_cloud
    where user_id = new.user_id and data->>'routeReportId' = new.id::text;
  end if;
  return new;
end;
$$;

drop trigger if exists route_report_remove_linked_notice on public.route_payment_reports;
create trigger route_report_remove_linked_notice
after update of status on public.route_payment_reports
for each row
when (old.status is distinct from new.status)
execute function public.remove_notified_payment_for_closed_route_report();

revoke all on function public.remove_notified_payment_for_closed_route_report() from public, anon, authenticated;
notify pgrst, 'reload schema';
