-- Rentautos: optimizaciones de lectura para Supabase/Postgres
-- Ejecutar despues de los scripts cloud existentes.
--
-- Objetivos:
--   1) Evitar scans lentos en filtros por owner/user.
--   2) Evitar que RLS recalcule auth.uid()/helpers por cada fila.
--   3) Mantener el mismo modelo de permisos: owner, owner compartido y admin.

-- ============================================================================
-- 1) Funciones helper cacheables para RLS
-- ============================================================================

create or replace function public.current_user_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.user_profiles
  where id = (select auth.uid())
  limit 1;
$$;

create or replace function public.has_role(required_role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_profiles
    where id = (select auth.uid())
      and role = required_role
  );
$$;

create or replace function public.current_data_owner_user_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(up.data_owner_user_id, up.id)
  from public.user_profiles up
  where up.id = (select auth.uid())
  limit 1;
$$;

create or replace function public.can_access_owner_data(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    target_user_id = (select auth.uid())
    or (select public.has_role('admin'))
    or target_user_id = (select public.current_data_owner_user_id());
$$;

-- ============================================================================
-- 2) Indices para filtros frecuentes, realtime y paginacion por cursor
-- ============================================================================

create index if not exists clients_cloud_user_updated_idx
  on public.clients_cloud (user_id, updated_at desc);

create index if not exists payments_cloud_user_updated_idx
  on public.payments_cloud (user_id, updated_at desc);

create index if not exists payment_promises_cloud_user_updated_idx
  on public.payment_promises_cloud (user_id, updated_at desc);

do $$
begin
  if to_regclass('public.fleet_units_cloud') is not null then
    create index if not exists fleet_units_cloud_user_unit_idx
      on public.fleet_units_cloud (user_id, unit_id);
  end if;
end $$;

do $$
declare
  item record;
begin
  for item in
    select *
    from (values
      ('clients_daily_collection_cloud', 'clients_daily_collection_cloud_updated_idx'),
      ('clients_daily_collection_am_seals_cloud', 'clients_daily_collection_am_seals_cloud_updated_idx'),
      ('clients_daily_collection_pm_seals_cloud', 'clients_daily_collection_pm_seals_cloud_updated_idx'),
      ('clients_daily_collection_close_seals_cloud', 'clients_daily_collection_close_seals_cloud_updated_idx'),
      ('clients_daily_collection_promises_cloud', 'clients_daily_collection_promises_cloud_updated_idx'),
      ('clients_daily_collection_street_actions_cloud', 'clients_daily_collection_street_actions_cloud_updated_idx')
    ) as indexes(table_name, index_name)
  loop
    if to_regclass(format('public.%I', item.table_name)) is not null then
      execute format(
        'create index if not exists %I on public.%I (user_id, updated_at desc)',
        item.index_name,
        item.table_name
      );
    end if;
  end loop;
end $$;

-- ============================================================================
-- 3) Politicas RLS unificadas y cacheables para tablas con user_id
-- ============================================================================

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'clients_cloud',
    'payments_cloud',
    'payment_promises_cloud',
    'street_management_cloud',
    'collection_closures_cloud',
    'pending_bank_items_cloud',
    'pending_card_items_cloud',
    'bank_rules_cloud',
    'manual_assignment_audit_cloud',
    'late_fee_ledger_cloud',
    'notified_payments_cloud',
    'cash_closings_cloud',
    'cash_closing_audit_cloud',
    'charge_runs_cloud',
    'receipt_sequences_cloud',
    'late_fee_settings_cloud',
    'other_charges_retention_cloud',
    'client_ui_prefs_cloud',
    'clients_daily_collection_cloud',
    'clients_daily_collection_am_seals_cloud',
    'clients_daily_collection_pm_seals_cloud',
    'clients_daily_collection_close_seals_cloud',
    'clients_daily_collection_promises_cloud',
    'clients_daily_collection_street_actions_cloud'
  ]
  loop
    if to_regclass(format('public.%I', table_name)) is null then
      continue;
    end if;

    execute format('alter table public.%I enable row level security', table_name);

    execute format('drop policy if exists %I on public.%I', table_name || '_owner_access_optimized', table_name);
    execute format('drop policy if exists %I on public.%I', replace(table_name, '_cloud', '') || '_shared_owner_access', table_name);
    execute format('drop policy if exists %I on public.%I', replace(table_name, '_cloud', '') || '_select_own_or_admin', table_name);
    execute format('drop policy if exists %I on public.%I', replace(table_name, '_cloud', '') || '_insert_own_or_admin', table_name);
    execute format('drop policy if exists %I on public.%I', replace(table_name, '_cloud', '') || '_update_own_or_admin', table_name);
    execute format('drop policy if exists %I on public.%I', replace(table_name, '_cloud', '') || '_delete_own_or_admin', table_name);
    execute format('drop policy if exists %I on public.%I', replace(table_name, '_cloud', '') || '_select_own', table_name);
    execute format('drop policy if exists %I on public.%I', replace(table_name, '_cloud', '') || '_insert_own', table_name);
    execute format('drop policy if exists %I on public.%I', replace(table_name, '_cloud', '') || '_update_own', table_name);
    execute format('drop policy if exists %I on public.%I', replace(table_name, '_cloud', '') || '_delete_own', table_name);

    execute format(
      'create policy %I on public.%I for all to authenticated using ((select public.can_access_owner_data(user_id))) with check ((select public.can_access_owner_data(user_id)))',
      table_name || '_owner_access_optimized',
      table_name
    );
  end loop;
end $$;
