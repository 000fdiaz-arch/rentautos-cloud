-- Rentautos: tablas cloud para clientes y pagos
-- Ejecuta este script en Supabase SQL Editor.

create table if not exists public.clients_cloud (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.payments_cloud (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

alter table public.clients_cloud enable row level security;
alter table public.payments_cloud enable row level security;

drop policy if exists "clients_select_own_or_admin" on public.clients_cloud;
create policy "clients_select_own_or_admin"
on public.clients_cloud
for select
to authenticated
using (user_id = auth.uid() or public.has_role('admin'));

drop policy if exists "clients_insert_own_or_admin" on public.clients_cloud;
create policy "clients_insert_own_or_admin"
on public.clients_cloud
for insert
to authenticated
with check (user_id = auth.uid() or public.has_role('admin'));

drop policy if exists "clients_update_own_or_admin" on public.clients_cloud;
create policy "clients_update_own_or_admin"
on public.clients_cloud
for update
to authenticated
using (user_id = auth.uid() or public.has_role('admin'))
with check (user_id = auth.uid() or public.has_role('admin'));

drop policy if exists "clients_delete_own_or_admin" on public.clients_cloud;
create policy "clients_delete_own_or_admin"
on public.clients_cloud
for delete
to authenticated
using (user_id = auth.uid() or public.has_role('admin'));

drop policy if exists "payments_select_own_or_admin" on public.payments_cloud;
create policy "payments_select_own_or_admin"
on public.payments_cloud
for select
to authenticated
using (user_id = auth.uid() or public.has_role('admin'));

drop policy if exists "payments_insert_own_or_admin" on public.payments_cloud;
create policy "payments_insert_own_or_admin"
on public.payments_cloud
for insert
to authenticated
with check (user_id = auth.uid() or public.has_role('admin'));

drop policy if exists "payments_update_own_or_admin" on public.payments_cloud;
create policy "payments_update_own_or_admin"
on public.payments_cloud
for update
to authenticated
using (user_id = auth.uid() or public.has_role('admin'))
with check (user_id = auth.uid() or public.has_role('admin'));

drop policy if exists "payments_delete_own_or_admin" on public.payments_cloud;
create policy "payments_delete_own_or_admin"
on public.payments_cloud
for delete
to authenticated
using (user_id = auth.uid() or public.has_role('admin'));
