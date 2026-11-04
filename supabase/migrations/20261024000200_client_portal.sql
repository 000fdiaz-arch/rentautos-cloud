-- Portal privado de clientes: acceso por cedula + unidad + PIN, sesiones efimeras
-- y notificaciones de pago con evidencia privada.
-- Ejecutar despues de 98-notified-payment-atomic-consumption.sql.

begin;

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.client_portal_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null,
  cedula_key text not null,
  unit_key text not null,
  pin_hash text not null,
  active boolean not null default true,
  failed_attempts smallint not null default 0 check (failed_attempts between 0 and 20),
  locked_until timestamptz,
  pin_changed_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (user_id, cedula_key)
);

create index if not exists client_portal_accounts_login_idx
  on public.client_portal_accounts (cedula_key, unit_key)
  where active;

create table if not exists public.client_portal_sessions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.client_portal_accounts(id) on delete cascade,
  selected_client_id text,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  last_seen_at timestamptz not null default clock_timestamp()
);

alter table public.client_portal_sessions
  add column if not exists selected_client_id text;

create index if not exists client_portal_sessions_account_idx
  on public.client_portal_sessions (account_id, expires_at desc);

create table if not exists public.client_payment_notices (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null,
  account_id uuid not null references public.client_portal_accounts(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0 and amount <= 9999999999.99),
  payment_channel text not null default 'regular_transfer' check (payment_channel in ('ach_xpress', 'regular_transfer')),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected')),
  evidence_path text not null,
  evidence_name text not null,
  evidence_mime text not null,
  evidence_size integer not null check (evidence_size > 0 and evidence_size <= 4194304),
  evidence_sha256 text not null,
  payment_id text,
  rejection_reason text,
  submitted_at timestamptz not null default clock_timestamp(),
  reviewed_at timestamptz,
  updated_at timestamptz not null default clock_timestamp()
);

alter table public.client_payment_notices
  add column if not exists payment_channel text not null default 'regular_transfer'
  check (payment_channel in ('ach_xpress', 'regular_transfer'));

create index if not exists client_payment_notices_owner_status_idx
  on public.client_payment_notices (user_id, status, submitted_at desc);
create index if not exists client_payment_notices_client_idx
  on public.client_payment_notices (account_id, submitted_at desc);
create unique index if not exists client_payment_notices_active_evidence_uq
  on public.client_payment_notices (user_id, client_id, evidence_sha256)
  where status <> 'rejected';

alter table public.client_portal_accounts enable row level security;
alter table public.client_portal_sessions enable row level security;
alter table public.client_payment_notices enable row level security;

revoke all on public.client_portal_accounts from public, anon, authenticated;
revoke all on public.client_portal_sessions from public, anon, authenticated;
revoke all on public.client_payment_notices from public, anon, authenticated;

drop policy if exists client_portal_accounts_staff_read on public.client_portal_accounts;
create policy client_portal_accounts_staff_read on public.client_portal_accounts
for select to authenticated
using (public.can_view_owner_screen(user_id, 'clients'));

drop policy if exists client_payment_notices_staff_read on public.client_payment_notices;
create policy client_payment_notices_staff_read on public.client_payment_notices
for select to authenticated
using (public.can_view_owner_screen(user_id, 'payments'));

grant select on public.client_portal_accounts to authenticated;
grant select on public.client_payment_notices to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'client-payment-evidence',
  'client-payment-evidence',
  false,
  4194304,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists client_payment_evidence_staff_read on storage.objects;
create policy client_payment_evidence_staff_read on storage.objects
for select to authenticated
using (
  bucket_id = 'client-payment-evidence'
  and case
    when split_part(name, '/', 1) ~* '^[0-9a-f-]{36}$'
      then public.can_view_owner_screen(split_part(name, '/', 1)::uuid, 'payments')
    else false
  end
);

create or replace function public.client_portal_cedula_key(p_value text)
returns text language sql immutable set search_path = '' as $$
  select regexp_replace(coalesce(p_value, ''), '[^0-9]', '', 'g');
$$;

create or replace function public.client_portal_unit_key(p_value text)
returns text language sql immutable set search_path = '' as $$
  select upper(regexp_replace(coalesce(p_value, ''), '[^A-Za-z0-9]', '', 'g'));
$$;

