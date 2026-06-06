-- Rentautos: delta granular para cambios de cobranza diaria en Clients.
-- Guarda cada cambio pequeño como una fila independiente para evitar reescribir
-- toda la jornada en cada guardado.

create table if not exists public.clients_daily_collection_deltas_cloud (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists clients_daily_collection_deltas_cloud_user_idx
  on public.clients_daily_collection_deltas_cloud (user_id);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'clients_daily_collection_deltas_cloud'
  ) then
    alter publication supabase_realtime add table public.clients_daily_collection_deltas_cloud;
  end if;
end $$;

alter table public.clients_daily_collection_deltas_cloud enable row level security;

drop policy if exists "clients_daily_collection_deltas_select_own_or_admin" on public.clients_daily_collection_deltas_cloud;
create policy "clients_daily_collection_deltas_select_own_or_admin"
on public.clients_daily_collection_deltas_cloud
for select
to authenticated
using (user_id = auth.uid() or public.has_role('admin'));

drop policy if exists "clients_daily_collection_deltas_insert_own_or_admin" on public.clients_daily_collection_deltas_cloud;
create policy "clients_daily_collection_deltas_insert_own_or_admin"
on public.clients_daily_collection_deltas_cloud
for insert
to authenticated
with check (user_id = auth.uid() or public.has_role('admin'));

drop policy if exists "clients_daily_collection_deltas_update_own_or_admin" on public.clients_daily_collection_deltas_cloud;
create policy "clients_daily_collection_deltas_update_own_or_admin"
on public.clients_daily_collection_deltas_cloud
for update
to authenticated
using (user_id = auth.uid() or public.has_role('admin'))
with check (user_id = auth.uid() or public.has_role('admin'));

drop policy if exists "clients_daily_collection_deltas_delete_own_or_admin" on public.clients_daily_collection_deltas_cloud;
create policy "clients_daily_collection_deltas_delete_own_or_admin"
on public.clients_daily_collection_deltas_cloud
for delete
to authenticated
using (user_id = auth.uid() or public.has_role('admin'));

drop policy if exists "clients_daily_collection_deltas_shared_owner_access" on public.clients_daily_collection_deltas_cloud;
create policy "clients_daily_collection_deltas_shared_owner_access"
on public.clients_daily_collection_deltas_cloud
for all
to authenticated
using (public.can_access_owner_data(user_id))
with check (public.can_access_owner_data(user_id));
