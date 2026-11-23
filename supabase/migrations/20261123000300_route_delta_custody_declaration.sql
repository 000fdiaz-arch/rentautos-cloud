-- Declaración de custodia por el Delta asignado, con atribución y revisión administrativa.
create or replace function public.set_active_route_custody(
  p_user_id uuid, p_client_id text, p_published_at text,
  p_in_custody boolean, p_expected_in_custody boolean
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_item public.active_route_items_cloud;
  v_capture_id uuid;
  v_run_id uuid;
  v_reporter_name text;
  v_role text;
  v_delta text;
  v_now timestamptz := clock_timestamp();
begin
  if not coalesce(public.can_report_route_payment(p_user_id), false) then
    raise exception 'No tienes permiso para cambiar la custodia.';
  end if;
  if p_in_custody is null or p_expected_in_custody is null or p_in_custody = p_expected_in_custody then
    raise exception 'Indica un cambio de custodia válido.';
  end if;

  select * into v_item
  from public.active_route_items_cloud
  where user_id = p_user_id and client_id = p_client_id
  for update;

  if not found or v_item.data->>'publishedAt' is distinct from p_published_at
    or v_item.in_custody is distinct from p_expected_in_custody
    or (p_in_custody and coalesce(v_item.data->>'removedAt','') <> '') then
    raise exception 'La unidad cambió o ya no está activa. Actualiza la ruta.';
  end if;

  select coalesce(nullif(email,''),auth.uid()::text),role::text,lower(split_part(btrim(email),'@',1))
  into v_reporter_name,v_role,v_delta from public.user_profiles
  where id=auth.uid() and is_active and coalesce(data_owner_user_id,id)=p_user_id;
  if not found then raise exception 'No tienes permiso para cambiar la custodia.'; end if;
  if v_role='buscador' then
    if v_delta is null or v_delta not in ('delta1','delta2','delta3')
      or coalesce(v_item.data->>'assignedDelta','')<>v_delta then
      raise exception 'Solo puedes declarar en custodia las unidades asignadas a tu Delta.';
    end if;
    if not p_in_custody then raise exception 'Solo Administración puede sacar el auto de custodia.'; end if;
  elsif not coalesce(public.can_edit_owner_screen(p_user_id,'route_search'),false) then
    raise exception 'No tienes permiso para cambiar la custodia.';
  end if;

  if p_in_custody then
    -- El recorrido pertenece al Delta. Cada captación conserva la ruta del auto,
    -- incluso cuando hay unidades del mismo Delta en varias rutas.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('route-custody:legacy:'||p_user_id::text||':'||auth.uid()::text,0));
    select run.id into v_run_id from public.route_runs run
    where run.user_id=p_user_id and run.operator_id=auth.uid() and run.status='in_progress'
    order by run.started_at desc limit 1;
    if v_role='buscador' and v_run_id is null then
      insert into public.route_runs(user_id,route_assignment,operator_id,operator_name)
      values(p_user_id,coalesce(v_item.data->>'routeAssignment',''),auth.uid(),v_reporter_name)
      returning id into v_run_id;
    end if;

    v_capture_id := gen_random_uuid();

    insert into public.route_capture_events(
      id, user_id, client_id, unit_id, client_name, published_at,
      route_assignment, route_run_id, reported_by, reporter_name, reported_at
    ) values (
      v_capture_id,
      p_user_id,
      p_client_id,
      coalesce(v_item.data->>'unitId', ''),
      coalesce(v_item.data->>'clientName', ''),
      p_published_at,
      coalesce(v_item.data->>'routeAssignment', ''),
      v_run_id,
      auth.uid(),
      v_reporter_name,
      v_now
    );
  end if;

  update public.active_route_items_cloud
  set in_custody = p_in_custody,
      custody_since = case when p_in_custody then v_now else null end,
      custody_changed_at = v_now,
      custody_changed_by = auth.uid(),
      updated_at = v_now,
      custody_history = custody_history || jsonb_build_array(
        jsonb_strip_nulls(jsonb_build_object(
          'inCustody', p_in_custody,
          'at', v_now,
          'by', auth.uid(),
          'unitId', data->>'unitId',
          'publishedAt', data->>'publishedAt',
          'routeAssignment', data->>'routeAssignment',
          'captureEventId', v_capture_id
        ))
      )
  where user_id = p_user_id and client_id = p_client_id;
end;
$$;

revoke all on function public.set_active_route_custody(uuid,text,text,boolean,boolean) from public, anon;
grant execute on function public.set_active_route_custody(uuid,text,text,boolean,boolean) to authenticated;


do $migration$
begin
  if to_regclass('public.cxc_v2_active_route_items_cloud') is not null then
    execute $ddl$
