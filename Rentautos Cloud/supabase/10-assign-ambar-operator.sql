-- Rentautos: asignar AMBAR con acceso completo (admin).
-- Ejecutar en Supabase SQL Editor despues de 01, 07, 08 y 09.

do $$
declare
  v_admin_id uuid;
  v_operator_id uuid;
begin
  select id
  into v_admin_id
  from public.user_profiles
  where email = '000f.diaz@gmail.com'
  limit 1;

  if v_admin_id is null then
    raise exception 'No se encontro el admin 000f.diaz@gmail.com en public.user_profiles.';
  end if;

  select id
  into v_operator_id
  from public.user_profiles
  where email = 'ambaryragorri@gmail.com'
  limit 1;

  if v_operator_id is null then
    raise exception 'No se encontro ambaryragorri@gmail.com en public.user_profiles. Debe iniciar sesion al menos una vez.';
  end if;

  update public.user_profiles
  set
    role = 'admin',
    data_owner_user_id = null,
    updated_at = now()
  where id = v_operator_id;
end
$$;

-- Validacion sugerida:
-- select email, role, data_owner_user_id
-- from public.user_profiles
-- where email in ('000f.diaz@gmail.com', 'ambaryragorri@gmail.com');
