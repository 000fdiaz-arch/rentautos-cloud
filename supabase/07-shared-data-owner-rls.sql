-- Rentautos: dataset compartido por owner (admin + cobradora)
-- Ejecutar despues de:
--   1) supabase/01-auth-roles.sql
--   2) supabase/02-cloud-data.sql
--   3) supabase/03-cloud-extended.sql
--   4) supabase/03-street-management-cloud.sql
--   5) supabase/05-payment-promises-cloud.sql
--   6) supabase/06-collection-closures-cloud.sql

-- 1) Agrega data_owner_user_id al perfil (si no existe)
alter table public.user_profiles
  add column if not exists data_owner_user_id uuid references auth.users(id) on delete set null;

create index if not exists user_profiles_data_owner_user_id_idx
  on public.user_profiles (data_owner_user_id);

-- 2) Funciones helper para acceso a dataset compartido
create or replace function public.current_data_owner_user_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(up.data_owner_user_id, up.id)
  from public.user_profiles up
  where up.id = auth.uid()
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
    target_user_id = auth.uid()
    or public.has_role('admin')
    or target_user_id = public.current_data_owner_user_id();
$$;

-- 3) Permisos de lectura/edicion de perfiles para configurar owner
drop policy if exists "profiles_select_own_or_admin" on public.user_profiles;
create policy "profiles_select_own_or_admin"
on public.user_profiles
for select
to authenticated
using (
  id = auth.uid()
  or public.has_role('admin')
  or id = public.current_data_owner_user_id()
);

drop policy if exists "profiles_update_own_or_admin" on public.user_profiles;
create policy "profiles_update_own_or_admin"
on public.user_profiles
for update
to authenticated
using (
  id = auth.uid()
  or public.has_role('admin')
)
with check (
  id = auth.uid()
  or public.has_role('admin')
);

-- 4) Política compartida para tablas cloud (sin borrar políticas anteriores)

-- clients_cloud
drop policy if exists "clients_shared_owner_access" on public.clients_cloud;
create policy "clients_shared_owner_access" on public.clients_cloud
for all to authenticated
using (public.can_access_owner_data(user_id))
with check (public.can_access_owner_data(user_id));

-- payments_cloud
drop policy if exists "payments_shared_owner_access" on public.payments_cloud;
create policy "payments_shared_owner_access" on public.payments_cloud
for all to authenticated
using (public.can_access_owner_data(user_id))
with check (public.can_access_owner_data(user_id));

-- street_management_cloud
drop policy if exists "street_management_shared_owner_access" on public.street_management_cloud;
create policy "street_management_shared_owner_access" on public.street_management_cloud
for all to authenticated
using (public.can_access_owner_data(user_id))
with check (public.can_access_owner_data(user_id));

-- collection_closures_cloud
drop policy if exists "collection_closures_shared_owner_access" on public.collection_closures_cloud;
create policy "collection_closures_shared_owner_access" on public.collection_closures_cloud
for all to authenticated
using (public.can_access_owner_data(user_id))
with check (public.can_access_owner_data(user_id));

-- payment_promises_cloud
drop policy if exists "payment_promises_shared_owner_access" on public.payment_promises_cloud;
create policy "payment_promises_shared_owner_access" on public.payment_promises_cloud
for all to authenticated
using (public.can_access_owner_data(user_id))
with check (public.can_access_owner_data(user_id));

-- pending_bank_items_cloud
drop policy if exists "pending_bank_items_shared_owner_access" on public.pending_bank_items_cloud;
create policy "pending_bank_items_shared_owner_access" on public.pending_bank_items_cloud
for all to authenticated
using (public.can_access_owner_data(user_id))
with check (public.can_access_owner_data(user_id));

-- pending_card_items_cloud
drop policy if exists "pending_card_items_shared_owner_access" on public.pending_card_items_cloud;
create policy "pending_card_items_shared_owner_access" on public.pending_card_items_cloud
for all to authenticated
using (public.can_access_owner_data(user_id))
with check (public.can_access_owner_data(user_id));

