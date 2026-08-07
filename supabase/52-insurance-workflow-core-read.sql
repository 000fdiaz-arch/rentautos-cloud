-- Rentautos: Reclamos a seguros necesita leer clientes y autos para autocompletar unidad, nombre y placa.
-- Ejecutar despues de 51-insurance-claims-cloud.sql.

do $$
begin
  if to_regclass('public.clients_cloud') is not null then
    drop policy if exists "clients_cloud_operational_read" on public.clients_cloud;
    create policy "clients_cloud_operational_read"
    on public.clients_cloud
    for select
    to authenticated
    using (
      (select public.can_view_owner_screen(user_id, 'clients'))
      or (select public.can_view_owner_screen(user_id, 'payments'))
      or (select public.can_view_owner_screen(user_id, 'receivables'))
      or (select public.can_view_owner_screen(user_id, 'route_search'))
      or (select public.can_view_owner_screen(user_id, 'insurance_workflow'))
    );
  end if;

  if to_regclass('public.fleet_units_cloud') is not null then
    drop policy if exists "fleet_units_operational_read" on public.fleet_units_cloud;
    create policy "fleet_units_operational_read"
    on public.fleet_units_cloud
    for select
    to authenticated
    using (
      (select public.can_view_owner_screen(user_id, 'control_units'))
      or (select public.can_view_owner_screen(user_id, 'receivables'))
      or (select public.can_view_owner_screen(user_id, 'insurance_workflow'))
    );
  end if;
end $$;

do $$
begin
  if to_regclass('public.vw_control_unidades') is not null then
    alter view public.vw_control_unidades
      set (security_invoker = true);

    grant select on public.vw_control_unidades to authenticated;
  end if;
end $$;
