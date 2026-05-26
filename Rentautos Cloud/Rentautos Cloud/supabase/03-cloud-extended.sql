-- Rentautos: esquema cloud extendido para migracion desde localStorage
-- Ejecutar despues de:
--   1) supabase/01-auth-roles.sql
--   2) supabase/02-cloud-data.sql
-- Este script crea solo estructura + RLS/policies (sin cargar data).

-- ============================================================================
-- 1) Tablas tipo "coleccion" (key -> array de registros)
-- ============================================================================

create table if not exists public.pending_bank_items_cloud (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.pending_card_items_cloud (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.bank_rules_cloud (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.manual_assignment_audit_cloud (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.late_fee_ledger_cloud (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.notified_payments_cloud (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.cash_closings_cloud (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.cash_closing_audit_cloud (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.charge_runs_cloud (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

-- ============================================================================
-- 2) Tablas tipo "singleton por usuario" (key -> objeto/configuracion)
-- ============================================================================

create table if not exists public.receipt_sequences_cloud (
  user_id uuid primary key references auth.users(id) on delete cascade,
  seq integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.late_fee_settings_cloud (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.other_charges_retention_cloud (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.client_ui_prefs_cloud (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status_filter text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_ui_prefs_cloud_status_filter_chk
    check (status_filter is null or status_filter in ('all', 'active', 'inactive', 'archived'))
);

-- ============================================================================
-- 3) Indices utiles
-- ============================================================================

create index if not exists pending_bank_items_cloud_user_idx on public.pending_bank_items_cloud (user_id);
create index if not exists pending_card_items_cloud_user_idx on public.pending_card_items_cloud (user_id);
create index if not exists bank_rules_cloud_user_idx on public.bank_rules_cloud (user_id);
create index if not exists manual_assignment_audit_cloud_user_idx on public.manual_assignment_audit_cloud (user_id);
create index if not exists late_fee_ledger_cloud_user_idx on public.late_fee_ledger_cloud (user_id);
create index if not exists notified_payments_cloud_user_idx on public.notified_payments_cloud (user_id);
create index if not exists cash_closings_cloud_user_idx on public.cash_closings_cloud (user_id);
create index if not exists cash_closing_audit_cloud_user_idx on public.cash_closing_audit_cloud (user_id);
create index if not exists charge_runs_cloud_user_idx on public.charge_runs_cloud (user_id);

-- ============================================================================
-- 4) RLS + policies
-- ============================================================================

alter table public.pending_bank_items_cloud enable row level security;
alter table public.pending_card_items_cloud enable row level security;
alter table public.bank_rules_cloud enable row level security;
alter table public.manual_assignment_audit_cloud enable row level security;
alter table public.late_fee_ledger_cloud enable row level security;
alter table public.notified_payments_cloud enable row level security;
alter table public.cash_closings_cloud enable row level security;
alter table public.cash_closing_audit_cloud enable row level security;
alter table public.charge_runs_cloud enable row level security;
alter table public.receipt_sequences_cloud enable row level security;
alter table public.late_fee_settings_cloud enable row level security;
alter table public.other_charges_retention_cloud enable row level security;
alter table public.client_ui_prefs_cloud enable row level security;

-- pending_bank_items_cloud
drop policy if exists "pending_bank_items_select_own_or_admin" on public.pending_bank_items_cloud;
create policy "pending_bank_items_select_own_or_admin" on public.pending_bank_items_cloud
for select to authenticated using (user_id = auth.uid() or public.has_role('admin'));
drop policy if exists "pending_bank_items_insert_own_or_admin" on public.pending_bank_items_cloud;
create policy "pending_bank_items_insert_own_or_admin" on public.pending_bank_items_cloud
for insert to authenticated with check (user_id = auth.uid() or public.has_role('admin'));
drop policy if exists "pending_bank_items_update_own_or_admin" on public.pending_bank_items_cloud;
create policy "pending_bank_items_update_own_or_admin" on public.pending_bank_items_cloud
for update to authenticated using (user_id = auth.uid() or public.has_role('admin'))
with check (user_id = auth.uid() or public.has_role('admin'));
drop policy if exists "pending_bank_items_delete_own_or_admin" on public.pending_bank_items_cloud;
create policy "pending_bank_items_delete_own_or_admin" on public.pending_bank_items_cloud
for delete to authenticated using (user_id = auth.uid() or public.has_role('admin'));

-- pending_card_items_cloud
drop policy if exists "pending_card_items_select_own_or_admin" on public.pending_card_items_cloud;
create policy "pending_card_items_select_own_or_admin" on public.pending_card_items_cloud
for select to authenticated using (user_id = auth.uid() or public.has_role('admin'));
drop policy if exists "pending_card_items_insert_own_or_admin" on public.pending_card_items_cloud;
create policy "pending_card_items_insert_own_or_admin" on public.pending_card_items_cloud
for insert to authenticated with check (user_id = auth.uid() or public.has_role('admin'));
drop policy if exists "pending_card_items_update_own_or_admin" on public.pending_card_items_cloud;
create policy "pending_card_items_update_own_or_admin" on public.pending_card_items_cloud
for update to authenticated using (user_id = auth.uid() or public.has_role('admin'))
with check (user_id = auth.uid() or public.has_role('admin'));
drop policy if exists "pending_card_items_delete_own_or_admin" on public.pending_card_items_cloud;
create policy "pending_card_items_delete_own_or_admin" on public.pending_card_items_cloud
for delete to authenticated using (user_id = auth.uid() or public.has_role('admin'));

-- bank_rules_cloud
drop policy if exists "bank_rules_select_own_or_admin" on public.bank_rules_cloud;
create policy "bank_rules_select_own_or_admin" on public.bank_rules_cloud
for select to authenticated using (user_id = auth.uid() or public.has_role('admin'));
drop policy if exists "bank_rules_insert_own_or_admin" on public.bank_rules_cloud;
create policy "bank_rules_insert_own_or_admin" on public.bank_rules_cloud
for insert to authenticated with check (user_id = auth.uid() or public.has_role('admin'));
drop policy if exists "bank_rules_update_own_or_admin" on public.bank_rules_cloud;
create policy "bank_rules_update_own_or_admin" on public.bank_rules_cloud
for update to authenticated using (user_id = auth.uid() or public.has_role('admin'))
with check (user_id = auth.uid() or public.has_role('admin'));
drop policy if exists "bank_rules_delete_own_or_admin" on public.bank_rules_cloud;
create policy "bank_rules_delete_own_or_admin" on public.bank_rules_cloud
for delete to authenticated using (user_id = auth.uid() or public.has_role('admin'));

-- manual_assignment_audit_cloud
drop policy if exists "manual_assignment_audit_select_own_or_admin" on public.manual_assignment_audit_cloud;
create policy "manual_assignment_audit_select_own_or_admin" on public.manual_assignment_audit_cloud
for select to authenticated using (user_id = auth.uid() or public.has_role('admin'));
drop policy if exists "manual_assignment_audit_insert_own_or_admin" on public.manual_assignment_audit_cloud;
create policy "manual_assignment_audit_insert_own_or_admin" on public.manual_assignment_audit_cloud
for insert to authenticated with check (user_id = auth.uid() or public.has_role('admin'));
drop policy if exists "manual_assignment_audit_update_own_or_admin" on public.manual_assignment_audit_cloud;
create policy "manual_assignment_audit_update_own_or_admin" on public.manual_assignment_audit_cloud
for update to authenticated using (user_id = auth.uid() or public.has_role('admin'))
with check (user_id = auth.uid() or public.has_role('admin'));
drop policy if exists "manual_assignment_audit_delete_own_or_admin" on public.manual_assignment_audit_cloud;
create policy "manual_assignment_audit_delete_own_or_admin" on public.manual_assignment_audit_cloud
for delete to authenticated using (user_id = auth.uid() or public.has_role('admin'));

-- late_fee_ledger_cloud
drop policy if exists "late_fee_ledger_select_own_or_admin" on public.late_fee_ledger_cloud;
create policy "late_fee_ledger_select_own_or_admin" on public.late_fee_ledger_cloud
for select to authenticated using (user_id = auth.uid() or public.has_role('admin'));
drop policy if exists "late_fee_ledger_insert_own_or_admin" on public.late_fee_ledger_cloud;
create policy "late_fee_ledger_insert_own_or_admin" on public.late_fee_ledger_cloud
for insert to authenticated with check (user_id = auth.uid() or public.has_role('admin'));
drop policy if exists "late_fee_ledger_update_own_or_admin" on public.late_fee_ledger_cloud;
create policy "late_fee_ledger_update_own_or_admin" on public.late_fee_ledger_cloud
for update to authenticated using (user_id = auth.uid() or public.has_role('admin'))
with check (user_id = auth.uid() or public.has_role('admin'));
drop policy if exists "late_fee_ledger_delete_own_or_admin" on public.late_fee_ledger_cloud;
create policy "late_fee_ledger_delete_own_or_admin" on public.late_fee_ledger_cloud
for delete to authenticated using (user_id = auth.uid() or public.has_role('admin'));

-- notified_payments_cloud
drop policy if exists "notified_payments_select_own_or_admin" on public.notified_payments_cloud;
create policy "notified_payments_select_own_or_admin" on public.notified_payments_cloud
for select to authenticated using (user_id = auth.uid() or public.has_role('admin'));
drop policy if exists "notified_payments_insert_own_or_admin" on public.notified_payments_cloud;
create policy "notified_payments_insert_own_or_admin" on public.notified_payments_cloud
for insert to authenticated with check (user_id = auth.uid() or public.has_role('admin'));
drop policy if exists "notified_payments_update_own_or_admin" on public.notified_payments_cloud;
create policy "notified_payments_update_own_or_admin" on public.notified_payments_cloud
for update to authenticated using (user_id = auth.uid() or public.has_role('admin'))
with check (user_id = auth.uid() or public.has_role('admin'));
drop policy if exists "notified_payments_delete_own_or_admin" on public.notified_payments_cloud;
create policy "notified_payments_delete_own_or_admin" on public.notified_payments_cloud
for delete to authenticated using (user_id = auth.uid() or public.has_role('admin'));

-- cash_closings_cloud
drop policy if exists "cash_closings_select_own_or_admin" on public.cash_closings_cloud;
create policy "cash_closings_select_own_or_admin" on public.cash_closings_cloud
for select to authenticated using (user_id = auth.uid() or public.has_role('admin'));
drop policy if exists "cash_closings_insert_own_or_admin" on public.cash_closings_cloud;
create policy "cash_closings_insert_own_or_admin" on public.cash_closings_cloud
for insert to authenticated with check (user_id = auth.uid() or public.has_role('admin'));
drop policy if exists "cash_closings_update_own_or_admin" on public.cash_closings_cloud;
create policy "cash_closings_update_own_or_admin" on public.cash_closings_cloud
for update to authenticated using (user_id = auth.uid() or public.has_role('admin'))
with check (user_id = auth.uid() or public.has_role('admin'));
drop policy if exists "cash_closings_delete_own_or_admin" on public.cash_closings_cloud;
create policy "cash_closings_delete_own_or_admin" on public.cash_closings_cloud
for delete to authenticated using (user_id = auth.uid() or public.has_role('admin'));

-- cash_closing_audit_cloud
drop policy if exists "cash_closing_audit_select_own_or_admin" on public.cash_closing_audit_cloud;
create policy "cash_closing_audit_select_own_or_admin" on public.cash_closing_audit_cloud
for select to authenticated using (user_id = auth.uid() or public.has_role('admin'));
drop policy if exists "cash_closing_audit_insert_own_or_admin" on public.cash_closing_audit_cloud;
create policy "cash_closing_audit_insert_own_or_admin" on public.cash_closing_audit_cloud
for insert to authenticated with check (user_id = auth.uid() or public.has_role('admin'));
drop policy if exists "cash_closing_audit_update_own_or_admin" on public.cash_closing_audit_cloud;
create policy "cash_closing_audit_update_own_or_admin" on public.cash_closing_audit_cloud
for update to authenticated using (user_id = auth.uid() or public.has_role('admin'))
with check (user_id = auth.uid() or public.has_role('admin'));
drop policy if exists "cash_closing_audit_delete_own_or_admin" on public.cash_closing_audit_cloud;
create policy "cash_closing_audit_delete_own_or_admin" on public.cash_closing_audit_cloud
for delete to authenticated using (user_id = auth.uid() or public.has_role('admin'));

-- charge_runs_cloud
drop policy if exists "charge_runs_select_own_or_admin" on public.charge_runs_cloud;
create policy "charge_runs_select_own_or_admin" on public.charge_runs_cloud
for select to authenticated using (user_id = auth.uid() or public.has_role('admin'));
drop policy if exists "charge_runs_insert_own_or_admin" on public.charge_runs_cloud;
create policy "charge_runs_insert_own_or_admin" on public.charge_runs_cloud
for insert to authenticated with check (user_id = auth.uid() or public.has_role('admin'));
drop policy if exists "charge_runs_update_own_or_admin" on public.charge_runs_cloud;
create policy "charge_runs_update_own_or_admin" on public.charge_runs_cloud
for update to authenticated using (user_id = auth.uid() or public.has_role('admin'))
with check (user_id = auth.uid() or public.has_role('admin'));
drop policy if exists "charge_runs_delete_own_or_admin" on public.charge_runs_cloud;
create policy "charge_runs_delete_own_or_admin" on public.charge_runs_cloud
for delete to authenticated using (user_id = auth.uid() or public.has_role('admin'));

-- receipt_sequences_cloud
drop policy if exists "receipt_sequences_select_own_or_admin" on public.receipt_sequences_cloud;
create policy "receipt_sequences_select_own_or_admin" on public.receipt_sequences_cloud
for select to authenticated using (user_id = auth.uid() or public.has_role('admin'));
drop policy if exists "receipt_sequences_insert_own_or_admin" on public.receipt_sequences_cloud;
create policy "receipt_sequences_insert_own_or_admin" on public.receipt_sequences_cloud
for insert to authenticated with check (user_id = auth.uid() or public.has_role('admin'));
drop policy if exists "receipt_sequences_update_own_or_admin" on public.receipt_sequences_cloud;
create policy "receipt_sequences_update_own_or_admin" on public.receipt_sequences_cloud
for update to authenticated using (user_id = auth.uid() or public.has_role('admin'))
with check (user_id = auth.uid() or public.has_role('admin'));
drop policy if exists "receipt_sequences_delete_own_or_admin" on public.receipt_sequences_cloud;
create policy "receipt_sequences_delete_own_or_admin" on public.receipt_sequences_cloud
for delete to authenticated using (user_id = auth.uid() or public.has_role('admin'));

-- late_fee_settings_cloud
drop policy if exists "late_fee_settings_select_own_or_admin" on public.late_fee_settings_cloud;
create policy "late_fee_settings_select_own_or_admin" on public.late_fee_settings_cloud
for select to authenticated using (user_id = auth.uid() or public.has_role('admin'));
drop policy if exists "late_fee_settings_insert_own_or_admin" on public.late_fee_settings_cloud;
create policy "late_fee_settings_insert_own_or_admin" on public.late_fee_settings_cloud
for insert to authenticated with check (user_id = auth.uid() or public.has_role('admin'));
drop policy if exists "late_fee_settings_update_own_or_admin" on public.late_fee_settings_cloud;
create policy "late_fee_settings_update_own_or_admin" on public.late_fee_settings_cloud
for update to authenticated using (user_id = auth.uid() or public.has_role('admin'))
with check (user_id = auth.uid() or public.has_role('admin'));
drop policy if exists "late_fee_settings_delete_own_or_admin" on public.late_fee_settings_cloud;
create policy "late_fee_settings_delete_own_or_admin" on public.late_fee_settings_cloud
for delete to authenticated using (user_id = auth.uid() or public.has_role('admin'));

-- other_charges_retention_cloud
drop policy if exists "other_charges_retention_select_own_or_admin" on public.other_charges_retention_cloud;
create policy "other_charges_retention_select_own_or_admin" on public.other_charges_retention_cloud
for select to authenticated using (user_id = auth.uid() or public.has_role('admin'));
drop policy if exists "other_charges_retention_insert_own_or_admin" on public.other_charges_retention_cloud;
create policy "other_charges_retention_insert_own_or_admin" on public.other_charges_retention_cloud
for insert to authenticated with check (user_id = auth.uid() or public.has_role('admin'));
drop policy if exists "other_charges_retention_update_own_or_admin" on public.other_charges_retention_cloud;
create policy "other_charges_retention_update_own_or_admin" on public.other_charges_retention_cloud
for update to authenticated using (user_id = auth.uid() or public.has_role('admin'))
with check (user_id = auth.uid() or public.has_role('admin'));
drop policy if exists "other_charges_retention_delete_own_or_admin" on public.other_charges_retention_cloud;
create policy "other_charges_retention_delete_own_or_admin" on public.other_charges_retention_cloud
for delete to authenticated using (user_id = auth.uid() or public.has_role('admin'));

-- client_ui_prefs_cloud
drop policy if exists "client_ui_prefs_select_own_or_admin" on public.client_ui_prefs_cloud;
create policy "client_ui_prefs_select_own_or_admin" on public.client_ui_prefs_cloud
for select to authenticated using (user_id = auth.uid() or public.has_role('admin'));
drop policy if exists "client_ui_prefs_insert_own_or_admin" on public.client_ui_prefs_cloud;
create policy "client_ui_prefs_insert_own_or_admin" on public.client_ui_prefs_cloud
for insert to authenticated with check (user_id = auth.uid() or public.has_role('admin'));
drop policy if exists "client_ui_prefs_update_own_or_admin" on public.client_ui_prefs_cloud;
create policy "client_ui_prefs_update_own_or_admin" on public.client_ui_prefs_cloud
for update to authenticated using (user_id = auth.uid() or public.has_role('admin'))
with check (user_id = auth.uid() or public.has_role('admin'));
drop policy if exists "client_ui_prefs_delete_own_or_admin" on public.client_ui_prefs_cloud;
create policy "client_ui_prefs_delete_own_or_admin" on public.client_ui_prefs_cloud
for delete to authenticated using (user_id = auth.uid() or public.has_role('admin'));
