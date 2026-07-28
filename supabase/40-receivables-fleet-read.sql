-- Rentautos: Cuentas por cobrar necesita leer la flota completa.
-- Ejecutar despues de 39-receivables-core-read-and-settings-read.sql.

do $$
declare
  policy_record record;
begin
  if to_regclass('public.fleet_units_cloud') is null then
    return;
  end if;

  for policy_record in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'fleet_units_cloud'
  loop
    execute format('drop policy if exists %I on public.fleet_units_cloud', policy_record.policyname);
  end loop;

  create policy "fleet_units_operational_read"
  on public.fleet_units_cloud
  for select
  to authenticated
  using (
    (select public.can_view_owner_screen(user_id, 'control_units'))
    or (select public.can_view_owner_screen(user_id, 'receivables'))
  );

  create policy "fleet_units_control_units_insert"
  on public.fleet_units_cloud
  for insert
  to authenticated
  with check ((select public.can_edit_owner_screen(user_id, 'control_units')));

  create policy "fleet_units_control_units_update"
  on public.fleet_units_cloud
  for update
  to authenticated
  using ((select public.can_edit_owner_screen(user_id, 'control_units')))
  with check ((select public.can_edit_owner_screen(user_id, 'control_units')));

  create policy "fleet_units_control_units_delete"
  on public.fleet_units_cloud
  for delete
  to authenticated
  using ((select public.can_edit_owner_screen(user_id, 'control_units')));
end $$;

alter view public.vw_control_unidades
  set (security_invoker = true);

grant select on public.vw_control_unidades to authenticated;