-- bank_rules_cloud
drop policy if exists "bank_rules_shared_owner_access" on public.bank_rules_cloud;
create policy "bank_rules_shared_owner_access" on public.bank_rules_cloud
for all to authenticated
using (public.can_access_owner_data(user_id))
with check (public.can_access_owner_data(user_id));

-- manual_assignment_audit_cloud
drop policy if exists "manual_assignment_audit_shared_owner_access" on public.manual_assignment_audit_cloud;
create policy "manual_assignment_audit_shared_owner_access" on public.manual_assignment_audit_cloud
for all to authenticated
using (public.can_access_owner_data(user_id))
with check (public.can_access_owner_data(user_id));

-- late_fee_ledger_cloud
drop policy if exists "late_fee_ledger_shared_owner_access" on public.late_fee_ledger_cloud;
create policy "late_fee_ledger_shared_owner_access" on public.late_fee_ledger_cloud
for all to authenticated
using (public.can_access_owner_data(user_id))
with check (public.can_access_owner_data(user_id));

-- notified_payments_cloud
drop policy if exists "notified_payments_shared_owner_access" on public.notified_payments_cloud;
create policy "notified_payments_shared_owner_access" on public.notified_payments_cloud
for all to authenticated
using (public.can_access_owner_data(user_id))
with check (public.can_access_owner_data(user_id));

-- cash_closings_cloud
drop policy if exists "cash_closings_shared_owner_access" on public.cash_closings_cloud;
create policy "cash_closings_shared_owner_access" on public.cash_closings_cloud
for all to authenticated
using (public.can_access_owner_data(user_id))
with check (public.can_access_owner_data(user_id));

-- cash_closing_audit_cloud
drop policy if exists "cash_closing_audit_shared_owner_access" on public.cash_closing_audit_cloud;
create policy "cash_closing_audit_shared_owner_access" on public.cash_closing_audit_cloud
for all to authenticated
using (public.can_access_owner_data(user_id))
with check (public.can_access_owner_data(user_id));

-- charge_runs_cloud
drop policy if exists "charge_runs_shared_owner_access" on public.charge_runs_cloud;
create policy "charge_runs_shared_owner_access" on public.charge_runs_cloud
for all to authenticated
using (public.can_access_owner_data(user_id))
with check (public.can_access_owner_data(user_id));

-- receipt_sequences_cloud
drop policy if exists "receipt_sequences_shared_owner_access" on public.receipt_sequences_cloud;
create policy "receipt_sequences_shared_owner_access" on public.receipt_sequences_cloud
for all to authenticated
using (public.can_access_owner_data(user_id))
with check (public.can_access_owner_data(user_id));

-- late_fee_settings_cloud
drop policy if exists "late_fee_settings_shared_owner_access" on public.late_fee_settings_cloud;
create policy "late_fee_settings_shared_owner_access" on public.late_fee_settings_cloud
for all to authenticated
using (public.can_access_owner_data(user_id))
with check (public.can_access_owner_data(user_id));

-- other_charges_retention_cloud
drop policy if exists "other_charges_retention_shared_owner_access" on public.other_charges_retention_cloud;
create policy "other_charges_retention_shared_owner_access" on public.other_charges_retention_cloud
for all to authenticated
using (public.can_access_owner_data(user_id))
with check (public.can_access_owner_data(user_id));

-- client_ui_prefs_cloud
drop policy if exists "client_ui_prefs_shared_owner_access" on public.client_ui_prefs_cloud;
create policy "client_ui_prefs_shared_owner_access" on public.client_ui_prefs_cloud
for all to authenticated
using (public.can_access_owner_data(user_id))
with check (public.can_access_owner_data(user_id));

-- 5) Ejemplo de asignacion: ambar usa dataset de admin
-- Reemplaza los correos por los reales:
-- update public.user_profiles ambar
-- set data_owner_user_id = admin.id
-- from public.user_profiles admin
-- where ambar.email = 'ambar@auth.rentautos.local'
--   and admin.email = 'admin@auth.rentautos.local';
