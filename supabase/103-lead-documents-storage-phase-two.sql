-- Leads: server-validated Storage writes for the public seller portal.
-- Existing Base64 RPCs remain available during the backward-compatible rollout.
begin;
set local lock_timeout = '5s';

create or replace function public.lead_document_extension(p_mime text)
returns text language sql immutable strict set search_path = public, pg_temp as $$
  select case lower(p_mime)
    when 'application/pdf' then 'pdf'
    when 'image/jpeg' then 'jpg'
    when 'image/png' then 'png'
    when 'image/webp' then 'webp'
    else null
  end
$$;

create or replace function public.lead_document_expected_path(
  p_owner_id uuid, p_mime text, p_sha256 text
)
returns text language sql immutable strict set search_path = public, pg_temp as $$
  select case
    when public.lead_document_extension(p_mime) is null
      or p_sha256 !~ '^[0-9a-f]{64}$' then null
    else p_owner_id::text || '/' || left(p_sha256, 2) || '/' || p_sha256 || '.' || public.lead_document_extension(p_mime)
  end
$$;

create or replace function public.assert_lead_document_object(
  p_owner_id uuid, p_path text, p_mime text, p_size integer, p_sha256 text
)
returns void language plpgsql security definer set search_path = public, storage, pg_temp as $$
declare expected_path text;
begin
  if lower(coalesce(p_mime, '')) not in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
     or p_size is null or p_size < 1 or p_size > 4194304
     or lower(coalesce(p_sha256, '')) !~ '^[0-9a-f]{64}$' then
    raise exception 'Documento no valido';
  end if;
  expected_path := public.lead_document_expected_path(p_owner_id, lower(p_mime), lower(p_sha256));
  if expected_path is null or p_path is distinct from expected_path then
    raise exception 'Ruta de documento no valida';
  end if;
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'lead-documents' and o.name = expected_path
      and coalesce((o.metadata->>'size')::bigint, -1) = p_size
  ) then
    raise exception 'Documento no encontrado en Storage';
  end if;
end;
$$;

