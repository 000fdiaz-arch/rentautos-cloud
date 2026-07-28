-- Rentautos: permisos correctos para Cuentas por cobrar.
-- Ejecutar despues de 20-screen-permissions.sql.

create or replace function public.default_screen_permissions(p_role public.app_role)
returns jsonb
language sql
stable
as $$
  select case p_role
    when 'admin'::public.app_role then
      '{
        "leads": {"view": true, "edit": true},
        "clients": {"view": true, "edit": true},
        "payments": {"view": true, "edit": true},
        "receivables": {"view": true, "edit": true},
        "control_units": {"view": true, "edit": true},
        "settings": {"view": true, "edit": true},
        "users": {"view": true, "edit": true}
      }'::jsonb
    when 'operador'::public.app_role then
      '{
        "leads": {"view": true, "edit": true},
        "clients": {"view": true, "edit": true},
        "payments": {"view": true, "edit": true},
        "receivables": {"view": true, "edit": true},
        "control_units": {"view": true, "edit": true},
        "settings": {"view": false, "edit": false},
        "users": {"view": false, "edit": false}
      }'::jsonb
    else
      '{
        "leads": {"view": false, "edit": false},
        "clients": {"view": false, "edit": false},
        "payments": {"view": false, "edit": false},
        "receivables": {"view": false, "edit": false},
        "control_units": {"view": true, "edit": false},
        "settings": {"view": false, "edit": false},
        "users": {"view": false, "edit": false}
      }'::jsonb
  end;
$$;

do $$
declare
  table_name text;
  policy_record record;
begin
  foreach table_name in array array[
    'street_management_cloud',
    'collection_closures_cloud'
  ] loop
    if to_regclass(format('public.%I', table_name)) is null then
      continue;
    end if;

    for policy_record in
      select policyname
      from pg_policies
      where schemaname = 'public'
        and tablename = table_name
    loop
      execute format('drop policy if exists %I on public.%I', policy_record.policyname, table_name);
    end loop;

    execute format(
      'create policy %I on public.%I for select to authenticated using ((select public.can_view_owner_screen(user_id, %L)))',
      table_name || '_receivables_read',
      table_name,
      'receivables'
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check ((select public.can_edit_owner_screen(user_id, %L)))',
      table_name || '_receivables_insert',
      table_name,
      'receivables'
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using ((select public.can_edit_owner_screen(user_id, %L))) with check ((select public.can_edit_owner_screen(user_id, %L)))',
      table_name || '_receivables_update',
      table_name,
      'receivables',
      'receivables'
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using ((select public.can_edit_owner_screen(user_id, %L)))',
      table_name || '_receivables_delete',
      table_name,
      'receivables'
    );
  end loop;
end $$;

grant execute on function public.default_screen_permissions(public.app_role) to authenticated;
