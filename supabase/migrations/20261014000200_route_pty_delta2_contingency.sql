-- Habilita Delta 2 como responsable manual de carros PTY sin alterar el reparto
-- automatico existente entre Delta 1 y Delta 3 ni la asignacion de rutas.
create or replace function public.assign_active_route_pty_delta()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_route text;
  v_current text;
  v_delta1_count integer;
  v_delta3_count integer;
  v_delta text;
begin
  v_route := upper(btrim(regexp_replace(coalesce(new.data->>'routeAssignment', ''), '[[:space:]]+', ' ', 'g')));

  if v_route <> 'PTY' then
    new.data := new.data - 'assignedDelta' - 'assignedDeltaAt' - 'assignedDeltaBy' - 'assignedDeltaMode';
    return new;
  end if;

  v_current := lower(btrim(coalesce(new.data->>'assignedDelta', '')));
  if v_current in ('delta1', 'delta2', 'delta3') then
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
    and upper(btrim(regexp_replace(coalesce(data->>'routeAssignment', ''), '[[:space:]]+', ' ', 'g'))) = 'PTY'
    and coalesce(data->>'removedAt', '') = '';

  v_delta := case
    when v_delta1_count < v_delta3_count then 'delta1'
    when v_delta3_count < v_delta1_count then 'delta3'
    when random() < 0.5 then 'delta1'
    else 'delta3'
  end;

  new.data := jsonb_set(
    jsonb_set(
      jsonb_set(new.data, '{assignedDelta}', to_jsonb(v_delta), true),
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
begin
  if not coalesce(public.can_edit_owner_screen(p_user_id, 'route_search'), false) then
    raise exception 'Solo un editor de Ruta puede cambiar el buscador asignado.';
  end if;

  v_previous_delta := lower(btrim(coalesce(p_previous_delta, '')));
  v_delta := lower(btrim(coalesce(p_delta, '')));
  if v_delta not in ('delta1', 'delta2', 'delta3') then
    raise exception 'Selecciona Delta 1, Delta 2 o Delta 3.';
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
    and upper(btrim(regexp_replace(coalesce(data->>'routeAssignment', ''), '[[:space:]]+', ' ', 'g'))) = 'PTY'
    and coalesce(data->>'removedAt', '') = '';

  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'La asignacion cambio o la unidad ya no esta activa en PTY. Actualiza e intenta nuevamente.';
  end if;
end;
$$;

revoke all on function public.change_active_route_delta_assignment(uuid,text,text,text,text) from public, anon;
grant execute on function public.change_active_route_delta_assignment(uuid,text,text,text,text) to authenticated;

notify pgrst, 'reload schema';
