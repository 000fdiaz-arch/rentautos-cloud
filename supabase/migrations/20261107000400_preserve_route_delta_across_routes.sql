-- El Delta es responsable del carro, no de una sola ruta. Conservar la
-- asignación cuando Administración mueve el carro a CL, DARIEN, PENONOME, etc.
create or replace function public.assign_active_route_pty_delta()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_route text;
  v_current text;
  v_delta1_active boolean;
  v_delta2_active boolean;
  v_delta3_active boolean;
  v_delta1_count integer;
  v_delta3_count integer;
  v_delta text;
begin
  v_route := upper(btrim(regexp_replace(coalesce(new.data->>'routeAssignment', ''), '[[:space:]]+', ' ', 'g')));
  v_current := lower(btrim(coalesce(new.data->>'assignedDelta', '')));
  v_delta1_active := public.is_route_delta_active(new.user_id, 'delta1');
  v_delta2_active := public.is_route_delta_active(new.user_id, 'delta2');
  v_delta3_active := public.is_route_delta_active(new.user_id, 'delta3');

  if public.is_delta1_only_route_client_name(new.data->>'clientName') then
    if not v_delta1_active then
      new.data := new.data - 'assignedDelta' - 'assignedDeltaAt' - 'assignedDeltaBy' - 'assignedDeltaMode';
      return new;
    end if;
    if v_current = 'delta1' and new.data->>'assignedDeltaMode' = 'client-fixed' then
      return new;
    end if;
    new.data := jsonb_set(
      jsonb_set(
        jsonb_set(new.data - 'assignedDeltaBy', '{assignedDelta}', '"delta1"'::jsonb, true),
        '{assignedDeltaAt}', to_jsonb(clock_timestamp()), true
      ),
      '{assignedDeltaMode}', '"client-fixed"'::jsonb, true
    );
    return new;
  end if;

  -- Una asignación vigente sobrevive a cualquier cambio de ruta.
  if (v_current = 'delta1' and v_delta1_active)
    or (v_current = 'delta2' and v_delta2_active)
    or (v_current = 'delta3' and v_delta3_active)
  then
    return new;
  end if;

  -- Solo los carros nuevos o sin responsable reciben la regla inicial por ruta.
  if v_route = 'WC' then
    if not v_delta2_active then
      new.data := new.data - 'assignedDelta' - 'assignedDeltaAt' - 'assignedDeltaBy' - 'assignedDeltaMode';
      return new;
    end if;
    new.data := jsonb_set(
      jsonb_set(
        jsonb_set(new.data - 'assignedDeltaBy', '{assignedDelta}', '"delta2"'::jsonb, true),
        '{assignedDeltaAt}', to_jsonb(clock_timestamp()), true
      ),
      '{assignedDeltaMode}', '"route-default"'::jsonb, true
    );
    return new;
  elsif v_route <> 'PTY' then
    new.data := new.data - 'assignedDelta' - 'assignedDeltaAt' - 'assignedDeltaBy' - 'assignedDeltaMode';
    return new;
  end if;

  if not v_delta1_active and not v_delta3_active then
    new.data := new.data - 'assignedDelta' - 'assignedDeltaAt' - 'assignedDeltaBy' - 'assignedDeltaMode';
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text || ':route-pty-delta', 0));

  select
    count(*) filter (where lower(data->>'assignedDelta') = 'delta1'),
    count(*) filter (where lower(data->>'assignedDelta') = 'delta3')
  into v_delta1_count, v_delta3_count
  from public.active_route_items_cloud
  where user_id = new.user_id
    and client_id <> new.client_id
    and coalesce(data->>'removedAt', '') = '';

  v_delta := case
    when not v_delta1_active then 'delta3'
    when not v_delta3_active then 'delta1'
    when v_delta1_count < v_delta3_count then 'delta1'
    when v_delta3_count < v_delta1_count then 'delta3'
    when random() < 0.5 then 'delta1'
    else 'delta3'
  end;

  new.data := jsonb_set(
    jsonb_set(
      jsonb_set(new.data - 'assignedDeltaBy', '{assignedDelta}', to_jsonb(v_delta), true),
      '{assignedDeltaAt}', to_jsonb(clock_timestamp()), true
    ),
    '{assignedDeltaMode}', '"automatic"'::jsonb, true
  );
  return new;
