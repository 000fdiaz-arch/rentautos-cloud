-- Rentautos: Vista Buscador para Cobro en Ruta publicado.
-- Ejecutar despues de 45-street-management-items-cloud.sql.

do $$
begin
  alter type public.app_role add value if not exists 'buscador';
exception
  when duplicate_object then null;
end $$;

create table if not exists public.active_route_items_cloud (
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, client_id)
);

create index if not exists active_route_items_cloud_user_updated_idx
  on public.active_route_items_cloud (user_id, updated_at desc);

alter table public.active_route_items_cloud enable row level security;

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
        "control_units": {"view": true, "edit": false},
        "settings": {"view": false, "edit": false},
        "users": {"view": false, "edit": false}
      }'::jsonb
  end;
$$;

drop policy if exists "active_route_items_route_search_read" on public.active_route_items_cloud;
create policy "active_route_items_route_search_read"
on public.active_route_items_cloud
for select
to authenticated
using (
  (select public.can_view_owner_screen(user_id, 'route_search'))
  or (select public.can_view_owner_screen(user_id, 'receivables'))
);

drop policy if exists "active_route_items_receivables_insert" on public.active_route_items_cloud;
create policy "active_route_items_receivables_insert"
on public.active_route_items_cloud
for insert
to authenticated
with check ((select public.can_edit_owner_screen(user_id, 'receivables')));

drop policy if exists "active_route_items_receivables_update" on public.active_route_items_cloud;
create policy "active_route_items_receivables_update"
on public.active_route_items_cloud
for update
to authenticated
using ((select public.can_edit_owner_screen(user_id, 'receivables')))
with check ((select public.can_edit_owner_screen(user_id, 'receivables')));

drop policy if exists "active_route_items_receivables_delete" on public.active_route_items_cloud;
create policy "active_route_items_receivables_delete"
on public.active_route_items_cloud
for delete
to authenticated
using ((select public.can_edit_owner_screen(user_id, 'receivables')));

grant select, insert, update, delete on public.active_route_items_cloud to authenticated;
grant execute on function public.default_screen_permissions(public.app_role) to authenticated;

do $$
declare
  policy_record record;
begin
  if to_regclass('public.clients_cloud') is not null then
    for policy_record in
      select policyname from pg_policies where schemaname = 'public' and tablename = 'clients_cloud'
    loop
      execute format('drop policy if exists %I on public.clients_cloud', policy_record.policyname);
    end loop;

    create policy "clients_cloud_operational_read"
    on public.clients_cloud
    for select
    to authenticated
    using (
      (select public.can_view_owner_screen(user_id, 'clients'))
      or (select public.can_view_owner_screen(user_id, 'payments'))
      or (select public.can_view_owner_screen(user_id, 'receivables'))
      or (select public.can_view_owner_screen(user_id, 'route_search'))
    );

    create policy "clients_cloud_clients_insert"
    on public.clients_cloud
    for insert
    to authenticated
    with check (
      (select public.can_edit_owner_screen(user_id, 'clients'))
      or (select public.can_edit_owner_screen(user_id, 'payments'))
    );

    create policy "clients_cloud_clients_update"
    on public.clients_cloud
    for update
    to authenticated
    using (
      (select public.can_edit_owner_screen(user_id, 'clients'))
      or (select public.can_edit_owner_screen(user_id, 'payments'))
    )
    with check (
      (select public.can_edit_owner_screen(user_id, 'clients'))
      or (select public.can_edit_owner_screen(user_id, 'payments'))
    );

    create policy "clients_cloud_clients_delete"
    on public.clients_cloud
    for delete
    to authenticated
    using ((select public.can_edit_owner_screen(user_id, 'clients')));
  end if;

  if to_regclass('public.payments_cloud') is not null then
    for policy_record in
      select policyname from pg_policies where schemaname = 'public' and tablename = 'payments_cloud'
    loop
      execute format('drop policy if exists %I on public.payments_cloud', policy_record.policyname);
    end loop;

    create policy "payments_cloud_operational_read"
    on public.payments_cloud
    for select
    to authenticated
    using (
      (select public.can_view_owner_screen(user_id, 'payments'))
      or (select public.can_view_owner_screen(user_id, 'receivables'))
      or (select public.can_view_owner_screen(user_id, 'route_search'))
    );

    create policy "payments_cloud_payments_insert"
    on public.payments_cloud
    for insert
    to authenticated
    with check ((select public.can_edit_owner_screen(user_id, 'payments')));

    create policy "payments_cloud_payments_update"
    on public.payments_cloud
    for update
    to authenticated
    using ((select public.can_edit_owner_screen(user_id, 'payments')))
    with check ((select public.can_edit_owner_screen(user_id, 'payments')));

    create policy "payments_cloud_payments_delete"
    on public.payments_cloud
    for delete
    to authenticated
    using ((select public.can_edit_owner_screen(user_id, 'payments')));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'active_route_items_cloud'
  )
  then
    alter publication supabase_realtime add table public.active_route_items_cloud;
  end if;
end $$;
