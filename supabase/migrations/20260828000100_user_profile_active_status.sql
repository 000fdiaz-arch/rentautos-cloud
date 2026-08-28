-- Add real active/inactive user lifecycle management.

alter table public.user_profiles
  add column if not exists is_active boolean not null default true;

create index if not exists user_profiles_active_role_idx
  on public.user_profiles (is_active, role);

create or replace function public.current_user_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.user_profiles
  where id = (select auth.uid())
    and is_active
  limit 1;
$$;

create or replace function public.has_role(required_role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_profiles
    where id = (select auth.uid())
      and is_active
      and role = required_role
  );
$$;

create or replace function public.current_data_owner_user_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(up.data_owner_user_id, up.id)
  from public.user_profiles up
  where up.id = (select auth.uid())
    and up.is_active
  limit 1;
$$;

create or replace function public.can_access_owner_data(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_profiles current_profile
    where current_profile.id = (select auth.uid())
      and current_profile.is_active
      and (
        target_user_id = (select auth.uid())
        or (select public.has_role('admin'))
        or target_user_id = (select public.current_data_owner_user_id())
      )
  );
$$;

create or replace function public.current_user_screen_permissions()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when up.role = 'admin'::public.app_role then public.default_screen_permissions(up.role)
    else public.default_screen_permissions(up.role) || coalesce(up.permissions, '{}'::jsonb)
  end
  from public.user_profiles up
  where up.id = (select auth.uid())
    and up.is_active;
$$;

create or replace function public.prevent_self_privilege_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() = old.id and old.is_active is distinct from new.is_active then
    raise exception 'No puedes cambiar el estado de tu propia sesion.';
  end if;

  if auth.uid() = old.id
    and not public.can_manage_users()
    and (
      old.role is distinct from new.role
      or old.data_owner_user_id is distinct from new.data_owner_user_id
      or old.permissions is distinct from new.permissions
    )
  then
    raise exception 'No puedes cambiar tu rol, permisos ni el dataset asignado.';
  end if;

  if not public.can_manage_users() and auth.uid() is distinct from old.id then
    raise exception 'Solo admin puede modificar otros perfiles.';
  end if;

  if old.role = 'admin'::public.app_role
    and old.is_active
    and (new.role is distinct from 'admin'::public.app_role or not new.is_active)
    and (select count(*) from public.user_profiles where role = 'admin'::public.app_role and is_active) <= 1
  then
    raise exception 'No puedes desactivar ni cambiar el rol del ultimo administrador activo.';
  end if;

  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.admin_set_app_user_active(
  p_user_id uuid,
  p_active boolean
)
returns public.user_profiles
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_profile public.user_profiles;
begin
  if not public.can_manage_users() then
    raise exception 'No tienes permiso para administrar usuarios.';
  end if;

  if p_user_id is null or p_active is null then
    raise exception 'Usuario y estado son obligatorios.';
  end if;

  if p_user_id = auth.uid() and not p_active then
    raise exception 'No puedes desactivar tu propia sesion.';
  end if;

  if not exists (select 1 from public.user_profiles where id = p_user_id) then
    raise exception 'El usuario no existe.';
  end if;

  update public.user_profiles
  set is_active = p_active,
      updated_at = now()
  where id = p_user_id
  returning * into v_profile;

  update auth.users
  set banned_until = case when p_active then null else now() + interval '100 years' end,
      updated_at = now()
  where id = p_user_id;

  return v_profile;
end;
$$;

grant execute on function public.current_user_role() to authenticated;
grant execute on function public.has_role(public.app_role) to authenticated;
grant execute on function public.current_data_owner_user_id() to authenticated;
grant execute on function public.can_access_owner_data(uuid) to authenticated;
grant execute on function public.current_user_screen_permissions() to authenticated;
grant execute on function public.admin_set_app_user_active(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
