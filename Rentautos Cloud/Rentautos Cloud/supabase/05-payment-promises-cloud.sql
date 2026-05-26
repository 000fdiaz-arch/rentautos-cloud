-- Rentautos: promesas de pago en nube
-- Ejecutar despues de:
--   1) supabase/01-auth-roles.sql
--   2) supabase/02-cloud-data.sql

create table if not exists public.payment_promises_cloud (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists payment_promises_cloud_user_idx on public.payment_promises_cloud (user_id);

alter table public.payment_promises_cloud enable row level security;

drop policy if exists "payment_promises_select_own_or_admin" on public.payment_promises_cloud;
create policy "payment_promises_select_own_or_admin" on public.payment_promises_cloud
for select to authenticated using (user_id = auth.uid() or public.has_role('admin'));

drop policy if exists "payment_promises_insert_own_or_admin" on public.payment_promises_cloud;
create policy "payment_promises_insert_own_or_admin" on public.payment_promises_cloud
for insert to authenticated with check (user_id = auth.uid() or public.has_role('admin'));

drop policy if exists "payment_promises_update_own_or_admin" on public.payment_promises_cloud;
create policy "payment_promises_update_own_or_admin" on public.payment_promises_cloud
for update to authenticated using (user_id = auth.uid() or public.has_role('admin'))
with check (user_id = auth.uid() or public.has_role('admin'));

drop policy if exists "payment_promises_delete_own_or_admin" on public.payment_promises_cloud;
create policy "payment_promises_delete_own_or_admin" on public.payment_promises_cloud
for delete to authenticated using (user_id = auth.uid() or public.has_role('admin'));