create or replace function public.client_portal_access_status(p_owner_user_id uuid, p_client_id text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_account public.client_portal_accounts;
  v_client jsonb;
  v_cedula_key text;
begin
  if auth.uid() is null or not coalesce(public.can_view_owner_screen(p_owner_user_id, 'clients'), false) then
    raise exception 'No tienes permiso para consultar el portal del cliente.';
  end if;
  select data into v_client from public.clients_cloud
  where user_id = p_owner_user_id and id = p_client_id;
  v_cedula_key := public.client_portal_cedula_key(v_client->>'cedula');
  select * into v_account from public.client_portal_accounts
  where user_id = p_owner_user_id and cedula_key = v_cedula_key;
  return jsonb_build_object(
    'configured', found,
    'active', coalesce(v_account.active, false),
    'pinChangedAt', v_account.pin_changed_at,
    'updatedAt', v_account.updated_at
  );
end;
$$;

create or replace function public.configure_client_portal_access(
  p_owner_user_id uuid,
  p_client_id text,
  p_pin text
)
returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_client jsonb;
  v_cedula_key text;
  v_unit_key text;
  v_account_id uuid;
begin
  if auth.uid() is null or not coalesce(public.can_edit_owner_screen(p_owner_user_id, 'clients'), false) then
    raise exception 'No tienes permiso para configurar el portal del cliente.';
  end if;
  if p_pin is null or p_pin !~ '^[0-9]{6}$' then
    raise exception 'El PIN debe contener exactamente 6 digitos.';
  end if;
  select data into v_client from public.clients_cloud
  where user_id = p_owner_user_id and id = p_client_id;
  if v_client is null then raise exception 'El cliente no existe.'; end if;
  if coalesce(v_client->>'status', 'activo') = 'archivado' then
    raise exception 'No se puede habilitar el portal para un cliente archivado.';
  end if;
  v_cedula_key := public.client_portal_cedula_key(v_client->>'cedula');
  v_unit_key := public.client_portal_unit_key(v_client->>'unitId');
  if length(v_cedula_key) < 4 then raise exception 'El cliente necesita una cedula valida.'; end if;
  if length(v_unit_key) < 1 then raise exception 'El cliente necesita una unidad valida.'; end if;

  update public.client_portal_sessions
  set revoked_at = clock_timestamp()
  where revoked_at is null and account_id in (
    select id from public.client_portal_accounts
    where user_id = p_owner_user_id and client_id = p_client_id and cedula_key <> v_cedula_key
  );
  update public.client_portal_accounts
  set active = false, updated_at = clock_timestamp()
  where user_id = p_owner_user_id and client_id = p_client_id and cedula_key <> v_cedula_key;

  insert into public.client_portal_accounts(
    user_id, client_id, cedula_key, unit_key, pin_hash, active,
    failed_attempts, locked_until, pin_changed_at, updated_at
  ) values (
    p_owner_user_id, p_client_id, v_cedula_key, v_unit_key,
    crypt(p_pin, gen_salt('bf', 12)), true, 0, null, clock_timestamp(), clock_timestamp()
  )
  on conflict (user_id, cedula_key) do update set
    client_id = excluded.client_id,
    unit_key = excluded.unit_key,
    pin_hash = excluded.pin_hash,
    active = true,
    failed_attempts = 0,
    locked_until = null,
    pin_changed_at = clock_timestamp(),
    updated_at = clock_timestamp()
  returning id into v_account_id;

  update public.client_portal_sessions set revoked_at = clock_timestamp()
  where account_id = v_account_id and revoked_at is null;

  return jsonb_build_object('configured', true, 'active', true, 'pinChangedAt', clock_timestamp());
end;
$$;

create or replace function public.disable_client_portal_access(p_owner_user_id uuid, p_client_id text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_account_id uuid;
  v_client jsonb;
  v_cedula_key text;
begin
  if auth.uid() is null or not coalesce(public.can_edit_owner_screen(p_owner_user_id, 'clients'), false) then
    raise exception 'No tienes permiso para desactivar el portal del cliente.';
  end if;
  select data into v_client from public.clients_cloud
  where user_id = p_owner_user_id and id = p_client_id;
  v_cedula_key := public.client_portal_cedula_key(v_client->>'cedula');
  update public.client_portal_accounts
  set active = false, failed_attempts = 0, locked_until = null, updated_at = clock_timestamp()
  where user_id = p_owner_user_id and cedula_key = v_cedula_key
  returning id into v_account_id;
  if v_account_id is not null then
    update public.client_portal_sessions set revoked_at = clock_timestamp()
    where account_id = v_account_id and revoked_at is null;
  end if;
end;
$$;

drop function if exists public.client_portal_login(text,text,text);
create or replace function public.client_portal_login(p_cedula text, p_pin text)
returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_cedula_key text := public.client_portal_cedula_key(p_cedula);
  v_account public.client_portal_accounts;
  v_match_count integer := 0;
  v_selected_client_id text;
  v_token text;
  v_expires_at timestamptz := clock_timestamp() + interval '12 hours';
begin
  if length(v_cedula_key) < 4 or p_pin is null or p_pin !~ '^[0-9]{6}$' then
    raise exception 'PORTAL_INVALID_CREDENTIALS';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_cedula_key, 0));

  select count(*) into v_match_count
  from public.client_portal_accounts a
  where a.cedula_key = v_cedula_key
    and a.active
    and (a.locked_until is null or a.locked_until <= clock_timestamp())
    and crypt(p_pin, a.pin_hash) = a.pin_hash;

  if v_match_count = 1 then
    select a.* into v_account
    from public.client_portal_accounts a
    where a.cedula_key = v_cedula_key
      and a.active
      and (a.locked_until is null or a.locked_until <= clock_timestamp())
      and crypt(p_pin, a.pin_hash) = a.pin_hash
    order by a.updated_at desc
    limit 1;

    select c.id into v_selected_client_id
    from public.clients_cloud c
    where c.user_id = v_account.user_id
      and public.client_portal_cedula_key(c.data->>'cedula') = v_cedula_key
      and coalesce(c.data->>'status', 'activo') <> 'archivado'
    order by case when c.id = v_account.client_id then 0 else 1 end, c.updated_at desc, c.id
    limit 1;
  end if;

  if v_match_count <> 1 or v_account.id is null or v_selected_client_id is null then
    update public.client_portal_accounts
    set failed_attempts = least(20, failed_attempts + 1),
        locked_until = case when failed_attempts + 1 >= 5 then clock_timestamp() + interval '15 minutes' else locked_until end,
        updated_at = clock_timestamp()
    where cedula_key = v_cedula_key and active;
    return jsonb_build_object('error', 'PORTAL_INVALID_CREDENTIALS');
  end if;

  update public.client_portal_accounts
  set failed_attempts = 0, locked_until = null, updated_at = clock_timestamp()
  where id = v_account.id;
  delete from public.client_portal_sessions
  where account_id = v_account.id and (expires_at <= clock_timestamp() or revoked_at is not null);

  v_token := encode(gen_random_bytes(32), 'hex');
  insert into public.client_portal_sessions(account_id, selected_client_id, token_hash, expires_at)
  values (v_account.id, v_selected_client_id, encode(digest(v_token, 'sha256'), 'hex'), v_expires_at);
  return jsonb_build_object('token', v_token, 'expiresAt', v_expires_at);
