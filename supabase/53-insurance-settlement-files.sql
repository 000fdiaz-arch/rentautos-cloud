-- Rentautos: almacenamiento privado de finiquitos para reclamos a seguros.
-- Ejecutar despues de 52-insurance-workflow-core-read.sql.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'insurance-settlements',
  'insurance-settlements',
  false,
  10485760,
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif',
    'application/octet-stream',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "insurance_settlements_screen_read" on storage.objects;
create policy "insurance_settlements_screen_read"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'insurance-settlements'
  and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then (select public.can_view_owner_screen(((storage.foldername(name))[1])::uuid, 'insurance_workflow'))
    else false
  end
);

drop policy if exists "insurance_settlements_screen_insert" on storage.objects;
create policy "insurance_settlements_screen_insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'insurance-settlements'
  and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then (select public.can_edit_owner_screen(((storage.foldername(name))[1])::uuid, 'insurance_workflow'))
    else false
  end
);

drop policy if exists "insurance_settlements_screen_update" on storage.objects;
create policy "insurance_settlements_screen_update"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'insurance-settlements'
  and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then (select public.can_edit_owner_screen(((storage.foldername(name))[1])::uuid, 'insurance_workflow'))
    else false
  end
)
with check (
  bucket_id = 'insurance-settlements'
  and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then (select public.can_edit_owner_screen(((storage.foldername(name))[1])::uuid, 'insurance_workflow'))
    else false
  end
);

drop policy if exists "insurance_settlements_screen_delete" on storage.objects;
create policy "insurance_settlements_screen_delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'insurance-settlements'
  and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then (select public.can_edit_owner_screen(((storage.foldername(name))[1])::uuid, 'insurance_workflow'))
    else false
  end
);
