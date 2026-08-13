-- Rentautos: habilita al operador para registrar pagos desde Ruta en calle.
-- Ejecutar despues de 57-active-route-zones.sql.

create or replace function public.default_screen_permissions(p_role public.app_role)
returns jsonb
language sql
stable
as $$
  select case p_role::text
    when 'admin' then
      '{
        "leads": {"view": true, "edit": true},
        "clients": {"view": true, "edit": true},
        "payments": {"view": true, "edit": true},
        "receivables": {"view": true, "edit": true},
        "route_search": {"view": true, "edit": true},
        "insurance_workflow": {"view": true, "edit": true},
        "collisions": {"view": true, "edit": true},
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
        "insurance_workflow": {"view": true, "edit": true},
        "collisions": {"view": true, "edit": true},
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
        "insurance_workflow": {"view": false, "edit": false},
        "collisions": {"view": false, "edit": false},
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
        "insurance_workflow": {"view": false, "edit": false},
        "collisions": {"view": false, "edit": false},
        "control_units": {"view": true, "edit": false},
        "settings": {"view": false, "edit": false},
        "users": {"view": false, "edit": false}
      }'::jsonb
  end;
$$;

-- Los perfiles de operador creados con la plantilla anterior conservaban
-- route_search=false como una sobreescritura explicita.
update public.user_profiles
set permissions = jsonb_set(
  coalesce(permissions, '{}'::jsonb),
  '{route_search}',
  '{"view": true, "edit": true}'::jsonb,
  true
)
where role = 'operador'::public.app_role;

-- El buscador debe poder ver los holds bancarios en Ruta en calle, pero no
-- crearlos, editarlos ni eliminarlos.
drop policy if exists "notified_payments_cloud_screen_read" on public.notified_payments_cloud;
drop policy if exists "notified_payments_cloud_operational_read" on public.notified_payments_cloud;
create policy "notified_payments_cloud_operational_read"
on public.notified_payments_cloud
for select
to authenticated
using (
  (select public.can_view_owner_screen(user_id, 'payments'))
  or (select public.can_view_owner_screen(user_id, 'route_search'))
);

grant execute on function public.default_screen_permissions(public.app_role) to authenticated;