end;
$$;

create or replace function public.client_portal_snapshot(p_session_token text)
returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_account public.client_portal_accounts;
  v_session public.client_portal_sessions;
  v_client jsonb;
  v_vehicle jsonb;
  v_units jsonb;
  v_payments jsonb;
  v_notices jsonb;
begin
  if p_session_token is null or length(p_session_token) < 32 then raise exception 'PORTAL_SESSION_INVALID'; end if;
  select s.* into v_session
  from public.client_portal_sessions s
  join public.client_portal_accounts a on a.id = s.account_id
  where s.token_hash = encode(digest(p_session_token, 'sha256'), 'hex')
    and s.revoked_at is null and s.expires_at > clock_timestamp() and a.active;
  if v_session.id is null then raise exception 'PORTAL_SESSION_INVALID'; end if;

  select a.* into v_account
  from public.client_portal_accounts a
  where a.id = v_session.account_id and a.active;
  if v_account.id is null then raise exception 'PORTAL_SESSION_INVALID'; end if;

  update public.client_portal_sessions set last_seen_at = clock_timestamp() where id = v_session.id;
  select data into v_client from public.clients_cloud
  where user_id = v_account.user_id and id = coalesce(v_session.selected_client_id, v_account.client_id)
    and public.client_portal_cedula_key(data->>'cedula') = v_account.cedula_key;
  if v_client is null then raise exception 'PORTAL_ACCOUNT_UNAVAILABLE'; end if;

  select jsonb_build_object(
    'brandModel', f.brand_model, 'plate', f.plate, 'year', f.year,
    'color', f.color, 'status', f.operational_status
  ) into v_vehicle
  from public.fleet_units_cloud f
  where f.user_id = v_account.user_id
    and public.client_portal_unit_key(f.unit_id) = public.client_portal_unit_key(v_client->>'unitId')
  limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
    'client', jsonb_build_object(
      'id', available.id,
      'name', available.data->>'name',
      'cedulaMasked', case when length(v_account.cedula_key) > 4 then left(v_account.cedula_key, 3) || repeat('•', greatest(4, length(v_account.cedula_key) - 3)) else '••••' end,
      'unitId', available.data->>'unitId',
      'status', coalesce(available.data->>'status', 'activo'),
      'rentAmount', coalesce((available.data->>'rentAmount')::numeric, 0),
      'frequency', coalesce(available.data->>'frequency', 'weekly'),
      'weeklyChargeDay', available.data->>'weeklyChargeDay',
      'monthlyChargeDay', case when available.data->>'monthlyChargeDay' ~ '^[0-9]+$' then (available.data->>'monthlyChargeDay')::integer else null end,
      'chargeFirstSunday', coalesce((available.data->>'chargeFirstSunday')::boolean, false),
      'firstSundayChargedAt', available.data->>'firstSundayChargedAt',
      'firstChargeDate', available.data->>'firstChargeDate',
      'lastChargeDate', available.data->>'lastChargeDate',
      'installmentsAgreed', coalesce((available.data->>'installmentsAgreed')::integer, 0),
      'installmentsIssued', coalesce((available.data->>'installmentsIssued')::integer, 0),
      'installmentsRemaining', coalesce((available.data->>'installmentsRemaining')::integer, 0),
      'installmentsPaid', coalesce((available.data->>'installmentsPaid')::integer, 0),
      'balance', coalesce((available.data->>'balance')::numeric, 0),
      'advanceBalance', coalesce((available.data->>'advanceBalance')::numeric, 0),
      'otherCharges', coalesce(available.data->'otherCharges', '[]'::jsonb),
      'fines', coalesce(available.data->'fines', '[]'::jsonb),
      'tickets', coalesce(available.data->'tickets', '[]'::jsonb),
      'whatsAppPhone', available.data->>'whatsAppPhone'
    ),
    'vehicle', coalesce(available.vehicle, '{}'::jsonb)
  ) order by case when available.id = v_session.selected_client_id then 0 else 1 end, available.data->>'unitId'), '[]'::jsonb)
  into v_units
  from (
    select c.id, c.data, (
      select jsonb_build_object(
        'brandModel', f.brand_model, 'plate', f.plate, 'year', f.year,
        'color', f.color, 'status', f.operational_status
      )
      from public.fleet_units_cloud f
      where f.user_id = c.user_id
        and public.client_portal_unit_key(f.unit_id) = public.client_portal_unit_key(c.data->>'unitId')
      limit 1
    ) as vehicle
    from public.clients_cloud c
    where c.user_id = v_account.user_id
      and public.client_portal_cedula_key(c.data->>'cedula') = v_account.cedula_key
      and coalesce(c.data->>'status', 'activo') <> 'archivado'
  ) available;

  select coalesce(jsonb_agg(item order by item->>'createdAt' desc), '[]'::jsonb) into v_payments
  from (
    select jsonb_build_object(
      'id', p.id,
      'clientId', p.data->>'clientId',
      'receiptNumber', p.data->>'receiptNumber',
      'dateApplied', p.data->>'dateApplied',
      'paymentMethod', p.data->>'paymentMethod',
      'amountReceived', coalesce((p.data->>'amountReceived')::numeric, 0),
      'createdAt', p.data->>'createdAt',
      'receipt', p.data
    ) as item
    from public.payments_cloud p
    where p.user_id = v_account.user_id
      and exists (
        select 1 from public.clients_cloud c
        where c.user_id = v_account.user_id
          and c.id = p.data->>'clientId'
          and public.client_portal_cedula_key(c.data->>'cedula') = v_account.cedula_key
      )
      and coalesce(p.data->>'paymentContext', 'regular') = 'regular'
    order by p.created_at desc, p.id desc
    limit 24
  ) recent;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', n.id, 'clientId', n.client_id,
    'unitId', coalesce((select c.data->>'unitId' from public.clients_cloud c where c.user_id = n.user_id and c.id = n.client_id), ''),
    'amount', n.amount, 'paymentChannel', n.payment_channel, 'status', n.status,
    'evidenceName', n.evidence_name, 'submittedAt', n.submitted_at,
    'reviewedAt', n.reviewed_at, 'rejectionReason', n.rejection_reason
  ) order by n.submitted_at desc), '[]'::jsonb) into v_notices
  from public.client_payment_notices n
  where n.account_id = v_account.id;

  return jsonb_build_object(
    'client', jsonb_build_object(
      'id', v_account.client_id,
      'name', v_client->>'name',
      'cedulaMasked', case when length(v_account.cedula_key) > 4 then left(v_account.cedula_key, 3) || repeat('•', greatest(4, length(v_account.cedula_key) - 3)) else '••••' end,
      'unitId', v_client->>'unitId',
      'status', coalesce(v_client->>'status', 'activo'),
      'rentAmount', coalesce((v_client->>'rentAmount')::numeric, 0),
      'frequency', coalesce(v_client->>'frequency', 'weekly'),
      'weeklyChargeDay', v_client->>'weeklyChargeDay',
      'monthlyChargeDay', case when v_client->>'monthlyChargeDay' ~ '^[0-9]+$' then (v_client->>'monthlyChargeDay')::integer else null end,
      'chargeFirstSunday', coalesce((v_client->>'chargeFirstSunday')::boolean, false),
      'firstSundayChargedAt', v_client->>'firstSundayChargedAt',
      'firstChargeDate', v_client->>'firstChargeDate',
      'lastChargeDate', v_client->>'lastChargeDate',
      'installmentsAgreed', coalesce((v_client->>'installmentsAgreed')::integer, 0),
      'installmentsIssued', coalesce((v_client->>'installmentsIssued')::integer, 0),
      'installmentsRemaining', coalesce((v_client->>'installmentsRemaining')::integer, 0),
      'installmentsPaid', coalesce((v_client->>'installmentsPaid')::integer, 0),
      'balance', coalesce((v_client->>'balance')::numeric, 0),
      'advanceBalance', coalesce((v_client->>'advanceBalance')::numeric, 0),
      'otherCharges', coalesce(v_client->'otherCharges', '[]'::jsonb),
      'fines', coalesce(v_client->'fines', '[]'::jsonb),
      'tickets', coalesce(v_client->'tickets', '[]'::jsonb),
      'whatsAppPhone', v_client->>'whatsAppPhone'
    ),
    'vehicle', coalesce(v_vehicle, '{}'::jsonb),
    'units', v_units,
    'payments', v_payments,
    'notices', v_notices,
    'sessionExpiresAt', v_session.expires_at
  );
