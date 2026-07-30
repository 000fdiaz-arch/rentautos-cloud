-- Rentautos: permisos por pantalla.
-- Ejecutar despues de 19-reset-role-rls-policies.sql.
--
-- Mantiene los roles como plantillas, pero permite ajustar por usuario:
-- permissions = {
--   "clients": {"view": true, "edit": false},
--   "payments": {"view": true, "edit": true},
--   ...
-- }

alter table public.user_profiles
  add column if not exists permissions jsonb not null default '{}'::jsonb;

create or replace function public.default_screen_permissions(p_role public.app_role)
returns jsonb
language sql
stable
as $$
  select case p_role
    when 'admin'::public.app_role then
      '{
        "leads": {"view": true, "edit": true},
        "clients": {"view": true, "edit": true},
        "payments": {"view": true, "edit": true},
        "receivables": {"view": true, "edit": true},
        "control_units": {"view": true, "edit": true},
        "settings": {"view": true, "edit": true},
        "users": {"view": true, "edit": true}
      }'::jsonb
    when 'operador'::public.app_role then
      '{
        "leads": {"view": true, "edit": true},
        "clients": {"view": true, "edit": true},
        "payments": {"view": true, "edit": true},
        "receivables": {"view": true, "edit": true},
        "control_units": {"view": true, "edit": true},
        "settings": {"view": false, "edit": false},
        "users": {"view": false, "edit": false}
      }'::jsonb
    else
      '{
        "leads": {"view": false, "edit": false},
        "clients": {"view": false, "edit": false},
        "payments": {"view": false, "edit": false},
        "receivables": {"view": false, "edit": false},
        "control_units": {"view": true, "edit": false},
        "settings": {"view": false, "edit": false},
        "users": {"view": false, "edit": false}
      }'::jsonb
  end;
$$;

create or replace function public.current_user_screen_permissions()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.default_screen_permissions(up.role) || coalesce(up.permissions, '{}'::jsonb)
  from public.user_profiles up
  where up.id = auth.uid();
$$;

