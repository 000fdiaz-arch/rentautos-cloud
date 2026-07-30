-- Rentautos: gestion de cobranza por cliente para multiusuario en tiempo real.
-- Ejecutar despues de 36-receivables-realtime-publication.sql.

create table if not exists public.street_management_items_cloud (
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, client_id)
);

create index if not exists street_management_items_cloud_user_updated_idx
  on public.street_management_items_cloud (user_id, updated_at desc);

alter table public.street_management_items_cloud enable row level security;

drop policy if exists "street_management_items_receivables_read" on public.street_management_items_cloud;
create policy "street_management_items_receivables_read"
on public.street_management_items_cloud
for select
to authenticated
using ((select public.can_view_owner_screen(user_id, 'receivables')));

drop policy if exists "street_management_items_receivables_insert" on public.street_management_items_cloud;
create policy "street_management_items_receivables_insert"
on public.street_management_items_cloud
for insert
to authenticated
with check ((select public.can_edit_owner_screen(user_id, 'receivables')));

drop policy if exists "street_management_items_receivables_update" on public.street_management_items_cloud;
create policy "street_management_items_receivables_update"
on public.street_management_items_cloud
for update
to authenticated
using ((select public.can_edit_owner_screen(user_id, 'receivables')))
with check ((select public.can_edit_owner_screen(user_id, 'receivables')));

drop policy if exists "street_management_items_receivables_delete" on public.street_management_items_cloud;
create policy "street_management_items_receivables_delete"
on public.street_management_items_cloud
for delete
to authenticated
using ((select public.can_edit_owner_screen(user_id, 'receivables')));

grant select, insert, update, delete on public.street_management_items_cloud to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'street_management_items_cloud'
  )
  then
    alter publication supabase_realtime add table public.street_management_items_cloud;
  end if;
end $$;