end;
$$;

create or replace function public.prepare_client_payment_notice(
  p_session_token text,
  p_client_id text,
  p_amount numeric,
  p_evidence_name text,
  p_evidence_mime text,
  p_evidence_size integer,
  p_evidence_sha256 text
)
returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_account public.client_portal_accounts;
  v_client jsonb;
  v_notice_id uuid := gen_random_uuid();
  v_extension text;
begin
  select a.* into v_account
  from public.client_portal_sessions s join public.client_portal_accounts a on a.id = s.account_id
  where s.token_hash = encode(digest(p_session_token, 'sha256'), 'hex')
    and s.revoked_at is null and s.expires_at > clock_timestamp() and a.active;
  if v_account.id is null then raise exception 'PORTAL_SESSION_INVALID'; end if;
  select data into v_client from public.clients_cloud
  where user_id = v_account.user_id and id = p_client_id
    and public.client_portal_cedula_key(data->>'cedula') = v_account.cedula_key
    and coalesce(data->>'status', 'activo') <> 'archivado';
  if v_client is null then raise exception 'PORTAL_ACCOUNT_UNAVAILABLE'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > 9999999999.99 or p_amount <> round(p_amount, 2) then
    raise exception 'Monto no valido.';
  end if;
  v_extension := case lower(p_evidence_mime)
    when 'image/jpeg' then 'jpg' when 'image/png' then 'png'
    when 'image/webp' then 'webp' when 'application/pdf' then 'pdf' else null end;
  if v_extension is null or p_evidence_size is null or p_evidence_size < 1 or p_evidence_size > 4194304
    or p_evidence_sha256 !~ '^[0-9a-f]{64}$'
    or coalesce(length(btrim(p_evidence_name)), 0) = 0 then
    raise exception 'Comprobante no valido.';
  end if;
  if exists (
    select 1 from public.client_payment_notices n
    where n.user_id = v_account.user_id and n.client_id = p_client_id
      and n.evidence_sha256 = lower(p_evidence_sha256)
      and n.status <> 'rejected'
  ) then raise exception 'PORTAL_DUPLICATE_NOTICE'; end if;
  return jsonb_build_object(
    'noticeId', v_notice_id,
    'ownerId', v_account.user_id,
    'clientId', p_client_id,
    'path', v_account.user_id::text || '/' || v_account.id::text || '/' || v_notice_id::text || '.' || v_extension
  );