create or replace function public.current_user_can_view_screen(p_screen text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((public.current_user_screen_permissions() -> p_screen ->> 'view')::boolean, false);
$$;

create or replace function public.current_user_can_edit_screen(p_screen text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_can_view_screen(p_screen)
    and coalesce((public.current_user_screen_permissions() -> p_screen ->> 'edit')::boolean, false);
$$;

create or replace function public.can_view_owner_screen(target_user_id uuid, p_screen text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_access_owner_data(target_user_id)
    and public.current_user_can_view_screen(p_screen);
$$;

create or replace function public.can_edit_owner_screen(target_user_id uuid, p_screen text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_access_owner_data(target_user_id)
    and public.current_user_can_edit_screen(p_screen);
$$;

create or replace function public.can_manage_users()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin()
    and public.current_user_can_edit_screen('users');
$$;

create or replace function public.prevent_self_privilege_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() = old.id
    and not public.can_manage_users()
    and (
      old.role is distinct from new.role
      or old.data_owner_user_id is distinct from new.data_owner_user_id
      or old.permissions is distinct from new.permissions
    )
  then
    raise exception 'No puedes cambiar tu rol, permisos ni el dataset asignado.';
  end if;

  if not public.can_manage_users()
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

create policy "profiles_select_screen_scoped"
on public.user_profiles
for select
to authenticated
using (
  id = auth.uid()
  or public.can_manage_users()
  or id = public.current_data_owner_user_id()
);

create policy "profiles_insert_users_manager"
on public.user_profiles
for insert
to authenticated
with check (public.can_manage_users());

create policy "profiles_update_self_safe_or_users_manager"
on public.user_profiles
for update
to authenticated
using (id = auth.uid() or public.can_manage_users())
with check (id = auth.uid() or public.can_manage_users());

create policy "profiles_delete_users_manager"
on public.user_profiles
for delete
to authenticated
using (public.can_manage_users());

do $$
declare
  mapping record;
  policy_record record;
begin
  for mapping in
    select *
    from (values
      ('clients_cloud', 'clients'),
      ('payments_cloud', 'payments'),
      ('pending_bank_items_cloud', 'payments'),
      ('pending_card_items_cloud', 'payments'),
      ('manual_assignment_audit_cloud', 'payments'),
      ('late_fee_ledger_cloud', 'payments'),
      ('notified_payments_cloud', 'payments'),
      ('cash_closings_cloud', 'payments'),
      ('cash_closing_audit_cloud', 'payments'),
      ('charge_runs_cloud', 'payments'),
      ('receipt_sequences_cloud', 'payments'),
      ('payment_promises_cloud', 'payments'),
      ('lead_evaluations_cloud', 'leads'),
      ('fleet_units_cloud', 'control_units'),
      ('street_management_cloud', 'receivables'),
      ('street_management_items_cloud', 'receivables'),
      ('collection_closures_cloud', 'receivables'),
      ('clients_daily_collection_cloud', 'payments'),
      ('clients_daily_collection_am_seals_cloud', 'payments'),
      ('clients_daily_collection_pm_seals_cloud', 'payments'),
      ('clients_daily_collection_close_seals_cloud', 'payments'),
      ('clients_daily_collection_promises_cloud', 'payments'),
      ('clients_daily_collection_street_actions_cloud', 'payments')
    ) as screen_tables(table_name, screen_name)
  loop
    for policy_record in
      select policyname
      from pg_policies
      where schemaname = 'public'
        and tablename = mapping.table_name
    loop
      execute format('drop policy if exists %I on public.%I', policy_record.policyname, mapping.table_name);
    end loop;

    execute format(
      'create policy %I on public.%I for select to authenticated using (public.can_view_owner_screen(user_id, %L))',
      mapping.table_name || '_screen_read',
      mapping.table_name,
      mapping.screen_name
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.can_edit_owner_screen(user_id, %L))',
      mapping.table_name || '_screen_insert',
      mapping.table_name,
      mapping.screen_name
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.can_edit_owner_screen(user_id, %L)) with check (public.can_edit_owner_screen(user_id, %L))',
      mapping.table_name || '_screen_update',
      mapping.table_name,
      mapping.screen_name,
      mapping.screen_name
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using (public.can_edit_owner_screen(user_id, %L))',
      mapping.table_name || '_screen_delete',
      mapping.table_name,
      mapping.screen_name
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
      'create policy %I on public.%I for select to authenticated using (public.can_view_owner_screen(user_id, %L))',
      table_name || '_screen_read',
      table_name,
      'settings'
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.can_edit_owner_screen(user_id, %L))',
      table_name || '_screen_insert',
      table_name,
      'settings'
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.can_edit_owner_screen(user_id, %L)) with check (public.can_edit_owner_screen(user_id, %L))',
      table_name || '_screen_update',
      table_name,
      'settings',
      'settings'
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using (public.can_edit_owner_screen(user_id, %L))',
      table_name || '_screen_delete',
      table_name,
      'settings'
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
    'cash_day_movements',
    'cash_day_adjustments',
    'cash_day_closings',
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
      'create policy %I on public.%I for select to authenticated using (public.can_view_owner_screen(owner_user_id, %L))',
      table_name || '_screen_read',
      table_name,
      'payments'
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.can_edit_owner_screen(owner_user_id, %L))',
      table_name || '_screen_insert',
      table_name,
      'payments'
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.can_edit_owner_screen(owner_user_id, %L)) with check (public.can_edit_owner_screen(owner_user_id, %L))',
      table_name || '_screen_update',
      table_name,
      'payments',
      'payments'
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using (public.can_edit_owner_screen(owner_user_id, %L))',
      table_name || '_screen_delete',
      table_name,
      'payments'
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

  create policy "cash_audit_log_screen_read"
  on public.cash_audit_log
  for select
  to authenticated
  using (public.can_view_owner_screen(owner_user_id, 'payments'));
end $$;

grant execute on function public.default_screen_permissions(public.app_role) to authenticated;
grant execute on function public.current_user_screen_permissions() to authenticated;
grant execute on function public.current_user_can_view_screen(text) to authenticated;
grant execute on function public.current_user_can_edit_screen(text) to authenticated;
grant execute on function public.can_view_owner_screen(uuid, text) to authenticated;
grant execute on function public.can_edit_owner_screen(uuid, text) to authenticated;
grant execute on function public.can_manage_users() to authenticated;
