-- Rentautos: Reclamos a seguros cloud-only y permisos por pantalla.
-- Ejecutar despues de 47-route-search-active-route.sql.

create table if not exists public.insurance_insurers_cloud (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.insurance_claims_cloud (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists insurance_insurers_cloud_user_updated_idx
  on public.insurance_insurers_cloud (user_id, updated_at desc);

create index if not exists insurance_claims_cloud_user_updated_idx
  on public.insurance_claims_cloud (user_id, updated_at desc);

alter table public.insurance_insurers_cloud enable row level security;
alter table public.insurance_claims_cloud enable row level security;

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
        "control_units": {"view": true, "edit": false},
        "settings": {"view": false, "edit": false},
        "users": {"view": false, "edit": false}
      }'::jsonb
  end;
$$;

drop policy if exists "insurance_insurers_cloud_screen_read" on public.insurance_insurers_cloud;
create policy "insurance_insurers_cloud_screen_read"
on public.insurance_insurers_cloud
for select
to authenticated
using ((select public.can_view_owner_screen(user_id, 'insurance_workflow')));

drop policy if exists "insurance_insurers_cloud_screen_insert" on public.insurance_insurers_cloud;
create policy "insurance_insurers_cloud_screen_insert"
on public.insurance_insurers_cloud
for insert
to authenticated
with check ((select public.can_edit_owner_screen(user_id, 'insurance_workflow')));

drop policy if exists "insurance_insurers_cloud_screen_update" on public.insurance_insurers_cloud;
create policy "insurance_insurers_cloud_screen_update"
on public.insurance_insurers_cloud
for update
to authenticated
using ((select public.can_edit_owner_screen(user_id, 'insurance_workflow')))
with check ((select public.can_edit_owner_screen(user_id, 'insurance_workflow')));

drop policy if exists "insurance_insurers_cloud_screen_delete" on public.insurance_insurers_cloud;
create policy "insurance_insurers_cloud_screen_delete"
on public.insurance_insurers_cloud
for delete
to authenticated
using ((select public.can_edit_owner_screen(user_id, 'insurance_workflow')));

drop policy if exists "insurance_claims_cloud_screen_read" on public.insurance_claims_cloud;
create policy "insurance_claims_cloud_screen_read"
on public.insurance_claims_cloud
for select
to authenticated
using ((select public.can_view_owner_screen(user_id, 'insurance_workflow')));

drop policy if exists "insurance_claims_cloud_screen_insert" on public.insurance_claims_cloud;
create policy "insurance_claims_cloud_screen_insert"
on public.insurance_claims_cloud
for insert
to authenticated
with check ((select public.can_edit_owner_screen(user_id, 'insurance_workflow')));

drop policy if exists "insurance_claims_cloud_screen_update" on public.insurance_claims_cloud;
create policy "insurance_claims_cloud_screen_update"
on public.insurance_claims_cloud
for update
to authenticated
using ((select public.can_edit_owner_screen(user_id, 'insurance_workflow')))
with check ((select public.can_edit_owner_screen(user_id, 'insurance_workflow')));

drop policy if exists "insurance_claims_cloud_screen_delete" on public.insurance_claims_cloud;
create policy "insurance_claims_cloud_screen_delete"
on public.insurance_claims_cloud
for delete
to authenticated
using ((select public.can_edit_owner_screen(user_id, 'insurance_workflow')));

grant select, insert, update, delete on public.insurance_insurers_cloud to authenticated;
grant select, insert, update, delete on public.insurance_claims_cloud to authenticated;
grant execute on function public.default_screen_permissions(public.app_role) to authenticated;

do $$
begin
  if exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'insurance_insurers_cloud'
  ) then
    null;
  else
    alter publication supabase_realtime add table public.insurance_insurers_cloud;
  end if;

  if exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'insurance_claims_cloud'
  ) then
    null;
  else
    alter publication supabase_realtime add table public.insurance_claims_cloud;
  end if;
exception
  when undefined_object then null;
end $$;