end;
$$;

drop function if exists public.finalize_client_payment_notice(text,text,uuid,numeric,text,text,text,integer,text);

create or replace function public.finalize_client_payment_notice(
  p_session_token text,
  p_client_id text,
  p_notice_id uuid,
  p_amount numeric,
  p_evidence_name text,
  p_evidence_path text,
  p_evidence_mime text,
  p_evidence_size integer,
  p_evidence_sha256 text,
  p_payment_channel text
)
returns jsonb
language plpgsql security definer set search_path = public, extensions, storage, pg_temp as $$
declare
  v_account public.client_portal_accounts;
  v_client jsonb;
  v_expected_extension text;
  v_expected_path text;
  v_created_at timestamptz := clock_timestamp();
begin
  select a.* into v_account
  from public.client_portal_sessions s join public.client_portal_accounts a on a.id = s.account_id
  where s.token_hash = encode(digest(p_session_token, 'sha256'), 'hex')
    and s.revoked_at is null and s.expires_at > clock_timestamp() and a.active;
  if v_account.id is null then raise exception 'PORTAL_SESSION_INVALID'; end if;
  select data into v_client from public.clients_cloud
  where user_id = v_account.user_id and id = p_client_id
    and public.client_portal_cedula_key(data->>'cedula') = v_account.cedula_key
    and coalesce(data->>'status', 'activo') <> 'archivado';
  if v_client is null then raise exception 'PORTAL_ACCOUNT_UNAVAILABLE'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > 9999999999.99 or p_amount <> round(p_amount, 2) then
    raise exception 'Monto no valido.';
  end if;
  if p_payment_channel is null or p_payment_channel not in ('ach_xpress', 'regular_transfer') then
    raise exception 'Metodo de transferencia no valido.';
  end if;
  v_expected_extension := case lower(p_evidence_mime)
    when 'image/jpeg' then 'jpg' when 'image/png' then 'png'
    when 'image/webp' then 'webp' when 'application/pdf' then 'pdf' else null end;
  v_expected_path := v_account.user_id::text || '/' || v_account.id::text || '/' || p_notice_id::text || '.' || v_expected_extension;
  if v_expected_extension is null or p_evidence_path is distinct from v_expected_path
    or p_evidence_size is null or p_evidence_size < 1 or p_evidence_size > 4194304
    or p_evidence_sha256 !~ '^[0-9a-f]{64}$'
    or coalesce(length(btrim(p_evidence_name)), 0) = 0 then
    raise exception 'Comprobante no valido.';
  end if;
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'client-payment-evidence' and o.name = v_expected_path
      and coalesce((o.metadata->>'size')::integer, -1) = p_evidence_size
  ) then raise exception 'Comprobante no encontrado.'; end if;

  insert into public.client_payment_notices(
    id, user_id, client_id, account_id, amount, payment_channel, evidence_path, evidence_name,
    evidence_mime, evidence_size, evidence_sha256, submitted_at, updated_at
  ) values (
    p_notice_id, v_account.user_id, p_client_id, v_account.id, round(p_amount, 2),
    p_payment_channel, v_expected_path, left(btrim(p_evidence_name), 240), lower(p_evidence_mime),
    p_evidence_size, lower(p_evidence_sha256), v_created_at, v_created_at
  );

  insert into public.notified_payments_cloud(user_id, id, data)
  values (
    v_account.user_id,
    p_notice_id::text,
    jsonb_build_object(
      'id', p_notice_id::text,
      'clientId', p_client_id,
      'amount', round(p_amount, 2),
      'createdAt', v_created_at,
      'paymentMethod', 'bank',
      'portalPaymentChannel', p_payment_channel,
      'source', 'client-portal',
      'clientPaymentNoticeId', p_notice_id::text,
      'evidencePath', v_expected_path,
      'evidenceName', left(btrim(p_evidence_name), 240)
    )
  );
  return public.client_portal_snapshot(p_session_token);
