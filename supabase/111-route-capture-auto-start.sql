-- Inicia automáticamente el recorrido del Delta con su primera captación.
-- Esto mantiene compatibles las pantallas abiertas antes del despliegue del control de rutas.

create or replace function public.set_active_route_custody(
  p_user_id uuid, p_client_id text, p_published_at text,
  p_in_custody boolean, p_expected_in_custody boolean
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_item public.active_route_items_cloud;
  v_capture_id uuid;
  v_run_id uuid;
  v_reporter_name text;
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

  if p_in_custody then
    select coalesce(nullif(email, ''), auth.uid()::text)
    into v_reporter_name
    from public.user_profiles
    where id = auth.uid();

    v_reporter_name := coalesce(v_reporter_name, auth.uid()::text);
    select run.id into v_run_id
    from public.route_runs run
    where run.user_id = p_user_id
      and run.operator_id = auth.uid()
      and run.status = 'in_progress'
      and upper(btrim(run.route_assignment)) = upper(btrim(coalesce(v_item.data->>'routeAssignment', '')))
    order by run.started_at desc
    limit 1;

    if lower(v_reporter_name) ~ '^delta[0-9]+@auth\.rentautos\.local$' and v_run_id is null then
      v_run_id := public.start_route_run(
        p_user_id,
        coalesce(v_item.data->>'routeAssignment', '')
      );
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

notify pgrst, 'reload schema';
