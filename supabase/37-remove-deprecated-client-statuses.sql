-- Rentautos: retirar estados cliente_enfermo y en_busqueda.
-- Ejecutar despues de 36-receivables-realtime-publication.sql.

update public.clients_cloud
set data = jsonb_set(data, '{status}', to_jsonb('activo'::text), true),
    updated_at = now()
where lower(coalesce(data->>'status', '')) in ('cliente_enfermo', 'en_busqueda');

update public.fleet_units_cloud
set operational_status = 'activo',
    updated_at = now()
where lower(coalesce(operational_status, '')) in ('cliente_enfermo', 'en_busqueda');

create or replace function public.set_fleet_unit_status(
  p_owner_user_id uuid,
  p_unit_id text,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unit_id text := upper(trim(coalesce(p_unit_id, '')));
  v_status text := lower(trim(coalesce(p_status, '')));
  v_now timestamptz := now();
  v_archived_client_ids text[] := array[]::text[];
  v_updated_client_ids text[] := array[]::text[];
  v_comment text;
begin
  if not public.can_edit_owner_screen(p_owner_user_id, 'control_units') then
    raise exception 'No autorizado para cambiar estado de autos de este owner';
  end if;

  if v_unit_id = '' then
    raise exception 'Unidad requerida';
  end if;

  if v_status not in (
    'libre',
    'activo',
    'taller',
    'chapisteria',
    'custodia',
    'archivado'
  ) then
    raise exception 'Estado de auto invalido: %', v_status;
  end if;

  if not exists (
    select 1
    from public.fleet_units_cloud
    where user_id = p_owner_user_id
      and unit_id = v_unit_id
  ) then
    raise exception 'Unidad % no encontrada', v_unit_id;
  end if;

  update public.fleet_units_cloud
  set operational_status = v_status,
      updated_at = v_now
  where user_id = p_owner_user_id
    and unit_id = v_unit_id;

  if v_status in ('libre', 'archivado') then
    v_comment := format(
      'Archivado automaticamente al cambiar la unidad %s a %s desde Autos el %s',
      v_unit_id,
      upper(v_status),
      to_char(v_now at time zone 'America/Panama', 'YYYY-MM-DD')
    );

    with updated as (
      update public.clients_cloud
      set data = jsonb_set(
            jsonb_set(
              jsonb_set(data, '{status}', to_jsonb('archivado'::text), true),
              '{archivedAt}', to_jsonb(v_now::text), true
            ),
            '{statusComment}', to_jsonb(v_comment), true
          ),
          updated_at = v_now
      where user_id = p_owner_user_id
        and upper(trim(coalesce(data->>'unitId', ''))) = v_unit_id
        and lower(coalesce(data->>'status', 'activo')) <> 'archivado'
      returning id
    )
    select coalesce(array_agg(id), array[]::text[])
      into v_archived_client_ids
    from updated;
  elsif v_status = 'activo' then
    with updated as (
      update public.clients_cloud
      set data = jsonb_set(data - 'archivedAt' - 'statusComment', '{status}', to_jsonb('activo'::text), true),
          updated_at = v_now
      where user_id = p_owner_user_id
        and upper(trim(coalesce(data->>'unitId', ''))) = v_unit_id
        and lower(coalesce(data->>'status', 'activo')) <> 'archivado'
      returning id
    )
    select coalesce(array_agg(id), array[]::text[])
      into v_updated_client_ids
    from updated;
  else
    v_comment := format(
      'Estado actualizado automaticamente desde Autos para unidad %s el %s',
      v_unit_id,
      to_char(v_now at time zone 'America/Panama', 'YYYY-MM-DD')
    );

    with updated as (
      update public.clients_cloud
      set data = jsonb_set(
            jsonb_set(data, '{status}', to_jsonb(v_status), true),
            '{statusComment}', to_jsonb(v_comment), true
          ),
          updated_at = v_now
      where user_id = p_owner_user_id
        and upper(trim(coalesce(data->>'unitId', ''))) = v_unit_id
        and lower(coalesce(data->>'status', 'activo')) <> 'archivado'
      returning id
    )
    select coalesce(array_agg(id), array[]::text[])
      into v_updated_client_ids
    from updated;
  end if;

  return jsonb_build_object(
    'unit_id', v_unit_id,
    'status', v_status,
    'archived_client_ids', coalesce(to_jsonb(v_archived_client_ids), '[]'::jsonb),
    'updated_client_ids', coalesce(to_jsonb(v_updated_client_ids), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.set_fleet_unit_status(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