exception when unique_violation then
  raise exception 'PORTAL_DUPLICATE_NOTICE';
end;
$$;

create or replace function public.client_portal_logout(p_session_token text)
returns void
language sql security definer set search_path = public, extensions as $$
  update public.client_portal_sessions
  set revoked_at = clock_timestamp()
  where token_hash = encode(digest(p_session_token, 'sha256'), 'hex') and revoked_at is null;
$$;

create or replace function public.sync_client_payment_notice_from_tombstone()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.client_payment_notices
  set status = case when new.reason in ('bank_payment_applied', 'bank_payment_already_applied') then 'confirmed' else 'rejected' end,
      payment_id = new.consumed_by_payment_id,
      rejection_reason = case when new.reason in ('bank_payment_applied', 'bank_payment_already_applied') then null else 'No se pudo confirmar este aviso. Comunicate con Rentautos.' end,
      reviewed_at = new.consumed_at,
      updated_at = clock_timestamp()
  where user_id = new.user_id and id::text = new.notice_id;
  return new;
end;
$$;

drop trigger if exists sync_client_payment_notice_from_tombstone on public.notified_payment_tombstones;
create trigger sync_client_payment_notice_from_tombstone
after insert or update on public.notified_payment_tombstones
for each row execute function public.sync_client_payment_notice_from_tombstone();

