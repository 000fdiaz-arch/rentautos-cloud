create or replace function public.set_route_report_management_outcome(
  p_report_id uuid,
  p_management_outcome text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_report public.route_payment_reports;
begin
  if p_management_outcome is null or p_management_outcome not in ('collected', 'remote') then
    raise exception 'Selecciona si fue cobrado o gestión remota.';
  end if;

  select * into v_report
  from public.route_payment_reports
  where id = p_report_id
  for update;

  if not found or v_report.status = 'cancelled' then
    raise exception 'No existe el registro indicado.';
  end if;

  if not coalesce(public.is_admin(), false)
    or not coalesce(public.can_edit_owner_screen(v_report.user_id, 'route_search'), false) then
    raise exception 'Solo Administración puede cambiar el resultado de una gestión.';
  end if;

  update public.route_payment_reports
  set management_outcome = p_management_outcome
  where id = p_report_id;
end;
$$;

revoke all on function public.set_route_report_management_outcome(uuid,text) from public, anon;
grant execute on function public.set_route_report_management_outcome(uuid,text) to authenticated;

notify pgrst, 'reload schema';
