-- Rentautos: cloud sync para jornada diaria de cobranza (AM/PM/CIERRE)
-- Ejecutar despues de:
--   01-auth-roles.sql
--   02-cloud-data.sql
--   03-cloud-extended.sql
--   07-shared-data-owner-rls.sql

create table if not exists public.clients_daily_collection_cloud (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.clients_daily_collection_am_seals_cloud (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.clients_daily_collection_pm_seals_cloud (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.clients_daily_collection_close_seals_cloud (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.clients_daily_collection_promises_cloud (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.clients_daily_collection_street_actions_cloud (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists clients_daily_collection_cloud_user_idx
  on public.clients_daily_collection_cloud (user_id);
create index if not exists clients_daily_collection_am_seals_cloud_user_idx
  on public.clients_daily_collection_am_seals_cloud (user_id);
create index if not exists clients_daily_collection_pm_seals_cloud_user_idx
  on public.clients_daily_collection_pm_seals_cloud (user_id);
create index if not exists clients_daily_collection_close_seals_cloud_user_idx
  on public.clients_daily_collection_close_seals_cloud (user_id);
create index if not exists clients_daily_collection_promises_cloud_user_idx
  on public.clients_daily_collection_promises_cloud (user_id);
create index if not exists clients_daily_collection_street_actions_cloud_user_idx
  on public.clients_daily_collection_street_actions_cloud (user_id);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'clients_daily_collection_cloud'
  ) then
    alter publication supabase_realtime add table public.clients_daily_collection_cloud;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'clients_daily_collection_am_seals_cloud'
  ) then
    alter publication supabase_realtime add table public.clients_daily_collection_am_seals_cloud;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'clients_daily_collection_pm_seals_cloud'
  ) then
    alter publication supabase_realtime add table public.clients_daily_collection_pm_seals_cloud;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'clients_daily_collection_close_seals_cloud'
  ) then
    alter publication supabase_realtime add table public.clients_daily_collection_close_seals_cloud;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'clients_daily_collection_promises_cloud'
  ) then
    alter publication supabase_realtime add table public.clients_daily_collection_promises_cloud;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'clients_daily_collection_street_actions_cloud'
  ) then
    alter publication supabase_realtime add table public.clients_daily_collection_street_actions_cloud;
  end if;
end $$;

alter table public.clients_daily_collection_cloud enable row level security;
alter table public.clients_daily_collection_am_seals_cloud enable row level security;
alter table public.clients_daily_collection_pm_seals_cloud enable row level security;
alter table public.clients_daily_collection_close_seals_cloud enable row level security;
alter table public.clients_daily_collection_promises_cloud enable row level security;
alter table public.clients_daily_collection_street_actions_cloud enable row level security;

drop policy if exists "clients_daily_collection_select_own" on public.clients_daily_collection_cloud;
create policy "clients_daily_collection_select_own"
  on public.clients_daily_collection_cloud
  for select using (auth.uid() = user_id);
drop policy if exists "clients_daily_collection_insert_own" on public.clients_daily_collection_cloud;
create policy "clients_daily_collection_insert_own"
  on public.clients_daily_collection_cloud
  for insert with check (auth.uid() = user_id);
drop policy if exists "clients_daily_collection_update_own" on public.clients_daily_collection_cloud;
create policy "clients_daily_collection_update_own"
  on public.clients_daily_collection_cloud
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "clients_daily_collection_delete_own" on public.clients_daily_collection_cloud;
create policy "clients_daily_collection_delete_own"
  on public.clients_daily_collection_cloud
  for delete using (auth.uid() = user_id);

drop policy if exists "clients_daily_collection_am_seals_select_own" on public.clients_daily_collection_am_seals_cloud;
create policy "clients_daily_collection_am_seals_select_own"
  on public.clients_daily_collection_am_seals_cloud
  for select using (auth.uid() = user_id);
drop policy if exists "clients_daily_collection_am_seals_insert_own" on public.clients_daily_collection_am_seals_cloud;
create policy "clients_daily_collection_am_seals_insert_own"
  on public.clients_daily_collection_am_seals_cloud
  for insert with check (auth.uid() = user_id);
drop policy if exists "clients_daily_collection_am_seals_update_own" on public.clients_daily_collection_am_seals_cloud;
create policy "clients_daily_collection_am_seals_update_own"
  on public.clients_daily_collection_am_seals_cloud
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "clients_daily_collection_am_seals_delete_own" on public.clients_daily_collection_am_seals_cloud;
create policy "clients_daily_collection_am_seals_delete_own"
  on public.clients_daily_collection_am_seals_cloud
  for delete using (auth.uid() = user_id);

drop policy if exists "clients_daily_collection_pm_seals_select_own" on public.clients_daily_collection_pm_seals_cloud;
create policy "clients_daily_collection_pm_seals_select_own"
  on public.clients_daily_collection_pm_seals_cloud
  for select using (auth.uid() = user_id);
drop policy if exists "clients_daily_collection_pm_seals_insert_own" on public.clients_daily_collection_pm_seals_cloud;
create policy "clients_daily_collection_pm_seals_insert_own"
  on public.clients_daily_collection_pm_seals_cloud
  for insert with check (auth.uid() = user_id);
drop policy if exists "clients_daily_collection_pm_seals_update_own" on public.clients_daily_collection_pm_seals_cloud;
create policy "clients_daily_collection_pm_seals_update_own"
  on public.clients_daily_collection_pm_seals_cloud
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "clients_daily_collection_pm_seals_delete_own" on public.clients_daily_collection_pm_seals_cloud;
create policy "clients_daily_collection_pm_seals_delete_own"
  on public.clients_daily_collection_pm_seals_cloud
  for delete using (auth.uid() = user_id);