create or replace function public.cxc_v2_set_active_route_custody(
  p_user_id uuid, p_client_id text, p_published_at text,
  p_in_custody boolean, p_expected_in_custody boolean
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_item public.cxc_v2_active_route_items_cloud;
  v_capture_id uuid;
  v_run_id uuid;
  v_reporter_name text;
  v_role text;
  v_delta text;
  v_now timestamptz := clock_timestamp();
begin
  if not coalesce(public.can_report_route_payment(p_user_id), false) then
    raise exception 'No tienes permiso para cambiar la custodia.';
  end if;
  if p_in_custody is null or p_expected_in_custody is null or p_in_custody = p_expected_in_custody then
    raise exception 'Indica un cambio de custodia válido.';
  end if;

  select * into v_item
  from public.cxc_v2_active_route_items_cloud
  where user_id = p_user_id and client_id = p_client_id
  for update;

  if not found or v_item.data->>'publishedAt' is distinct from p_published_at
    or v_item.in_custody is distinct from p_expected_in_custody
    or (p_in_custody and coalesce(v_item.data->>'removedAt','') <> '') then
    raise exception 'La unidad cambió o ya no está activa. Actualiza la ruta.';
  end if;

  select coalesce(nullif(email,''),auth.uid()::text),role::text,lower(split_part(btrim(email),'@',1))
  into v_reporter_name,v_role,v_delta from public.user_profiles
  where id=auth.uid() and is_active and coalesce(data_owner_user_id,id)=p_user_id;
  if not found then raise exception 'No tienes permiso para cambiar la custodia.'; end if;
  if v_role='buscador' then
    if v_delta is null or v_delta not in ('delta1','delta2','delta3')
      or coalesce(v_item.data->>'assignedDelta','')<>v_delta then
      raise exception 'Solo puedes declarar en custodia las unidades asignadas a tu Delta.';
    end if;
    if not p_in_custody then raise exception 'Solo Administración puede sacar el auto de custodia.'; end if;
  elsif not coalesce(public.can_edit_owner_screen(p_user_id,'route_search'),false) then
    raise exception 'No tienes permiso para cambiar la custodia.';
  end if;

  if p_in_custody then
    -- El recorrido pertenece al Delta. Cada captación conserva la ruta del auto,
    -- incluso cuando hay unidades del mismo Delta en varias rutas.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('route-custody:v2:'||p_user_id::text||':'||auth.uid()::text,0));
    select run.id into v_run_id from public.cxc_v2_route_runs run
    where run.user_id=p_user_id and run.operator_id=auth.uid() and run.status='in_progress'
    order by run.started_at desc limit 1;
    if v_role='buscador' and v_run_id is null then
      insert into public.cxc_v2_route_runs(user_id,route_assignment,operator_id,operator_name)
      values(p_user_id,coalesce(v_item.data->>'routeAssignment',''),auth.uid(),v_reporter_name)
      returning id into v_run_id;
    end if;

    v_capture_id := gen_random_uuid();

    insert into public.cxc_v2_route_capture_events(
      id, user_id, client_id, unit_id, client_name, published_at,
      route_assignment, route_run_id, reported_by, reporter_name, reported_at
    ) values (
      v_capture_id,
      p_user_id,
      p_client_id,
      coalesce(v_item.data->>'unitId', ''),
      coalesce(v_item.data->>'clientName', ''),
      p_published_at,
      coalesce(v_item.data->>'routeAssignment', ''),
      v_run_id,
      auth.uid(),
      v_reporter_name,
      v_now
    );
  end if;

  update public.cxc_v2_active_route_items_cloud
  set in_custody = p_in_custody,
      custody_since = case when p_in_custody then v_now else null end,
      custody_changed_at = v_now,
      custody_changed_by = auth.uid(),
      updated_at = v_now,
      custody_history = custody_history || jsonb_build_array(
        jsonb_strip_nulls(jsonb_build_object(
          'inCustody', p_in_custody,
          'at', v_now,
          'by', auth.uid(),
          'unitId', data->>'unitId',
          'publishedAt', data->>'publishedAt',
          'routeAssignment', data->>'routeAssignment',
          'captureEventId', v_capture_id
        ))
      )
  where user_id = p_user_id and client_id = p_client_id;
end;
$$;

revoke all on function public.cxc_v2_set_active_route_custody(uuid,text,text,boolean,boolean) from public, anon;
grant execute on function public.cxc_v2_set_active_route_custody(uuid,text,text,boolean,boolean) to authenticated;

    $ddl$;
  end if;
end;
$migration$;

notify pgrst,'reload schema';
