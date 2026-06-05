create table if not exists public.collisions_cloud (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.collisions_settings_cloud (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.collisions_cloud enable row level security;
alter table public.collisions_settings_cloud enable row level security;

drop policy if exists collisions_cloud_select on public.collisions_cloud;
drop policy if exists collisions_cloud_upsert on public.collisions_cloud;
drop policy if exists collisions_cloud_delete on public.collisions_cloud;
drop policy if exists collisions_settings_cloud_select on public.collisions_settings_cloud;
drop policy if exists collisions_settings_cloud_upsert on public.collisions_settings_cloud;
drop policy if exists collisions_settings_cloud_delete on public.collisions_settings_cloud;

create policy collisions_cloud_select
on public.collisions_cloud
for select
using (auth.uid() = user_id);

create policy collisions_cloud_upsert
on public.collisions_cloud
for insert
with check (auth.uid() = user_id);

create policy collisions_cloud_update
on public.collisions_cloud
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy collisions_cloud_delete
on public.collisions_cloud
for delete
using (auth.uid() = user_id);

create policy collisions_settings_cloud_select
on public.collisions_settings_cloud
for select
using (auth.uid() = user_id);

create policy collisions_settings_cloud_upsert
on public.collisions_settings_cloud
for insert
with check (auth.uid() = user_id);

create policy collisions_settings_cloud_update
on public.collisions_settings_cloud
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy collisions_settings_cloud_delete
on public.collisions_settings_cloud
for delete
using (auth.uid() = user_id);
