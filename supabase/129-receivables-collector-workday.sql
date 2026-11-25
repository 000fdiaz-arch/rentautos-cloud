-- Rentautos: acceso diario por cobrador para Cuentas por cobrar.
-- Ejecutar después de 35-receivables-screen-permissions.sql.

create table if not exists public.receivables_collector_pins_cloud (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.receivables_collector_pins_cloud enable row level security;

drop policy if exists "receivables_collector_pins_read" on public.receivables_collector_pins_cloud;
create policy "receivables_collector_pins_read"
  on public.receivables_collector_pins_cloud
  for select to authenticated
  using ((select public.can_view_owner_screen(user_id, 'receivables')));

drop policy if exists "receivables_collector_pins_insert" on public.receivables_collector_pins_cloud;
create policy "receivables_collector_pins_insert"
  on public.receivables_collector_pins_cloud
  for insert to authenticated
  with check ((select public.can_edit_owner_screen(user_id, 'settings')));

drop policy if exists "receivables_collector_pins_update" on public.receivables_collector_pins_cloud;
create policy "receivables_collector_pins_update"
  on public.receivables_collector_pins_cloud
  for update to authenticated
  using ((select public.can_edit_owner_screen(user_id, 'settings')))
  with check ((select public.can_edit_owner_screen(user_id, 'settings')));

drop policy if exists "receivables_collector_pins_delete" on public.receivables_collector_pins_cloud;
create policy "receivables_collector_pins_delete"
  on public.receivables_collector_pins_cloud
  for delete to authenticated
  using ((select public.can_edit_owner_screen(user_id, 'settings')));

grant select, insert, update, delete on public.receivables_collector_pins_cloud to authenticated;

