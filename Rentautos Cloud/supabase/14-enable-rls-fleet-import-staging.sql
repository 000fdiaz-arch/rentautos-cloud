-- Enable RLS for fleet import staging table and enforce owner-based access.
-- Date: 2026-05-27

alter table if exists public.fleet_import_staging
  enable row level security;

drop policy if exists "fleet_import_staging_owner_access"
  on public.fleet_import_staging;

create policy "fleet_import_staging_owner_access"
on public.fleet_import_staging
as permissive
for all
to authenticated
using (public.can_access_owner_data(user_id))
with check (public.can_access_owner_data(user_id));

