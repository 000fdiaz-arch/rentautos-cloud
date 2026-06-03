-- Rentautos: tabla cloud para gestion de cobranza en calle
-- Ejecuta este script en Supabase SQL Editor.

create table if not exists public.street_management_cloud (
  user_id uuid not null references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id)
);

alter table public.street_management_cloud enable row level security;

drop policy if exists "street_management_select_own_or_admin" on public.street_management_cloud;
create policy "street_management_select_own_or_admin"
on public.street_management_cloud
for select
to authenticated
using (user_id = auth.uid() or public.has_role('admin'));

drop policy if exists "street_management_insert_own_or_admin" on public.street_management_cloud;
create policy "street_management_insert_own_or_admin"
on public.street_management_cloud
for insert
to authenticated
with check (user_id = auth.uid() or public.has_role('admin'));

drop policy if exists "street_management_update_own_or_admin" on public.street_management_cloud;
create policy "street_management_update_own_or_admin"
on public.street_management_cloud
for update
to authenticated
using (user_id = auth.uid() or public.has_role('admin'))
with check (user_id = auth.uid() or public.has_role('admin'));

drop policy if exists "street_management_delete_own_or_admin" on public.street_management_cloud;
create policy "street_management_delete_own_or_admin"
on public.street_management_cloud
for delete
to authenticated
using (user_id = auth.uid() or public.has_role('admin'));
