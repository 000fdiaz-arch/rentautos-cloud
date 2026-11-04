-- Los reclamos de seguro conservan su vínculo histórico con la unidad, pero no
-- impiden retirar de la flota un auto vendido. Los vínculos operativos que sí
-- requieren atención (cliente, ruta, promesa o expediente de colisión) siguen
-- bloqueando la baja.
create or replace function public.retire_fleet_unit(
  p_owner_user_id uuid,
  p_fleet_id uuid,
  p_reason text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unit public.fleet_units_cloud%rowtype;
  v_unit_id text;
  v_impact jsonb;
  v_last_client_id text;
  v_last_client_name text;
  v_actor_email text;
begin
  if not public.can_edit_owner_screen(p_owner_user_id, 'control_units') then
    raise exception 'No autorizado para dar de baja autos';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'El motivo de baja es obligatorio'; end if;

  select * into v_unit
  from public.fleet_units_cloud
  where user_id = p_owner_user_id and fleet_id = p_fleet_id
  for update;
  if not found then raise exception 'Auto no encontrado'; end if;
  if v_unit.retired_at is not null then raise exception 'El auto ya fue dado de baja'; end if;
  v_unit_id := upper(btrim(v_unit.unit_id));
  v_impact := public.preview_fleet_unit_lifecycle(p_owner_user_id, p_fleet_id, null);

  if coalesce((v_impact->>'activeClients')::integer, 0) > 0 then
    raise exception 'No se puede dar de baja: la unidad tiene cliente o alquiler provisional activo';
  end if;
  if coalesce((v_impact->>'activeRoutes')::integer, 0) > 0 then
    raise exception 'No se puede dar de baja: la unidad esta publicada en una ruta activa';
  end if;
  if coalesce((v_impact->>'pendingPromises')::integer, 0) > 0 then
    raise exception 'No se puede dar de baja: la unidad tiene promesas de pago pendientes';
  end if;
  if coalesce((v_impact->>'openCollisionCases')::integer, 0) > 0 then
    raise exception 'No se puede dar de baja: la unidad tiene expedientes de colision abiertos';
  end if;

  select c.id, c.data->>'name'
  into v_last_client_id, v_last_client_name
  from public.clients_cloud c
  where c.user_id = p_owner_user_id
    and upper(btrim(coalesce(c.data->>'unitId', ''))) = v_unit_id
  order by c.updated_at desc
  limit 1;
  select email into v_actor_email from public.user_profiles where id = auth.uid();

  update public.fleet_units_cloud
  set retired_at = now(), retired_reason = btrim(p_reason),
      retired_note = nullif(btrim(coalesce(p_note, '')), ''), retired_by = auth.uid(), retired_by_email = v_actor_email,
      retired_client_id = v_last_client_id, retired_client_name = v_last_client_name,
      operational_status = 'archivado', updated_at = now()
  where fleet_id = p_fleet_id;

  insert into public.fleet_unit_events_cloud (
    user_id, fleet_id, event_type, previous_unit_id, reason, note, vehicle_snapshot, performed_by, performed_by_email
  ) values (
    p_owner_user_id, p_fleet_id, 'retired', v_unit_id, btrim(p_reason), nullif(btrim(coalesce(p_note, '')), ''), to_jsonb(v_unit), auth.uid(), v_actor_email
  );

  return jsonb_build_object('fleetId', p_fleet_id, 'unitId', v_unit_id, 'retired', true);
end;
$$;

revoke all on function public.retire_fleet_unit(uuid, uuid, text, text) from public;
grant execute on function public.retire_fleet_unit(uuid, uuid, text, text) to authenticated;
