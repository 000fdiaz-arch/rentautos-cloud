-- Enlace público único por dataset. Ejecutar después de 59-seller-lead-requests.sql.
-- Las consultas públicas nunca devuelven tokens privados, documentos ni antecedentes.
begin;

create or replace function public.seller_lead_cedula_key(p_value text)
returns text language sql immutable strict set search_path = public, pg_temp
as $$ select regexp_replace(upper(p_value), '[^A-Z0-9]', '', 'g') $$;

create table if not exists public.seller_lead_portals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.seller_lead_portals enable row level security;
revoke all on public.seller_lead_portals from anon, authenticated;
grant select on public.seller_lead_portals to authenticated;
drop policy if exists seller_lead_portals_read on public.seller_lead_portals;
create policy seller_lead_portals_read on public.seller_lead_portals
for select to authenticated using (public.can_view_owner_screen(user_id, 'leads'));

-- Corrige el alcance de permisos de la tabla de solicitudes existente.
drop policy if exists seller_lead_requests_owner_access on public.seller_lead_requests;
drop policy if exists seller_lead_requests_read on public.seller_lead_requests;
create policy seller_lead_requests_read on public.seller_lead_requests
for select to authenticated using (public.can_view_owner_screen(user_id, 'leads'));
drop policy if exists seller_lead_requests_insert on public.seller_lead_requests;
create policy seller_lead_requests_insert on public.seller_lead_requests
for insert to authenticated with check (public.can_edit_owner_screen(user_id, 'leads'));
drop policy if exists seller_lead_requests_update on public.seller_lead_requests;
create policy seller_lead_requests_update on public.seller_lead_requests
for update to authenticated using (public.can_edit_owner_screen(user_id, 'leads'))
with check (public.can_edit_owner_screen(user_id, 'leads'));
drop policy if exists seller_lead_requests_delete on public.seller_lead_requests;
create policy seller_lead_requests_delete on public.seller_lead_requests
for delete to authenticated using (public.can_edit_owner_screen(user_id, 'leads'));

create index if not exists seller_lead_cedula_lookup_idx
on public.lead_evaluations_cloud (user_id, public.seller_lead_cedula_key(data->>'cedula'));
create index if not exists seller_request_cedula_lookup_idx
on public.seller_lead_requests (user_id, public.seller_lead_cedula_key(cedula));

-- Contadores de tamaño fijo: no se almacenan IPs ni cédulas en los límites.
-- Cuotas compartidas por portal, no dependientes de cabeceras manipulables.
create table if not exists public.seller_lead_portal_limits (
  portal_id uuid not null references public.seller_lead_portals(id) on delete cascade,
  operation text not null,
  minute_start timestamptz not null,
  minute_count integer not null,
  day_start timestamptz not null,
  day_count integer not null,
  primary key (portal_id, operation)
);
alter table public.seller_lead_portal_limits enable row level security;
revoke all on public.seller_lead_portal_limits from anon, authenticated;

create or replace function public.check_seller_lead_portal_limit(p_portal_id uuid, p_operation text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  counter public.seller_lead_portal_limits%rowtype;
  minute_limit integer := case when p_operation = 'submit' then 5 else 60 end;
  day_limit integer := case when p_operation = 'submit' then 100 else 3000 end;
begin
  insert into public.seller_lead_portal_limits as limits
    (portal_id, operation, minute_start, minute_count, day_start, day_count)
  values (p_portal_id, p_operation, date_trunc('minute', now()), 1, date_trunc('day', now()), 1)
  on conflict (portal_id, operation) do update
  set minute_start = date_trunc('minute', now()),
      minute_count = case when limits.minute_start < date_trunc('minute', now()) then 1 else limits.minute_count + 1 end,
      day_start = date_trunc('day', now()),
      day_count = case when limits.day_start < date_trunc('day', now()) then 1 else limits.day_count + 1 end
  returning * into counter;
  if counter.minute_count > minute_limit or counter.day_count > day_limit then
    raise exception 'PORTAL_RATE_LIMIT';
  end if;
end;
$$;

create or replace function public.get_or_create_seller_lead_portal(p_user_id uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare portal_id uuid;
begin
  if auth.uid() is null or not public.can_edit_owner_screen(p_user_id, 'leads') then
    raise exception 'No autorizado';
  end if;
  insert into public.seller_lead_portals (user_id) values (p_user_id)
  on conflict (user_id) do nothing;
  select id into portal_id from public.seller_lead_portals where user_id = p_user_id and enabled;
  if portal_id is null then raise exception 'PORTAL_UNAVAILABLE'; end if;
  return portal_id;
end;
$$;

-- Helper privado. Lista blanca explícita de la respuesta pública.
create or replace function public.seller_lead_public_result(p_user_id uuid, p_key text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  request_status text;
  verdict jsonb;
begin
  select status into request_status from public.seller_lead_requests
  where user_id = p_user_id and public.seller_lead_cedula_key(cedula) = p_key
    and status in ('pending_review', 'incomplete')
  order by updated_at desc, id limit 1;
  if found then
    return jsonb_build_object('status', request_status);
  end if;

  select data into verdict from public.lead_evaluations_cloud
  where user_id = p_user_id and public.seller_lead_cedula_key(data->>'cedula') = p_key
    and data->>'decision' in ('aplica', 'aplica_con_abono', 'no_aplica')
  order by updated_at desc, id limit 1;
  if found then
    return jsonb_build_object('status', 'reviewed', 'decision', verdict->>'decision',
      'extraDeposit', case
        when verdict->>'decision' = 'no_aplica' then 0
        when jsonb_typeof(verdict->'extraDeposit') = 'number' then greatest(0, (verdict->>'extraDeposit')::numeric)
        else 0 end);
  end if;
  return jsonb_build_object('status', 'not_found');
end;
$$;

create or replace function public.lookup_seller_lead(p_portal_id uuid, p_cedula text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare owner_id uuid; cedula_key text;
begin
  select user_id into owner_id from public.seller_lead_portals where id = p_portal_id and enabled;
  if not found then raise exception 'PORTAL_UNAVAILABLE'; end if;
  perform public.check_seller_lead_portal_limit(p_portal_id, 'lookup');
  cedula_key := public.seller_lead_cedula_key(p_cedula);
  if p_cedula is null or btrim(p_cedula) !~ '^[A-Za-z0-9 -]{4,32}$' or length(cedula_key) < 4 then
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
  if p_cedula is null or btrim(p_cedula) !~ '^[A-Za-z0-9 -]{4,32}$' or length(cedula_key) < 4 then
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

revoke all on function public.seller_lead_cedula_key(text) from public;
grant execute on function public.seller_lead_cedula_key(text) to authenticated, service_role;
revoke all on function public.check_seller_lead_portal_limit(uuid, text) from public, anon, authenticated;
revoke all on function public.seller_lead_public_result(uuid, text) from public, anon, authenticated;
revoke all on function public.get_or_create_seller_lead_portal(uuid) from public, anon;
grant execute on function public.get_or_create_seller_lead_portal(uuid) to authenticated;
revoke all on function public.lookup_seller_lead(uuid, text) from public;
grant execute on function public.lookup_seller_lead(uuid, text) to anon, authenticated;
revoke all on function public.submit_shared_seller_lead(uuid, text, date, text, text) from public;
grant execute on function public.submit_shared_seller_lead(uuid, text, date, text, text) to anon, authenticated;

commit;