drop policy if exists "clients_daily_collection_close_seals_select_own" on public.clients_daily_collection_close_seals_cloud;
create policy "clients_daily_collection_close_seals_select_own"
  on public.clients_daily_collection_close_seals_cloud
  for select using (auth.uid() = user_id);
drop policy if exists "clients_daily_collection_close_seals_insert_own" on public.clients_daily_collection_close_seals_cloud;
create policy "clients_daily_collection_close_seals_insert_own"
  on public.clients_daily_collection_close_seals_cloud
  for insert with check (auth.uid() = user_id);
drop policy if exists "clients_daily_collection_close_seals_update_own" on public.clients_daily_collection_close_seals_cloud;
create policy "clients_daily_collection_close_seals_update_own"
  on public.clients_daily_collection_close_seals_cloud
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "clients_daily_collection_close_seals_delete_own" on public.clients_daily_collection_close_seals_cloud;
create policy "clients_daily_collection_close_seals_delete_own"
  on public.clients_daily_collection_close_seals_cloud
  for delete using (auth.uid() = user_id);

drop policy if exists "clients_daily_collection_promises_select_own" on public.clients_daily_collection_promises_cloud;
create policy "clients_daily_collection_promises_select_own"
  on public.clients_daily_collection_promises_cloud
  for select using (auth.uid() = user_id);
drop policy if exists "clients_daily_collection_promises_insert_own" on public.clients_daily_collection_promises_cloud;
create policy "clients_daily_collection_promises_insert_own"
  on public.clients_daily_collection_promises_cloud
  for insert with check (auth.uid() = user_id);
drop policy if exists "clients_daily_collection_promises_update_own" on public.clients_daily_collection_promises_cloud;
create policy "clients_daily_collection_promises_update_own"
  on public.clients_daily_collection_promises_cloud
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "clients_daily_collection_promises_delete_own" on public.clients_daily_collection_promises_cloud;
create policy "clients_daily_collection_promises_delete_own"
  on public.clients_daily_collection_promises_cloud
  for delete using (auth.uid() = user_id);

drop policy if exists "clients_daily_collection_street_actions_select_own" on public.clients_daily_collection_street_actions_cloud;
create policy "clients_daily_collection_street_actions_select_own"
  on public.clients_daily_collection_street_actions_cloud
  for select using (auth.uid() = user_id);
drop policy if exists "clients_daily_collection_street_actions_insert_own" on public.clients_daily_collection_street_actions_cloud;
create policy "clients_daily_collection_street_actions_insert_own"
  on public.clients_daily_collection_street_actions_cloud
  for insert with check (auth.uid() = user_id);
drop policy if exists "clients_daily_collection_street_actions_update_own" on public.clients_daily_collection_street_actions_cloud;
create policy "clients_daily_collection_street_actions_update_own"
  on public.clients_daily_collection_street_actions_cloud
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "clients_daily_collection_street_actions_delete_own" on public.clients_daily_collection_street_actions_cloud;
create policy "clients_daily_collection_street_actions_delete_own"
  on public.clients_daily_collection_street_actions_cloud
  for delete using (auth.uid() = user_id);

-- Dataset compartido por owner: permite que operadores con data_owner_user_id
-- vean y actualicen la misma jornada diaria del admin.
drop policy if exists "clients_daily_collection_shared_owner_access" on public.clients_daily_collection_cloud;
create policy "clients_daily_collection_shared_owner_access"
  on public.clients_daily_collection_cloud
  for all to authenticated
  using (public.can_access_owner_data(user_id))
  with check (public.can_access_owner_data(user_id));

drop policy if exists "clients_daily_collection_am_seals_shared_owner_access" on public.clients_daily_collection_am_seals_cloud;
create policy "clients_daily_collection_am_seals_shared_owner_access"
  on public.clients_daily_collection_am_seals_cloud
  for all to authenticated
  using (public.can_access_owner_data(user_id))
  with check (public.can_access_owner_data(user_id));

drop policy if exists "clients_daily_collection_pm_seals_shared_owner_access" on public.clients_daily_collection_pm_seals_cloud;
create policy "clients_daily_collection_pm_seals_shared_owner_access"
  on public.clients_daily_collection_pm_seals_cloud
  for all to authenticated
  using (public.can_access_owner_data(user_id))
  with check (public.can_access_owner_data(user_id));

drop policy if exists "clients_daily_collection_close_seals_shared_owner_access" on public.clients_daily_collection_close_seals_cloud;
create policy "clients_daily_collection_close_seals_shared_owner_access"
  on public.clients_daily_collection_close_seals_cloud
  for all to authenticated
  using (public.can_access_owner_data(user_id))
  with check (public.can_access_owner_data(user_id));

drop policy if exists "clients_daily_collection_promises_shared_owner_access" on public.clients_daily_collection_promises_cloud;
create policy "clients_daily_collection_promises_shared_owner_access"
  on public.clients_daily_collection_promises_cloud
  for all to authenticated
  using (public.can_access_owner_data(user_id))
  with check (public.can_access_owner_data(user_id));

drop policy if exists "clients_daily_collection_street_actions_shared_owner_access" on public.clients_daily_collection_street_actions_cloud;
create policy "clients_daily_collection_street_actions_shared_owner_access"
  on public.clients_daily_collection_street_actions_cloud
  for all to authenticated
  using (public.can_access_owner_data(user_id))
  with check (public.can_access_owner_data(user_id));
