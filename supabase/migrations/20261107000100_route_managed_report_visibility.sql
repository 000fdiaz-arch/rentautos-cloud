alter table public.route_payment_reports
  add column if not exists managed_hidden_at timestamptz,
  add column if not exists managed_hidden_by uuid references auth.users(id) on delete set null;

create or replace function public.hide_route_managed_report(p_report_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_report public.route_payment_reports;
begin
  select * into v_report
  from public.route_payment_reports
  where id = p_report_id
  for update;

  if not found then
    raise exception 'No existe el registro indicado.';
  end if;

  if not coalesce(public.is_admin(), false)
    or not coalesce(public.can_edit_owner_screen(v_report.user_id, 'route_search'), false) then
    raise exception 'No tienes permiso para quitar este registro.';
  end if;

  update public.route_payment_reports
  set managed_hidden_at = clock_timestamp(),
      managed_hidden_by = auth.uid()
  where id = p_report_id;
end;
$$;

revoke all on function public.hide_route_managed_report(uuid) from public, anon;
grant execute on function public.hide_route_managed_report(uuid) to authenticated;

notify pgrst, 'reload schema';
