-- Al cambiar entre las rutas operativas estándar, el Delta sigue la ruta:
-- WC corresponde a Delta 2 y PTY corresponde a Delta 1. La reasignación
-- manual sigue disponible y se conserva mientras la ruta no vuelva a cambiar.
create or replace function public.assign_active_route_pty_delta()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_route text;
  v_previous_route text;
  v_current text;
  v_default_delta text;
  v_route_changed boolean := true;
begin
  v_route := upper(btrim(regexp_replace(coalesce(new.data->>'routeAssignment', ''), '[[:space:]]+', ' ', 'g')));
  v_current := lower(btrim(coalesce(new.data->>'assignedDelta', '')));

  if tg_op = 'UPDATE' then
    v_previous_route := upper(btrim(regexp_replace(coalesce(old.data->>'routeAssignment', ''), '[[:space:]]+', ' ', 'g')));
    v_route_changed := v_route is distinct from v_previous_route;
  end if;

  v_default_delta := case
    when v_route = 'WC' then 'delta2'
    when v_route = 'PTY' then 'delta1'
    else null
  end;

  -- La acción más reciente manda: cambiar la ruta estándar aplica su Delta.
  -- Una edición manual posterior no cambia la ruta y pasa por la rama siguiente.
  if v_route_changed and v_default_delta is not null then
    if not public.is_route_delta_active(new.user_id, v_default_delta) then
      new.data := new.data - 'assignedDelta' - 'assignedDeltaAt' - 'assignedDeltaBy' - 'assignedDeltaMode';
      return new;
    end if;

    new.data := jsonb_set(
      jsonb_set(
        jsonb_set(new.data - 'assignedDeltaBy', '{assignedDelta}', to_jsonb(v_default_delta), true),
        '{assignedDeltaAt}', to_jsonb(clock_timestamp()), true
      ),
      '{assignedDeltaMode}', '"route-default"'::jsonb, true
    );
    return new;
  end if;

  -- Con la misma ruta, una asignación válida (incluida la manual) se conserva.
  if (v_current = 'delta1' and public.is_route_delta_active(new.user_id, 'delta1'))
    or (v_current = 'delta2' and public.is_route_delta_active(new.user_id, 'delta2'))
    or (v_current = 'delta3' and public.is_route_delta_active(new.user_id, 'delta3'))
  then
    return new;
  end if;

  if v_default_delta is null or not public.is_route_delta_active(new.user_id, v_default_delta) then
    new.data := new.data - 'assignedDelta' - 'assignedDeltaAt' - 'assignedDeltaBy' - 'assignedDeltaMode';
    return new;
  end if;

  new.data := jsonb_set(
    jsonb_set(
      jsonb_set(new.data - 'assignedDeltaBy', '{assignedDelta}', to_jsonb(v_default_delta), true),
      '{assignedDeltaAt}', to_jsonb(clock_timestamp()), true
    ),
    '{assignedDeltaMode}', '"route-default"'::jsonb, true
  );
  return new;
end;
$$;

-- Corrige carros existentes que aún conservan una asignación automática de
-- la ruta anterior. Las excepciones creadas manualmente no se modifican.
update public.active_route_items_cloud
set data = jsonb_set(
      jsonb_set(
        jsonb_set(
          data - 'assignedDeltaBy',
          '{assignedDelta}',
          to_jsonb(case
            when upper(btrim(regexp_replace(coalesce(data->>'routeAssignment', ''), '[[:space:]]+', ' ', 'g'))) = 'WC' then 'delta2'
            else 'delta1'
          end),
          true
        ),
        '{assignedDeltaAt}', to_jsonb(clock_timestamp()), true
      ),
      '{assignedDeltaMode}', '"route-default"'::jsonb, true
    ),
    updated_at = now()
where coalesce(data->>'removedAt', '') = ''
  and upper(btrim(regexp_replace(coalesce(data->>'routeAssignment', ''), '[[:space:]]+', ' ', 'g'))) in ('WC', 'PTY')
  and coalesce(data->>'assignedDeltaMode', '') not in ('manual', 'manual-restored', 'client-fixed')
  and public.is_route_delta_active(
    user_id,
    case
      when upper(btrim(regexp_replace(coalesce(data->>'routeAssignment', ''), '[[:space:]]+', ' ', 'g'))) = 'WC' then 'delta2'
      else 'delta1'
    end
  )
  and lower(btrim(coalesce(data->>'assignedDelta', ''))) is distinct from case
    when upper(btrim(regexp_replace(coalesce(data->>'routeAssignment', ''), '[[:space:]]+', ' ', 'g'))) = 'WC' then 'delta2'
    else 'delta1'
  end;

notify pgrst, 'reload schema';
