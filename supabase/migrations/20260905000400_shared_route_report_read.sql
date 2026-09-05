-- Ambas vistas consultan los mismos reportes; no cambia ningún permiso de escritura.
drop policy if exists route_report_read on public.route_payment_reports;
create policy route_report_read on public.route_payment_reports for select to authenticated
  using (public.can_view_owner_screen(user_id,'route_search') or public.can_view_owner_screen(user_id,'receivables'));

create or replace function public.read_route_report_receipts(p_user_id uuid, p_report_id uuid)
returns setof jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not (coalesce(public.can_view_owner_screen(p_user_id, 'route_search'), false) or coalesce(public.can_view_owner_screen(p_user_id, 'receivables'), false)) then
    raise exception 'No tienes permiso para ver estos recibos.';
  end if;
  return query select p.data from public.payments_cloud p
    join public.route_report_payment_links l on l.user_id = p.user_id and l.payment_id = p.id
    join public.route_payment_reports r on r.id = l.report_id and r.user_id = l.user_id
    where r.user_id = p_user_id and r.id = p_report_id and r.status = 'confirmed'
    order by p.id;
end;
$$;
revoke all on function public.read_route_report_receipts(uuid,uuid) from public, anon;
grant execute on function public.read_route_report_receipts(uuid,uuid) to authenticated;
notify pgrst, 'reload schema';
