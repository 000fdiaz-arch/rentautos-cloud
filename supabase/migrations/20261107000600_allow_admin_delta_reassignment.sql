-- Administración puede reasignar cualquier carro activo a cualquier Delta.
-- Esta función se conserva como compatibilidad para los triggers y RPC ya
-- instalados, pero deja de declarar clientes fijos en Delta 1.
create or replace function public.is_delta1_only_route_client_name(p_name text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select false;
$$;

-- La ruta define únicamente la asignación inicial: WC comienza en Delta 2 y
-- PTY comienza en Delta 1. Una asignación manual válida se conserva, lo que
-- permite que Delta 2 atienda un carro puntual de PTY sin cambiar toda la ruta.
create or replace function public.assign_active_route_pty_delta()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_route text;
  v_current text;
  v_default_delta text;
begin
  v_route := upper(btrim(regexp_replace(coalesce(new.data->>'routeAssignment', ''), '[[:space:]]+', ' ', 'g')));
  v_current := lower(btrim(coalesce(new.data->>'assignedDelta', '')));

  -- Una asignación manual o previa sigue perteneciendo al carro, incluso si
  -- es una excepción como Delta 2 cobrando una unidad de PTY.
  if (v_current = 'delta1' and public.is_route_delta_active(new.user_id, 'delta1'))
    or (v_current = 'delta2' and public.is_route_delta_active(new.user_id, 'delta2'))
    or (v_current = 'delta3' and public.is_route_delta_active(new.user_id, 'delta3'))
  then
    return new;
  end if;

  v_default_delta := case
    when v_route = 'WC' then 'delta2'
    when v_route = 'PTY' then 'delta1'
    else null
  end;

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

-- Las asignaciones existentes permanecen en Delta 1 hasta que Administración
-- decida moverlas; únicamente se elimina la marca que las hacía inamovibles.
update public.active_route_items_cloud
set data = jsonb_set(data, '{assignedDeltaMode}', '"manual"'::jsonb, true),
    updated_at = now()
where data->>'assignedDeltaMode' = 'client-fixed';

notify pgrst, 'reload schema';
