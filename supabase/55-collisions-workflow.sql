-- Rentautos: pantalla independiente de Colisiones y Choques.
-- Ejecutar despues de 54-cash-closing-client-sync-timeout.sql.

create table if not exists public.collision_cases_cloud (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists collision_cases_cloud_user_updated_idx
  on public.collision_cases_cloud (user_id, updated_at desc);

alter table public.collision_cases_cloud enable row level security;

create or replace function public.default_screen_permissions(p_role public.app_role)
returns jsonb
language sql
stable
as $$
  select case p_role::text
    when 'admin' then
      '{
        "leads": {"view": true, "edit": true},
        "clients": {"view": true, "edit": true},
        "payments": {"view": true, "edit": true},
        "receivables": {"view": true, "edit": true},
        "route_search": {"view": true, "edit": true},
        "insurance_workflow": {"view": true, "edit": true},
        "collisions": {"view": true, "edit": true},
        "control_units": {"view": true, "edit": true},
        "settings": {"view": true, "edit": true},
        "users": {"view": true, "edit": true}
      }'::jsonb
    when 'operador' then
      '{
        "leads": {"view": true, "edit": true},
        "clients": {"view": true, "edit": true},
        "payments": {"view": true, "edit": true},
        "receivables": {"view": true, "edit": true},
        "route_search": {"view": false, "edit": false},
        "insurance_workflow": {"view": true, "edit": true},
        "collisions": {"view": true, "edit": true},
        "control_units": {"view": true, "edit": true},
        "settings": {"view": false, "edit": false},
        "users": {"view": false, "edit": false}
      }'::jsonb
    when 'buscador' then
      '{
        "leads": {"view": false, "edit": false},
        "clients": {"view": false, "edit": false},
        "payments": {"view": false, "edit": false},
        "receivables": {"view": false, "edit": false},
        "route_search": {"view": true, "edit": false},
        "insurance_workflow": {"view": false, "edit": false},
        "collisions": {"view": false, "edit": false},
        "control_units": {"view": false, "edit": false},
        "settings": {"view": false, "edit": false},
        "users": {"view": false, "edit": false}
      }'::jsonb
    else
      '{
        "leads": {"view": false, "edit": false},
        "clients": {"view": false, "edit": false},
        "payments": {"view": false, "edit": false},
        "receivables": {"view": false, "edit": false},
        "route_search": {"view": false, "edit": false},
        "insurance_workflow": {"view": false, "edit": false},
        "collisions": {"view": false, "edit": false},
        "control_units": {"view": true, "edit": false},
        "settings": {"view": false, "edit": false},
        "users": {"view": false, "edit": false}
      }'::jsonb
  end;
$$;

drop policy if exists "collision_cases_cloud_screen_read" on public.collision_cases_cloud;
create policy "collision_cases_cloud_screen_read" on public.collision_cases_cloud
for select to authenticated using ((select public.can_view_owner_screen(user_id, 'collisions')));

drop policy if exists "collision_cases_cloud_screen_insert" on public.collision_cases_cloud;
create policy "collision_cases_cloud_screen_insert" on public.collision_cases_cloud
for insert to authenticated with check ((select public.can_edit_owner_screen(user_id, 'collisions')));

drop policy if exists "collision_cases_cloud_screen_update" on public.collision_cases_cloud;
create policy "collision_cases_cloud_screen_update" on public.collision_cases_cloud
for update to authenticated
using ((select public.can_edit_owner_screen(user_id, 'collisions')))
with check ((select public.can_edit_owner_screen(user_id, 'collisions')));

drop policy if exists "collision_cases_cloud_screen_delete" on public.collision_cases_cloud;
create policy "collision_cases_cloud_screen_delete" on public.collision_cases_cloud
for delete to authenticated using ((select public.can_edit_owner_screen(user_id, 'collisions')));

grant select, insert, update, delete on public.collision_cases_cloud to authenticated;
grant execute on function public.default_screen_permissions(public.app_role) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('collision-photos', 'collision-photos', false, 10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/octet-stream'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "collision_photos_screen_read" on storage.objects;
create policy "collision_photos_screen_read" on storage.objects
for select to authenticated using (
  bucket_id = 'collision-photos'
  and case when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then (select public.can_view_owner_screen(((storage.foldername(name))[1])::uuid, 'collisions')) else false end
);

drop policy if exists "collision_photos_screen_insert" on storage.objects;
create policy "collision_photos_screen_insert" on storage.objects
for insert to authenticated with check (
  bucket_id = 'collision-photos'
  and case when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then (select public.can_edit_owner_screen(((storage.foldername(name))[1])::uuid, 'collisions')) else false end
);

drop policy if exists "collision_photos_screen_update" on storage.objects;
create policy "collision_photos_screen_update" on storage.objects
for update to authenticated
using (
  bucket_id = 'collision-photos'
  and case when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then (select public.can_edit_owner_screen(((storage.foldername(name))[1])::uuid, 'collisions')) else false end
)
with check (
  bucket_id = 'collision-photos'
  and case when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then (select public.can_edit_owner_screen(((storage.foldername(name))[1])::uuid, 'collisions')) else false end
);

drop policy if exists "collision_photos_screen_delete" on storage.objects;
create policy "collision_photos_screen_delete" on storage.objects
for delete to authenticated using (
  bucket_id = 'collision-photos'
  and case when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then (select public.can_edit_owner_screen(((storage.foldername(name))[1])::uuid, 'collisions')) else false end
);

do $$
begin
  if to_regclass('public.clients_cloud') is not null then
    drop policy if exists "clients_cloud_operational_read" on public.clients_cloud;
    create policy "clients_cloud_operational_read" on public.clients_cloud for select to authenticated using (
      (select public.can_view_owner_screen(user_id, 'clients'))
      or (select public.can_view_owner_screen(user_id, 'payments'))
      or (select public.can_view_owner_screen(user_id, 'receivables'))
      or (select public.can_view_owner_screen(user_id, 'route_search'))
      or (select public.can_view_owner_screen(user_id, 'insurance_workflow'))
      or (select public.can_view_owner_screen(user_id, 'collisions'))
    );

    drop policy if exists "clients_cloud_collisions_update" on public.clients_cloud;
    create policy "clients_cloud_collisions_update" on public.clients_cloud
    for update to authenticated
    using ((select public.can_edit_owner_screen(user_id, 'collisions')))
    with check ((select public.can_edit_owner_screen(user_id, 'collisions')));
  end if;
  if to_regclass('public.fleet_units_cloud') is not null then
    drop policy if exists "fleet_units_operational_read" on public.fleet_units_cloud;
    create policy "fleet_units_operational_read" on public.fleet_units_cloud for select to authenticated using (
      (select public.can_view_owner_screen(user_id, 'control_units'))
      or (select public.can_view_owner_screen(user_id, 'receivables'))
      or (select public.can_view_owner_screen(user_id, 'insurance_workflow'))
      or (select public.can_view_owner_screen(user_id, 'collisions'))
    );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'collision_cases_cloud'
  ) then alter publication supabase_realtime add table public.collision_cases_cloud; end if;
exception when undefined_object then null;
end $$;
