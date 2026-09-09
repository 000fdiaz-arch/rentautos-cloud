-- Rentautos: expedientes de siniestro cuyo destino (juicio o seguro) todavía no está definido.
-- Ejecutar después de 79-collision-documentation-readiness.sql.

create table if not exists public.pending_incidents_cloud (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists pending_incidents_cloud_user_updated_idx
  on public.pending_incidents_cloud (user_id, updated_at desc);

alter table public.pending_incidents_cloud enable row level security;

drop policy if exists "pending_incidents_cloud_screen_read" on public.pending_incidents_cloud;
create policy "pending_incidents_cloud_screen_read" on public.pending_incidents_cloud
for select to authenticated using ((select public.can_view_owner_screen(user_id, 'collisions')));

drop policy if exists "pending_incidents_cloud_screen_insert" on public.pending_incidents_cloud;
create policy "pending_incidents_cloud_screen_insert" on public.pending_incidents_cloud
for insert to authenticated with check ((select public.can_edit_owner_screen(user_id, 'collisions')));

drop policy if exists "pending_incidents_cloud_screen_update" on public.pending_incidents_cloud;
create policy "pending_incidents_cloud_screen_update" on public.pending_incidents_cloud
for update to authenticated
using ((select public.can_edit_owner_screen(user_id, 'collisions')))
with check ((select public.can_edit_owner_screen(user_id, 'collisions')));

drop policy if exists "pending_incidents_cloud_screen_delete" on public.pending_incidents_cloud;
create policy "pending_incidents_cloud_screen_delete" on public.pending_incidents_cloud
for delete to authenticated using ((select public.can_edit_owner_screen(user_id, 'collisions')));

grant select, insert, update, delete on public.pending_incidents_cloud to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pending_incidents_cloud'
  ) then
    alter publication supabase_realtime add table public.pending_incidents_cloud;
  end if;
exception when undefined_object then null;
end $$;
