-- Unifica los permisos judiciales y de seguros bajo una sola pantalla.
-- Conserva acceso si el usuario tenia cualquiera de los permisos anteriores.

create or replace function public.default_screen_permissions(p_role public.app_role)
returns jsonb
language sql
stable
as $$
  select case p_role::text
    when 'admin' then
      '{A
        "leads": {"view": true, "edit": true},
        "clients": {"view": true, "edit": true},
        "payments": {"view": true, "edit": true},
        "receivables": {"view": true, "edit": true},
        "route_search": {"view": true, "edit": true},
        "incidents": {"view": true, "edit": true},
        "control_units": {"view": true, "edit": true},
        "settings": {"view": true, "edit": true},
        "users": {"view": true, "edit": true}
      }'::jsonb
    when 'operador' then
      '{
        "leads": {"view": true, "edit": true},
        "clients": {"view": true, "edit": true},
        "payments": {"view": true, "edit": true},
        "receivables": {"view": true, "edit": true},
        "route_search": {"view": true, "edit": true},
        "incidents": {"view": true, "edit": true},
        "control_units": {"view": true, "edit": true},
        "settings": {"view": false, "edit": false},
        "users": {"view": false, "edit": false}
      }'::jsonb
    when 'buscador' then
      '{
        "leads": {"view": false, "edit": false},
        "clients": {"view": false, "edit": false},
        "payments": {"view": false, "edit": false},
        "receivables": {"view": false, "edit": false},
        "route_search": {"view": true, "edit": false},
        "incidents": {"view": false, "edit": false},
        "control_units": {"view": false, "edit": false},
        "settings": {"view": false, "edit": false},
        "users": {"view": false, "edit": false}
      }'::jsonb
    else
      '{
        "leads": {"view": false, "edit": false},
        "clients": {"view": false, "edit": false},
        "payments": {"view": false, "edit": false},
        "receivables": {"view": false, "edit": false},
        "route_search": {"view": false, "edit": false},
        "incidents": {"view": false, "edit": false},
        "control_units": {"view": true, "edit": false},
        "settings": {"view": false, "edit": false},
        "users": {"view": false, "edit": false}
      }'::jsonb
  end;
$$;

update public.user_profiles
set permissions = (
  coalesce(permissions, '{}'::jsonb) - 'collisions' - 'insurance_workflow'
) || jsonb_build_object(
  'incidents',
  jsonb_build_object(
    'view',
      coalesce((permissions #>> '{incidents,view}')::boolean, false)
      or coalesce((permissions #>> '{collisions,view}')::boolean, false)
      or coalesce((permissions #>> '{insurance_workflow,view}')::boolean, false),
    'edit',
      coalesce((permissions #>> '{incidents,edit}')::boolean, false)
      or coalesce((permissions #>> '{collisions,edit}')::boolean, false)
      or coalesce((permissions #>> '{insurance_workflow,edit}')::boolean, false)
  )
);

create or replace function public.current_user_can_view_screen(p_screen text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    public.current_user_screen_permissions()
      -> case when p_screen in ('collisions', 'insurance_workflow') then 'incidents' else p_screen end
      ->> 'view'
  )::boolean, false);
$$;

create or replace function public.current_user_can_edit_screen(p_screen text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_can_view_screen(p_screen)
    and coalesce((
      public.current_user_screen_permissions()
        -> case when p_screen in ('collisions', 'insurance_workflow') then 'incidents' else p_screen end
        ->> 'edit'
    )::boolean, false);
$$;

grant execute on function public.default_screen_permissions(public.app_role) to authenticated;
grant execute on function public.current_user_can_view_screen(text) to authenticated;
grant execute on function public.current_user_can_edit_screen(text) to authenticated;
