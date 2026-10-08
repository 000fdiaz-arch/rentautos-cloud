-- Leads: private cloud storage for documents (phase one).
-- This phase only adds storage references. Existing Base64 documents remain intact.
begin;
set local lock_timeout = '5s';

alter table public.lead_evaluations_cloud
  add column if not exists attachment_path text,
  add column if not exists attachment_mime text,
  add column if not exists attachment_size integer,
  add column if not exists attachment_sha256 text,
  add column if not exists attachment_migrated_at timestamptz;

alter table public.seller_lead_requests
  add column if not exists attachment_path text,
  add column if not exists attachment_mime text,
  add column if not exists attachment_size integer,
  add column if not exists attachment_sha256 text,
  add column if not exists attachment_migrated_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'lead_evaluations_attachment_path_owner_check'
      and conrelid = 'public.lead_evaluations_cloud'::regclass
  ) then
    alter table public.lead_evaluations_cloud
      add constraint lead_evaluations_attachment_path_owner_check
      check (attachment_path is null or attachment_path like user_id::text || '/%') not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'seller_lead_requests_attachment_path_owner_check'
      and conrelid = 'public.seller_lead_requests'::regclass
  ) then
    alter table public.seller_lead_requests
      add constraint seller_lead_requests_attachment_path_owner_check
      check (attachment_path is null or attachment_path like user_id::text || '/%') not valid;
  end if;
end;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'lead-documents',
  'lead-documents',
  false,
  5242880,
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif',
    'application/octet-stream'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "lead_documents_screen_read" on storage.objects;
create policy "lead_documents_screen_read"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'lead-documents'
  and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then (select public.can_view_owner_screen(((storage.foldername(name))[1])::uuid, 'leads'))
    else false
  end
);

drop policy if exists "lead_documents_screen_insert" on storage.objects;
create policy "lead_documents_screen_insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'lead-documents'
  and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then (select public.can_edit_owner_screen(((storage.foldername(name))[1])::uuid, 'leads'))
    else false
  end
);

drop policy if exists "lead_documents_screen_update" on storage.objects;
create policy "lead_documents_screen_update"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'lead-documents'
  and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then (select public.can_edit_owner_screen(((storage.foldername(name))[1])::uuid, 'leads'))
    else false
  end
)
with check (
  bucket_id = 'lead-documents'
  and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then (select public.can_edit_owner_screen(((storage.foldername(name))[1])::uuid, 'leads'))
    else false
  end
);

drop policy if exists "lead_documents_screen_delete" on storage.objects;
create policy "lead_documents_screen_delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'lead-documents'
  and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then (select public.can_edit_owner_screen(((storage.foldername(name))[1])::uuid, 'leads'))
    else false
  end
);

notify pgrst, 'reload schema';
commit;
