-- Rentautos: evaluaciones de Leads en nube
-- Ejecutar despues de:
--   1) supabase/01-auth-roles.sql
--   2) supabase/07-shared-data-owner-rls.sql

create table if not exists public.lead_evaluations_cloud (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists lead_evaluations_cloud_user_idx
  on public.lead_evaluations_cloud (user_id);

alter table public.lead_evaluations_cloud enable row level security;

drop policy if exists "lead_evaluations_shared_owner_access" on public.lead_evaluations_cloud;
create policy "lead_evaluations_shared_owner_access" on public.lead_evaluations_cloud
for all to authenticated
using (public.can_access_owner_data(user_id))
with check (public.can_access_owner_data(user_id));
