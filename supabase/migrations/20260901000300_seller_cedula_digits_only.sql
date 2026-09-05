-- Cédulas: exclusivamente números ASCII y guiones, también en llamadas directas.
-- Ejecutar después de 66-shared-seller-lead-portal.sql.
-- No modifica identificadores existentes ni la normalización del índice histórico.
begin;

create or replace function public.lookup_seller_lead(p_portal_id uuid, p_cedula text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare owner_id uuid; cedula_key text;
begin
  select user_id into owner_id from public.seller_lead_portals where id = p_portal_id and enabled;
  if not found then raise exception 'PORTAL_UNAVAILABLE'; end if;
  perform public.check_seller_lead_portal_limit(p_portal_id, 'lookup');
  cedula_key := public.seller_lead_cedula_key(p_cedula);
  if p_cedula is null or p_cedula !~ '^[0-9-]{4,32}$' or length(cedula_key) < 4 then
    raise exception 'Cedula no valida';
  end if;
  return public.seller_lead_public_result(owner_id, cedula_key);
end;
$$;

create or replace function public.submit_shared_seller_lead(
  p_portal_id uuid, p_cedula text, p_birth_date date,
  p_attachment_name text, p_attachment_data_url text
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  owner_id uuid;
  cedula_key text;
  current_result jsonb;
  existing_id uuid;
begin
  select user_id into owner_id from public.seller_lead_portals where id = p_portal_id and enabled;
  if not found then raise exception 'PORTAL_UNAVAILABLE'; end if;
  cedula_key := public.seller_lead_cedula_key(p_cedula);
  if p_cedula is null or p_cedula !~ '^[0-9-]{4,32}$' or length(cedula_key) < 4 then
    raise exception 'Cedula no valida';
  end if;

  perform public.check_seller_lead_portal_limit(p_portal_id, 'submit');
  -- Serializa también consultas simultáneas con guiones/espacios diferentes.
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text || ':' || cedula_key, 0));
  current_result := public.seller_lead_public_result(owner_id, cedula_key);
  if current_result->>'status' in ('reviewed', 'pending_review') then
    return current_result;
  end if;

  if p_birth_date is null or p_birth_date < date '1900-01-01' or p_birth_date > current_date then
    raise exception 'Fecha de nacimiento no valida';
  end if;
  if coalesce(length(btrim(p_attachment_name)), 0) = 0 or length(p_attachment_name) > 240
     or p_attachment_data_url is null
     or p_attachment_data_url !~ '^data:(image/(png|jpeg|webp)|application/pdf);base64,[A-Za-z0-9+/]+={0,2}$'
     or octet_length(p_attachment_data_url) > 5600000 then
    raise exception 'Documento no valido (PNG, JPEG, WebP o PDF, maximo 4 MB)';
  end if;
  -- Rechaza base64 mal formado y comprueba el tamaño decodificado.
  if octet_length(decode(split_part(p_attachment_data_url, ',', 2), 'base64')) > 4194304 then
    raise exception 'Documento demasiado grande';
  end if;

  select id into existing_id from public.seller_lead_requests
  where user_id = owner_id and public.seller_lead_cedula_key(cedula) = cedula_key
    and status in ('incomplete', 'waiting_information')
  order by updated_at desc, id limit 1 for update;

  if existing_id is null then
    insert into public.seller_lead_requests
      (user_id, status, cedula, birth_date, attachment_name, attachment_data_url, submitted_at)
    values (owner_id, 'pending_review', upper(btrim(p_cedula)), p_birth_date,
      btrim(p_attachment_name), p_attachment_data_url, now());
  else
    update public.seller_lead_requests
    set status = 'pending_review', cedula = upper(btrim(p_cedula)), birth_date = p_birth_date,
      attachment_name = btrim(p_attachment_name), attachment_data_url = p_attachment_data_url,
      correction_note = null, submitted_at = now(), updated_at = now(),
      expires_at = now() + interval '30 days'
    where id = existing_id;
  end if;
  return jsonb_build_object('status', 'pending_review');
end;
$$;

create or replace function public.submit_seller_lead_request(
  p_token uuid,
  p_cedula text,
  p_birth_date date,
  p_attachment_name text,
  p_attachment_data_url text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target public.seller_lead_requests%rowtype;
begin
  select * into target
  from public.seller_lead_requests
  where token = p_token
  for update;

  if not found then raise exception 'Solicitud no encontrada'; end if;
  if target.expires_at < now() then raise exception 'La solicitud vencio'; end if;
  if target.status not in ('waiting_information', 'incomplete') then raise exception 'La solicitud ya fue enviada'; end if;
  if p_cedula is null or p_cedula !~ '^[0-9-]{4,32}$'
     or length(replace(p_cedula, '-', '')) < 4 or p_birth_date is null then
    raise exception 'Cedula y fecha de nacimiento son obligatorias';
  end if;
  if target.attachment_data_url is null and length(coalesce(p_attachment_data_url, '')) = 0 then
    raise exception 'El documento adjunto es obligatorio';
  end if;
  if length(coalesce(p_attachment_data_url, '')) > 0
     and p_attachment_data_url !~ '^data:(image/[a-zA-Z0-9.+-]+|application/pdf);base64,' then
    raise exception 'El documento adjunto no es valido';
  end if;
  if octet_length(p_attachment_data_url) > 5600000 then raise exception 'El documento supera el limite permitido'; end if;

  update public.seller_lead_requests
  set cedula = upper(trim(p_cedula)),
      birth_date = p_birth_date,
      attachment_name = case when length(coalesce(p_attachment_data_url, '')) > 0 then left(trim(p_attachment_name), 240) else target.attachment_name end,
      attachment_data_url = case when length(coalesce(p_attachment_data_url, '')) > 0 then p_attachment_data_url else target.attachment_data_url end,
      correction_note = null,
      status = 'pending_review',
      submitted_at = now(),
      updated_at = now()
  where id = target.id;
end;
$$;

commit;
