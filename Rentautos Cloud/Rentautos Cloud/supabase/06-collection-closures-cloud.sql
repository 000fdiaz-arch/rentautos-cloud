create table if not exists public.collection_closures_cloud (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.collection_closures_cloud enable row level security;

drop policy if exists "collection_closures_cloud_select_own" on public.collection_closures_cloud;
create policy "collection_closures_cloud_select_own"
  on public.collection_closures_cloud
  for select
  using (auth.uid() = user_id);

drop policy if exists "collection_closures_cloud_insert_own" on public.collection_closures_cloud;
create policy "collection_closures_cloud_insert_own"
  on public.collection_closures_cloud
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "collection_closures_cloud_update_own" on public.collection_closures_cloud;
create policy "collection_closures_cloud_update_own"
  on public.collection_closures_cloud
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