end;
$$;

create or replace function public.change_active_route_delta_assignment(
  p_user_id uuid,
  p_client_id text,
  p_published_at text,
  p_previous_delta text,
  p_delta text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_previous_delta text;
  v_delta text;
  v_client_name text;
begin
  if coalesce(public.current_user_role()::text = 'buscador', false) then
    raise exception 'Los buscadores no pueden cambiar al responsable de búsqueda.';
  end if;
  if not coalesce(public.can_edit_owner_screen(p_user_id, 'route_search'), false) then
    raise exception 'Solo un editor de Ruta puede cambiar el buscador asignado.';
  end if;

  v_previous_delta := lower(btrim(coalesce(p_previous_delta, '')));
  v_delta := lower(btrim(coalesce(p_delta, '')));
  if v_delta not in ('delta1', 'delta2', 'delta3') then
    raise exception 'Selecciona Delta 1, Delta 2 o Delta 3.';
  end if;
  if not public.is_route_delta_active(p_user_id, v_delta) then
    raise exception '% está inactivo y no puede recibir carros.', initcap(replace(v_delta, 'delta', 'Delta '));
  end if;

  select data->>'clientName'
  into v_client_name
  from public.active_route_items_cloud
  where user_id = p_user_id
    and client_id = p_client_id
    and data->>'publishedAt' = p_published_at
    and coalesce(data->>'removedAt', '') = '';

  if not found then
    raise exception 'La unidad ya no está activa. Actualiza e intenta nuevamente.';
  end if;
  if v_delta <> 'delta1' and public.is_delta1_only_route_client_name(v_client_name) then
    raise exception '% debe permanecer asignado a Delta 1.', v_client_name;
  end if;

  update public.active_route_items_cloud
  set data = jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(data, '{assignedDelta}', to_jsonb(v_delta), true),
            '{assignedDeltaAt}', to_jsonb(clock_timestamp()), true
          ),
          '{assignedDeltaBy}', to_jsonb(auth.uid()), true
        ),
        '{assignedDeltaMode}', '"manual"'::jsonb, true
      ),
      updated_at = now()
  where user_id = p_user_id
    and client_id = p_client_id
    and data->>'publishedAt' = p_published_at
    and lower(btrim(coalesce(data->>'assignedDelta', ''))) = v_previous_delta
    and coalesce(data->>'removedAt', '') = '';

  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'La asignación cambió o la unidad ya no está activa. Actualiza e intenta nuevamente.';
  end if;
end;
$$;

-- Estas cuatro unidades son las señaladas por Administración como Delta 1.
update public.active_route_items_cloud
set data = jsonb_set(
      jsonb_set(
        jsonb_set(data, '{assignedDelta}', '"delta1"'::jsonb, true),
        '{assignedDeltaAt}', to_jsonb(clock_timestamp()), true
      ),
      '{assignedDeltaMode}', '"manual-restored"'::jsonb, true
    ),
    updated_at = now()
where upper(btrim(coalesce(data->>'unitId', ''))) in ('B91', 'T06', 'B12', 'A46')
  and upper(btrim(regexp_replace(coalesce(data->>'routeAssignment', ''), '[[:space:]]+', ' ', 'g'))) in ('CL', 'DARIEN BUGAN', 'PENONOME')
  and coalesce(data->>'removedAt', '') = '';

revoke all on function public.change_active_route_delta_assignment(uuid,text,text,text,text) from public, anon;
grant execute on function public.change_active_route_delta_assignment(uuid,text,text,text,text) to authenticated;

notify pgrst, 'reload schema';
