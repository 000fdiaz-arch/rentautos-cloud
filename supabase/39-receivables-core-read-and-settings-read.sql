-- Rentautos: lecturas necesarias por flujo operativo.
-- Ejecutar despues de 35-receivables-screen-permissions.sql.

do $$
declare
  table_name text;
  policy_record record;
begin
  foreach table_name in array array['clients_cloud', 'payments_cloud'] loop
    for policy_record in
      select policyname
      from pg_policies
      where schemaname = 'public'
        and tablename = table_name
    loop
      execute format('drop policy if exists %I on public.%I', policy_record.policyname, table_name);
    end loop;
  end loop;

  create policy "clients_cloud_operational_read"
  on public.clients_cloud
  for select
  to authenticated
  using (
    (select public.can_view_owner_screen(user_id, 'clients'))
    or (select public.can_view_owner_screen(user_id, 'payments'))
    or (select public.can_view_owner_screen(user_id, 'receivables'))
  );

  create policy "clients_cloud_clients_insert"
  on public.clients_cloud
  for insert
  to authenticated
  with check (
    (select public.can_edit_owner_screen(user_id, 'clients'))
    or (select public.can_edit_owner_screen(user_id, 'payments'))
  );

  create policy "clients_cloud_clients_update"
  on public.clients_cloud
  for update
  to authenticated
  using (
    (select public.can_edit_owner_screen(user_id, 'clients'))
    or (select public.can_edit_owner_screen(user_id, 'payments'))
  )
  with check (
    (select public.can_edit_owner_screen(user_id, 'clients'))
    or (select public.can_edit_owner_screen(user_id, 'payments'))
  );

  create policy "clients_cloud_clients_delete"
  on public.clients_cloud
  for delete
  to authenticated
  using ((select public.can_edit_owner_screen(user_id, 'clients')));

  create policy "payments_cloud_operational_read"
  on public.payments_cloud
  for select
  to authenticated
  using (
    (select public.can_view_owner_screen(user_id, 'payments'))
    or (select public.can_view_owner_screen(user_id, 'receivables'))
  );

  create policy "payments_cloud_payments_insert"
  on public.payments_cloud
  for insert
  to authenticated
  with check ((select public.can_edit_owner_screen(user_id, 'payments')));

  create policy "payments_cloud_payments_update"
  on public.payments_cloud
  for update
  to authenticated
  using ((select public.can_edit_owner_screen(user_id, 'payments')))
  with check ((select public.can_edit_owner_screen(user_id, 'payments')));

  create policy "payments_cloud_payments_delete"
  on public.payments_cloud
  for delete
  to authenticated
  using ((select public.can_edit_owner_screen(user_id, 'payments')));
end $$;

do $$
declare
  table_name text;
  policy_record record;
begin
  foreach table_name in array array[
    'bank_rules_cloud',
    'late_fee_settings_cloud',
    'other_charges_retention_cloud'
  ] loop
    if to_regclass(format('public.%I', table_name)) is null then
      continue;
    end if;

    for policy_record in
      select policyname
      from pg_policies
      where schemaname = 'public'
        and tablename = table_name
    loop
      execute format('drop policy if exists %I on public.%I', policy_record.policyname, table_name);
    end loop;

    execute format(
      'create policy %I on public.%I for select to authenticated using ((select public.can_view_owner_screen(user_id, %L)) or (select public.can_view_owner_screen(user_id, %L)))',
      table_name || '_settings_or_payments_read',
      table_name,
      'settings',
      'payments'
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check ((select public.can_edit_owner_screen(user_id, %L)))',
      table_name || '_settings_insert',
      table_name,
      'settings'
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using ((select public.can_edit_owner_screen(user_id, %L))) with check ((select public.can_edit_owner_screen(user_id, %L)))',
      table_name || '_settings_update',
      table_name,
      'settings',
      'settings'
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using ((select public.can_edit_owner_screen(user_id, %L)))',
      table_name || '_settings_delete',
      table_name,
      'settings'
    );
  end loop;
end $$;
