-- Rentautos: asignacion atomica de autos provisionales desde Clientes.

create unique index if not exists clients_cloud_active_provisional_unit_uq
on public.clients_cloud (user_id, upper(data #>> '{activeProvisionalRental,unitId}'))
where nullif(btrim(data #>> '{activeProvisionalRental,unitId}'), '') is not null;

create or replace function public.save_provisional_rental_state(
  p_owner_user_id uuid,
  p_client_id text,
  p_client_data jsonb,
  p_unit_id text,
  p_fleet_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_unit_id text := upper(btrim(coalesce(p_unit_id, '')));
  v_current_status text;
  v_previous_client jsonb;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesion.'; end if;
  if not public.can_edit_owner_screen(p_owner_user_id, 'clients') then
    raise exception 'No tienes permiso para editar Clientes.';
  end if;
  if v_unit_id = '' then raise exception 'La unidad provisional es obligatoria.'; end if;
  if p_fleet_status not in ('provisional_rental', 'libre') then
    raise exception 'Estado provisional no permitido.';
  end if;

  select data into v_previous_client from public.clients_cloud
  where user_id = p_owner_user_id and id = p_client_id for update;
  if v_previous_client is null then raise exception 'Cliente no encontrado.'; end if;

  select lower(coalesce(operational_status, 'libre')) into v_current_status
  from public.fleet_units_cloud
  where user_id = p_owner_user_id and upper(unit_id) = v_unit_id for update;
  if v_current_status is null then raise exception 'Auto provisional no encontrado.'; end if;

  if p_fleet_status = 'provisional_rental' then
    if v_current_status not in ('libre', 'provisional_rental') then
      raise exception 'El auto ya no esta libre.';
    end if;
    if upper(coalesce(p_client_data #>> '{activeProvisionalRental,unitId}', '')) <> v_unit_id then
      raise exception 'Los datos del alquiler no corresponden a la unidad seleccionada.';
    end if;
    if exists (
      select 1 from public.clients_cloud c
      where c.user_id = p_owner_user_id and c.id <> p_client_id
        and upper(coalesce(c.data #>> '{activeProvisionalRental,unitId}', '')) = v_unit_id
    ) then
      raise exception 'El auto provisional ya fue asignado a otro cliente.';
    end if;
  else
    if upper(coalesce(v_previous_client #>> '{activeProvisionalRental,unitId}', '')) <> v_unit_id then
      raise exception 'El cliente no tiene activa esa unidad provisional.';
    end if;
  end if;

  update public.clients_cloud set data = p_client_data, updated_at = now()
  where user_id = p_owner_user_id and id = p_client_id;
  update public.fleet_units_cloud set operational_status = p_fleet_status, updated_at = now()
  where user_id = p_owner_user_id and upper(unit_id) = v_unit_id;
  return p_client_data;
end;
$$;

grant execute on function public.save_provisional_rental_state(uuid, text, jsonb, text, text) to authenticated;