create or replace function public.prepare_shared_seller_lead_upload(
  p_portal_id uuid, p_cedula text, p_birth_date date,
  p_attachment_name text, p_mime text, p_size integer, p_sha256 text
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare owner_id uuid; cedula_key text; current_result jsonb;
begin
  select user_id into owner_id from public.seller_lead_portals where id = p_portal_id and enabled;
  if not found then raise exception 'PORTAL_UNAVAILABLE'; end if;
  cedula_key := public.seller_lead_cedula_key(p_cedula);
  if p_cedula is null or p_cedula !~ '^[0-9-]{4,32}$' or length(cedula_key) < 4 then
    raise exception 'Cedula no valida';
  end if;
  perform public.check_seller_lead_portal_limit(p_portal_id, 'submit');
  current_result := public.seller_lead_public_result(owner_id, cedula_key);
  if current_result->>'status' in ('reviewed', 'pending_review') then
    return jsonb_build_object('ownerId', owner_id, 'shouldUpload', false, 'result', current_result);
  end if;
  if p_birth_date is null or p_birth_date < date '1900-01-01' or p_birth_date > current_date then
    raise exception 'Fecha de nacimiento no valida';
  end if;
  if coalesce(length(btrim(p_attachment_name)), 0) = 0 or length(p_attachment_name) > 240 then
    raise exception 'Nombre de documento no valido';
  end if;
  if public.lead_document_expected_path(owner_id, lower(p_mime), lower(p_sha256)) is null
     or p_size is null or p_size < 1 or p_size > 4194304 then
    raise exception 'Documento no valido (PNG, JPEG, WebP o PDF, maximo 4 MB)';
  end if;
  return jsonb_build_object('ownerId', owner_id, 'shouldUpload', true);
end;
$$;

create or replace function public.finalize_shared_seller_lead_upload(
  p_portal_id uuid, p_cedula text, p_birth_date date, p_attachment_name text,
  p_attachment_path text, p_mime text, p_size integer, p_sha256 text
)
returns jsonb language plpgsql security definer set search_path = public, storage, pg_temp as $$
declare owner_id uuid; cedula_key text; current_result jsonb; existing_id uuid;
begin
  select user_id into owner_id from public.seller_lead_portals where id = p_portal_id and enabled;
  if not found then raise exception 'PORTAL_UNAVAILABLE'; end if;
  cedula_key := public.seller_lead_cedula_key(p_cedula);
  if p_cedula is null or p_cedula !~ '^[0-9-]{4,32}$' or length(cedula_key) < 4
     or p_birth_date is null or p_birth_date < date '1900-01-01' or p_birth_date > current_date
     or coalesce(length(btrim(p_attachment_name)), 0) = 0 or length(p_attachment_name) > 240 then
    raise exception 'Datos no validos';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text || ':' || cedula_key, 0));
  current_result := public.seller_lead_public_result(owner_id, cedula_key);
  if current_result->>'status' in ('reviewed', 'pending_review') then return current_result; end if;
  perform public.assert_lead_document_object(owner_id, p_attachment_path, lower(p_mime), p_size, lower(p_sha256));

  select id into existing_id from public.seller_lead_requests
  where user_id = owner_id and public.seller_lead_cedula_key(cedula) = cedula_key
    and status in ('incomplete', 'waiting_information')
  order by updated_at desc, id limit 1 for update;
  if existing_id is null then
    insert into public.seller_lead_requests
      (user_id, status, cedula, birth_date, attachment_name, attachment_data_url,
       attachment_path, attachment_mime, attachment_size, attachment_sha256, attachment_migrated_at, submitted_at)
    values (owner_id, 'pending_review', upper(btrim(p_cedula)), p_birth_date, btrim(p_attachment_name), null,
      p_attachment_path, lower(p_mime), p_size, lower(p_sha256), now(), now());
  else
    update public.seller_lead_requests set
      status = 'pending_review', cedula = upper(btrim(p_cedula)), birth_date = p_birth_date,
      attachment_name = btrim(p_attachment_name), attachment_data_url = null,
      attachment_path = p_attachment_path, attachment_mime = lower(p_mime),
      attachment_size = p_size, attachment_sha256 = lower(p_sha256), attachment_migrated_at = now(),
      correction_note = null, submitted_at = now(), updated_at = now(), expires_at = now() + interval '30 days'
    where id = existing_id;
  end if;
  return jsonb_build_object('status', 'pending_review');
end;
$$;

