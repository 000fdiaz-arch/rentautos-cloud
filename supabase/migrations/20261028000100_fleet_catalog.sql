-- Catalogo de autos: portada y tarifas visibles para unidades libres.
begin;
set local lock_timeout = '5s';

alter table public.fleet_units_cloud
  add column if not exists catalog_daily_rate numeric(12,2),
  add column if not exists catalog_weekly_rate numeric(12,2),
  add column if not exists catalog_biweekly_rate numeric(12,2),
  add column if not exists catalog_photo_path text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'fleet_units_catalog_rates_nonnegative'
      and conrelid = 'public.fleet_units_cloud'::regclass
  ) then
    alter table public.fleet_units_cloud
      add constraint fleet_units_catalog_rates_nonnegative
      check (
        (catalog_daily_rate is null or catalog_daily_rate >= 0)
        and (catalog_weekly_rate is null or catalog_weekly_rate >= 0)
        and (catalog_biweekly_rate is null or catalog_biweekly_rate >= 0)
      ) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'fleet_units_catalog_photo_owner_path'
      and conrelid = 'public.fleet_units_cloud'::regclass
  ) then
    alter table public.fleet_units_cloud
      add constraint fleet_units_catalog_photo_owner_path
      check (catalog_photo_path is null or catalog_photo_path like user_id::text || '/%') not valid;
  end if;
end;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'fleet-catalog-photos',
  'fleet-catalog-photos',
  false,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "fleet_catalog_photos_read" on storage.objects;
create policy "fleet_catalog_photos_read"
on storage.objects for select to authenticated
using (
  bucket_id = 'fleet-catalog-photos'
  and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then (select public.can_view_owner_screen(((storage.foldername(name))[1])::uuid, 'control_units'))
    else false
  end
);

drop policy if exists "fleet_catalog_photos_insert" on storage.objects;
create policy "fleet_catalog_photos_insert"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'fleet-catalog-photos'
  and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then (select public.can_edit_owner_screen(((storage.foldername(name))[1])::uuid, 'control_units'))
    else false
  end
);

drop policy if exists "fleet_catalog_photos_delete" on storage.objects;
create policy "fleet_catalog_photos_delete"
on storage.objects for delete to authenticated
using (
  bucket_id = 'fleet-catalog-photos'
  and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then (select public.can_edit_owner_screen(((storage.foldername(name))[1])::uuid, 'control_units'))
    else false
  end
);

create or replace function public.save_fleet_catalog_settings(
  p_owner_user_id uuid,
  p_fleet_id uuid,
  p_daily_rate numeric,
  p_weekly_rate numeric,
  p_biweekly_rate numeric,
  p_photo_path text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not coalesce(public.can_edit_owner_screen(p_owner_user_id, 'control_units'), false) then
    raise exception 'No autorizado para editar el catalogo de autos';
  end if;
  if coalesce(p_daily_rate, 0) < 0 or coalesce(p_weekly_rate, 0) < 0 or coalesce(p_biweekly_rate, 0) < 0 then
    raise exception 'Las tarifas del catalogo no pueden ser negativas';
  end if;
  if p_photo_path is not null and p_photo_path not like p_owner_user_id::text || '/%' then
    raise exception 'La foto no pertenece al owner indicado';
  end if;

  update public.fleet_units_cloud
  set catalog_daily_rate = p_daily_rate,
      catalog_weekly_rate = p_weekly_rate,
      catalog_biweekly_rate = p_biweekly_rate,
      catalog_photo_path = p_photo_path,
      updated_at = now()
  where user_id = p_owner_user_id
    and fleet_id = p_fleet_id
    and retired_at is null;

  if not found then
    raise exception 'No se encontro el auto activo solicitado';
  end if;
end;
$$;

revoke all on function public.save_fleet_catalog_settings(uuid, uuid, numeric, numeric, numeric, text) from public;
grant execute on function public.save_fleet_catalog_settings(uuid, uuid, numeric, numeric, numeric, text) to authenticated;

notify pgrst, 'reload schema';
commit;
