-- Admin users must keep full screen permissions even if user_profiles.permissions
-- contains stale or restrictive overrides.

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
  where up.id = auth.uid();
$$;

create or replace function public.can_manage_users()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin();
$$;

grant execute on function public.current_user_screen_permissions() to authenticated;
grant execute on function public.can_manage_users() to authenticated;