create or replace function public.sync_client_payment_notice_from_notified_delete()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.client_payment_notices
  set status = 'rejected',
      rejection_reason = 'El comprobante fue descartado. Verifica los datos o comunicate con Rentautos.',
      reviewed_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where user_id = old.user_id and id::text = old.id and status = 'pending';
  return old;
end;
$$;

drop trigger if exists sync_client_payment_notice_from_notified_delete on public.notified_payments_cloud;
create trigger sync_client_payment_notice_from_notified_delete
after delete on public.notified_payments_cloud
for each row execute function public.sync_client_payment_notice_from_notified_delete();

revoke all on function public.client_portal_cedula_key(text) from public, anon, authenticated;
revoke all on function public.client_portal_unit_key(text) from public, anon, authenticated;
revoke all on function public.client_portal_access_status(uuid,text) from public, anon, authenticated;
revoke all on function public.configure_client_portal_access(uuid,text,text) from public, anon, authenticated;
revoke all on function public.disable_client_portal_access(uuid,text) from public, anon, authenticated;
revoke all on function public.client_portal_login(text,text) from public, anon, authenticated;
revoke all on function public.client_portal_snapshot(text) from public, anon, authenticated;
revoke all on function public.prepare_client_payment_notice(text,text,numeric,text,text,integer,text) from public, anon, authenticated;
revoke all on function public.finalize_client_payment_notice(text,text,uuid,numeric,text,text,text,integer,text,text) from public, anon, authenticated;
revoke all on function public.client_portal_logout(text) from public, anon, authenticated;
revoke all on function public.sync_client_payment_notice_from_tombstone() from public, anon, authenticated;
revoke all on function public.sync_client_payment_notice_from_notified_delete() from public, anon, authenticated;

grant execute on function public.client_portal_access_status(uuid,text) to authenticated;
grant execute on function public.configure_client_portal_access(uuid,text,text) to authenticated;
grant execute on function public.disable_client_portal_access(uuid,text) to authenticated;
grant execute on function public.client_portal_login(text,text) to service_role;
grant execute on function public.client_portal_snapshot(text) to service_role;
grant execute on function public.prepare_client_payment_notice(text,text,numeric,text,text,integer,text) to service_role;
grant execute on function public.finalize_client_payment_notice(text,text,uuid,numeric,text,text,text,integer,text,text) to service_role;
grant execute on function public.client_portal_logout(text) to service_role;

notify pgrst, 'reload schema';
commit;