create or replace function public.prepare_token_seller_lead_upload(
  p_token uuid, p_cedula text, p_birth_date date,
  p_attachment_name text, p_mime text default null, p_size integer default null, p_sha256 text default null
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare target public.seller_lead_requests%rowtype; has_upload boolean;
begin
  select * into target from public.seller_lead_requests where token = p_token;
  if not found then raise exception 'Solicitud no encontrada'; end if;
  if target.expires_at < now() then raise exception 'La solicitud vencio'; end if;
  if target.status not in ('waiting_information', 'incomplete') then raise exception 'La solicitud ya fue enviada'; end if;
  if p_cedula is null or p_cedula !~ '^[0-9-]{4,32}$' or length(replace(p_cedula, '-', '')) < 4
     or p_birth_date is null or p_birth_date < date '1900-01-01' or p_birth_date > current_date then
    raise exception 'Cedula y fecha de nacimiento son obligatorias';
  end if;
  has_upload := p_mime is not null or p_size is not null or p_sha256 is not null;
  if not has_upload and target.attachment_path is null and target.attachment_data_url is null then
    raise exception 'El documento adjunto es obligatorio';
  end if;
  if has_upload and (coalesce(length(btrim(p_attachment_name)), 0) = 0 or length(p_attachment_name) > 240
      or public.lead_document_expected_path(target.user_id, lower(p_mime), lower(p_sha256)) is null
      or p_size is null or p_size < 1 or p_size > 4194304) then
    raise exception 'Documento no valido';
  end if;
  return jsonb_build_object('ownerId', target.user_id, 'shouldUpload', has_upload);
end;
$$;

create or replace function public.finalize_token_seller_lead_upload(
  p_token uuid, p_cedula text, p_birth_date date, p_attachment_name text,
  p_attachment_path text default null, p_mime text default null,
  p_size integer default null, p_sha256 text default null
)
returns void language plpgsql security definer set search_path = public, storage, pg_temp as $$
declare target public.seller_lead_requests%rowtype; has_upload boolean;
begin
  select * into target from public.seller_lead_requests where token = p_token for update;
  if not found then raise exception 'Solicitud no encontrada'; end if;
  if target.expires_at < now() then raise exception 'La solicitud vencio'; end if;
  if target.status not in ('waiting_information', 'incomplete') then raise exception 'La solicitud ya fue enviada'; end if;
  if p_cedula is null or p_cedula !~ '^[0-9-]{4,32}$' or length(replace(p_cedula, '-', '')) < 4
     or p_birth_date is null or p_birth_date < date '1900-01-01' or p_birth_date > current_date then
    raise exception 'Cedula y fecha de nacimiento son obligatorias';
  end if;
  has_upload := p_attachment_path is not null;
  if has_upload then
    perform public.assert_lead_document_object(target.user_id, p_attachment_path, lower(p_mime), p_size, lower(p_sha256));
  elsif target.attachment_path is null and target.attachment_data_url is null then
    raise exception 'El documento adjunto es obligatorio';
  end if;
  update public.seller_lead_requests set
    cedula = upper(trim(p_cedula)), birth_date = p_birth_date,
    attachment_name = case when has_upload then left(trim(p_attachment_name), 240) else target.attachment_name end,
    attachment_data_url = case when has_upload then null else target.attachment_data_url end,
    attachment_path = case when has_upload then p_attachment_path else target.attachment_path end,
    attachment_mime = case when has_upload then lower(p_mime) else target.attachment_mime end,
    attachment_size = case when has_upload then p_size else target.attachment_size end,
    attachment_sha256 = case when has_upload then lower(p_sha256) else target.attachment_sha256 end,
    attachment_migrated_at = case when has_upload then now() else target.attachment_migrated_at end,
    correction_note = null, status = 'pending_review', submitted_at = now(), updated_at = now()
  where id = target.id;
end;
$$;

revoke all on function public.lead_document_extension(text) from public, anon, authenticated;
revoke all on function public.lead_document_expected_path(uuid,text,text) from public, anon, authenticated;
revoke all on function public.assert_lead_document_object(uuid,text,text,integer,text) from public, anon, authenticated;
revoke all on function public.prepare_shared_seller_lead_upload(uuid,text,date,text,text,integer,text) from public, anon, authenticated;
revoke all on function public.finalize_shared_seller_lead_upload(uuid,text,date,text,text,text,integer,text) from public, anon, authenticated;
revoke all on function public.prepare_token_seller_lead_upload(uuid,text,date,text,text,integer,text) from public, anon, authenticated;
revoke all on function public.finalize_token_seller_lead_upload(uuid,text,date,text,text,text,integer,text) from public, anon, authenticated;
grant execute on function public.prepare_shared_seller_lead_upload(uuid,text,date,text,text,integer,text) to service_role;
grant execute on function public.finalize_shared_seller_lead_upload(uuid,text,date,text,text,text,integer,text) to service_role;
grant execute on function public.prepare_token_seller_lead_upload(uuid,text,date,text,text,integer,text) to service_role;
grant execute on function public.finalize_token_seller_lead_upload(uuid,text,date,text,text,text,integer,text) to service_role;

notify pgrst, 'reload schema';
commit;
