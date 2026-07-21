-- Rentautos: administracion de usuarios desde la app.
-- Ejecutar despues de 20-screen-permissions.sql.
--
-- Permite a usuarios con permiso Usuarios/Editar:
-- - crear usuarios Auth con password temporal
-- - resetear password temporal
-- - exigir cambio de password en el proximo login

create extension if not exists "pgcrypto";

create or replace function public.normalize_rentautos_auth_email(p_login text)
returns text
language plpgsql
immutable
as $$
declare
  v_login text := lower(trim(coalesce(p_login, '')));
  v_normalized text;
begin
  if v_login = '' then
    raise exception 'El ID/usuario es obligatorio.';
  end if;

  if position('@' in v_login) > 0 then
    return v_login;
  end if;

  v_normalized := regexp_replace(v_login, '[^a-z0-9._-]', '', 'g');
  if v_normalized = '' then
    raise exception 'El ID/usuario no es valido.';
  end if;

  return v_normalized || '@auth.rentautos.local';
end;
$$;

create or replace function public.ensure_email_identity(p_user_id uuid, p_email text)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if exists (select 1 from auth.identities where user_id = p_user_id and provider = 'email') then
    update auth.identities
    set provider_id = p_user_id::text,
        identity_data = jsonb_build_object(
          'sub', p_user_id::text,
          'email', p_email,
          'email_verified', false,
          'phone_verified', false
        ),
        updated_at = now()
    where user_id = p_user_id
      and provider = 'email';
  else
    insert into auth.identities (
      id,
      user_id,
      provider_id,
      identity_data,
      provider,
      last_sign_in_at,
      created_at,
      updated_at
    )
    values (
      gen_random_uuid(),
      p_user_id,
      p_user_id::text,
      jsonb_build_object(
        'sub', p_user_id::text,
        'email', p_email,
        'email_verified', false,
        'phone_verified', false
      ),
      'email',
      now(),
      now(),
      now()
    );
  end if;
end;
$$;

create or replace function public.admin_create_app_user(
  p_login text,
  p_password text,
  p_role public.app_role default 'lectura',
  p_data_owner_user_id uuid default null,
  p_permissions jsonb default null
)
returns public.user_profiles
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_email text := public.normalize_rentautos_auth_email(p_login);
  v_password text := coalesce(p_password, '');
  v_user_id uuid := gen_random_uuid();
  v_owner_id uuid;
  v_permissions jsonb := coalesce(p_permissions, public.default_screen_permissions(p_role));
  v_profile public.user_profiles;
begin
  if not public.can_manage_users() then
    raise exception 'No tienes permiso para crear usuarios.';
  end if;

  if length(v_password) < 8 then
    raise exception 'La password temporal debe tener al menos 8 caracteres.';
  end if;

  if exists (select 1 from auth.users where lower(email) = v_email) then
    raise exception 'Ya existe un usuario con ese ID/email.';
  end if;

  v_owner_id := case
    when p_role = 'admin' then v_user_id
    else coalesce(p_data_owner_user_id, auth.uid())
  end;

  if v_owner_id is null then
    raise exception 'No se pudo determinar el dataset/owner.';
  end if;

  insert into auth.users (
    id,
    instance_id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    confirmation_sent_at,
    confirmation_token,
    recovery_token,
    email_change,
    email_change_token_new,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at
  )
  values (
    v_user_id,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    v_email,
    extensions.crypt(v_password, extensions.gen_salt('bf')),
    now(),
    null,
    '',
    '',
    '',
    '',
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('email_verified', true, 'must_change_password', true),
    now(),
    now()
  );

  perform public.ensure_email_identity(v_user_id, v_email);

  insert into public.user_profiles (
    id,
    email,
    role,
    data_owner_user_id,
    permissions
  )
  values (
    v_user_id,
    v_email,
    p_role,
    v_owner_id,
    v_permissions
  )
  on conflict (id) do update
  set email = excluded.email,
      role = excluded.role,
      data_owner_user_id = excluded.data_owner_user_id,
      permissions = excluded.permissions,
      updated_at = now()
  returning * into v_profile;

  return v_profile;
end;
$$;

create or replace function public.admin_finalize_app_user(
  p_user_id uuid,
  p_role public.app_role default 'lectura',
  p_data_owner_user_id uuid default null,
  p_permissions jsonb default null
)
returns public.user_profiles
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_email text;
  v_owner_id uuid;
  v_permissions jsonb := coalesce(p_permissions, public.default_screen_permissions(p_role));
  v_profile public.user_profiles;
begin
  if not public.can_manage_users() then
    raise exception 'No tienes permiso para crear usuarios.';
  end if;

  select lower(email)
    into v_email
  from auth.users
  where id = p_user_id;

  if v_email is null or v_email = '' then
    raise exception 'El usuario Auth no existe o no tiene email.';
  end if;

  v_owner_id := case
    when p_role = 'admin' then p_user_id
    else coalesce(p_data_owner_user_id, auth.uid())
  end;

  if v_owner_id is null then
    raise exception 'No se pudo determinar el dataset/owner.';
  end if;

  update auth.users
  set email_confirmed_at = coalesce(email_confirmed_at, now()),
      confirmation_token = coalesce(confirmation_token, ''),
      recovery_token = coalesce(recovery_token, ''),
      email_change = coalesce(email_change, ''),
      email_change_token_new = coalesce(email_change_token_new, ''),
      raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
        || jsonb_build_object('email_verified', true, 'must_change_password', true),
      updated_at = now()
  where id = p_user_id;

  insert into public.user_profiles (
    id,
    email,
    role,
    data_owner_user_id,
    permissions
  )
  values (
    p_user_id,
    v_email,
    p_role,
    v_owner_id,
    v_permissions
  )
  on conflict (id) do update
  set email = excluded.email,
      role = excluded.role,
      data_owner_user_id = excluded.data_owner_user_id,
      permissions = excluded.permissions,
      updated_at = now()
  returning * into v_profile;

  return v_profile;
end;
$$;

create or replace function public.admin_reset_app_user_password(
  p_user_id uuid,
  p_password text
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_password text := coalesce(p_password, '');
begin
  if not public.can_manage_users() then
    raise exception 'No tienes permiso para resetear passwords.';
  end if;

  if length(v_password) < 8 then
    raise exception 'La password temporal debe tener al menos 8 caracteres.';
  end if;

  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'El usuario no existe.';
  end if;

  update auth.users
  set encrypted_password = extensions.crypt(v_password, extensions.gen_salt('bf')),
      recovery_token = '',
      recovery_sent_at = null,
      confirmation_token = coalesce(confirmation_token, ''),
      email_change = coalesce(email_change, ''),
      email_change_token_new = coalesce(email_change_token_new, ''),
      raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
        || jsonb_build_object('must_change_password', true),
      updated_at = now()
  where id = p_user_id;
end;
$$;

create or replace function public.mark_own_password_changed()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null then
    raise exception 'No autenticado.';
  end if;

  update auth.users
  set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
    || jsonb_build_object('must_change_password', false),
      updated_at = now()
  where id = auth.uid();
end;
$$;

grant execute on function public.normalize_rentautos_auth_email(text) to authenticated;
grant execute on function public.admin_create_app_user(text, text, public.app_role, uuid, jsonb) to authenticated;
grant execute on function public.admin_finalize_app_user(uuid, public.app_role, uuid, jsonb) to authenticated;
grant execute on function public.admin_reset_app_user_password(uuid, text) to authenticated;
grant execute on function public.mark_own_password_changed() to authenticated;
