-- Rentautos: reset estricto de politicas RLS por rol.
-- Ejecutar despues de 18-secure-user-profiles-and-role-rls.sql.
--
-- Esta migracion corrige instalaciones que conservaron politicas antiguas
-- permisivas junto a las nuevas. Borra todas las politicas de las tablas
-- operativas/configuracion/caja conocidas y recrea solamente las politicas
-- role-scoped.

create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select public.current_user_role() = 'admin'::public.app_role;
$$;

create or replace function public.is_operator_or_admin()
returns boolean
language sql
stable
as $$
  select public.current_user_role() in ('admin'::public.app_role, 'operador'::public.app_role);
$$;

create or replace function public.can_write_owner_data(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_access_owner_data(target_user_id)
    and public.current_user_role() in ('admin'::public.app_role, 'operador'::public.app_role);
$$;

create or replace function public.can_manage_owner_settings(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_access_owner_data(target_user_id)
    and public.current_user_role() = 'admin'::public.app_role;
$$;

create or replace function public.prevent_self_privilege_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() = old.id
    and not public.is_admin()
    and (
      old.role is distinct from new.role
      or old.data_owner_user_id is distinct from new.data_owner_user_id
    )
  then
    raise exception 'No puedes cambiar tu rol ni el dataset asignado.';
  end if;

  if not public.is_admin()
    and auth.uid() is distinct from old.id
  then
    raise exception 'Solo admin puede modificar otros perfiles.';
  end if;

  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_profiles_prevent_self_privilege_update on public.user_profiles;
create trigger user_profiles_prevent_self_privilege_update
before update on public.user_profiles
for each row execute function public.prevent_self_privilege_update();

do $$
declare
  policy_record record;
begin
  for policy_record in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'user_profiles'
  loop
    execute format('drop policy if exists %I on public.user_profiles', policy_record.policyname);
  end loop;
end $$;

create policy "profiles_select_role_scoped"
on public.user_profiles
for select
to authenticated
using (
  id = auth.uid()
  or public.is_admin()
  or id = public.current_data_owner_user_id()
);

create policy "profiles_insert_admin"
on public.user_profiles
for insert
to authenticated
with check (public.is_admin());

create policy "profiles_update_self_safe_or_admin"
on public.user_profiles
for update
to authenticated
using (id = auth.uid() or public.is_admin())
with check (id = auth.uid() or public.is_admin());

create policy "profiles_delete_admin"
on public.user_profiles
for delete
to authenticated
using (public.is_admin());

do $$
declare
  table_name text;
  policy_record record;
begin
  foreach table_name in array array[
    'clients_cloud',
    'payments_cloud',
    'street_management_cloud',
    'collection_closures_cloud',
    'payment_promises_cloud',
    'pending_bank_items_cloud',
    'pending_card_items_cloud',
    'manual_assignment_audit_cloud',
    'late_fee_ledger_cloud',
    'notified_payments_cloud',
    'cash_closings_cloud',
    'cash_closing_audit_cloud',
    'charge_runs_cloud',
    'receipt_sequences_cloud',
    'lead_evaluations_cloud',
    'fleet_units_cloud',
    'clients_daily_collection_cloud',
    'clients_daily_collection_am_seals_cloud',
    'clients_daily_collection_pm_seals_cloud',
    'clients_daily_collection_close_seals_cloud',
    'clients_daily_collection_promises_cloud',
    'clients_daily_collection_street_actions_cloud'
  ] loop
    for policy_record in
      select policyname
      from pg_policies
      where schemaname = 'public'
        and tablename = table_name
    loop
      execute format('drop policy if exists %I on public.%I', policy_record.policyname, table_name);
    end loop;

    execute format(
      'create policy %I on public.%I for select to authenticated using (public.can_access_owner_data(user_id))',
      table_name || '_role_read',
      table_name
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.can_write_owner_data(user_id))',
      table_name || '_role_insert',
      table_name
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.can_write_owner_data(user_id)) with check (public.can_write_owner_data(user_id))',
      table_name || '_role_update',
      table_name
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using (public.can_write_owner_data(user_id))',
      table_name || '_role_delete',
      table_name
    );
  end loop;
end $$;

do $$
declare
  table_name text;
  policy_record record;
begin
  foreach table_name in array array[
    'bank_rules_cloud',
    'late_fee_settings_cloud',
    'other_charges_retention_cloud',
    'client_ui_prefs_cloud'
  ] loop
    for policy_record in
      select policyname
      from pg_policies
      where schemaname = 'public'
        and tablename = table_name
    loop
      execute format('drop policy if exists %I on public.%I', policy_record.policyname, table_name);
    end loop;

    execute format(
      'create policy %I on public.%I for select to authenticated using (public.can_access_owner_data(user_id))',
      table_name || '_role_read',
      table_name
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.can_manage_owner_settings(user_id))',
      table_name || '_role_insert',
      table_name
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.can_manage_owner_settings(user_id)) with check (public.can_manage_owner_settings(user_id))',
      table_name || '_role_update',
      table_name
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using (public.can_manage_owner_settings(user_id))',
      table_name || '_role_delete',
      table_name
    );
  end loop;
end $$;

do $$
declare
  table_name text;
  policy_record record;
begin
  foreach table_name in array array[
    'cash_day_openings',
    'cash_day_adjustments',
    'cash_day_closings'
  ] loop
    for policy_record in
      select policyname
      from pg_policies
      where schemaname = 'public'
        and tablename = table_name
    loop
      execute format('drop policy if exists %I on public.%I', policy_record.policyname, table_name);
    end loop;

    execute format(
      'create policy %I on public.%I for select to authenticated using (public.can_access_owner_data(owner_user_id))',
      table_name || '_role_read',
      table_name
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.can_manage_owner_settings(owner_user_id))',
      table_name || '_role_insert',
      table_name
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.can_manage_owner_settings(owner_user_id)) with check (public.can_manage_owner_settings(owner_user_id))',
      table_name || '_role_update',
      table_name
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using (public.can_manage_owner_settings(owner_user_id))',
      table_name || '_role_delete',
      table_name
    );
  end loop;

  foreach table_name in array array[
    'cash_day_movements',
    'cash_day_counts'
  ] loop
    for policy_record in
      select policyname
      from pg_policies
      where schemaname = 'public'
        and tablename = table_name
    loop
      execute format('drop policy if exists %I on public.%I', policy_record.policyname, table_name);
    end loop;

    execute format(
      'create policy %I on public.%I for select to authenticated using (public.can_access_owner_data(owner_user_id))',
      table_name || '_role_read',
      table_name
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.can_write_owner_data(owner_user_id))',
      table_name || '_role_insert',
      table_name
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.can_write_owner_data(owner_user_id)) with check (public.can_write_owner_data(owner_user_id))',
      table_name || '_role_update',
      table_name
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using (public.can_write_owner_data(owner_user_id))',
      table_name || '_role_delete',
      table_name
    );
  end loop;

  for policy_record in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'cash_audit_log'
  loop
    execute format('drop policy if exists %I on public.cash_audit_log', policy_record.policyname);
  end loop;

  create policy "cash_audit_log_role_read"
  on public.cash_audit_log
  for select
  to authenticated
  using (public.can_access_owner_data(owner_user_id));
end $$;

grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_operator_or_admin() to authenticated;
grant execute on function public.can_write_owner_data(uuid) to authenticated;
grant execute on function public.can_manage_owner_settings(uuid) to authenticated;
