-- Control auditable de captaciones por Delta y confirmacion administrativa.
create table if not exists public.route_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  route_assignment text not null,
  operator_id uuid not null references auth.users(id) on delete cascade,
  operator_name text not null,
  started_at timestamptz not null default clock_timestamp(),
  submitted_at timestamptz,
  status text not null default 'in_progress' check (status in ('in_progress', 'pending', 'confirmed')),
  confirmed_by uuid references auth.users(id) on delete set null,
  confirmed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  constraint route_run_confirmation_consistent check (
    (status <> 'confirmed' and confirmed_by is null and confirmed_at is null)
    or (status = 'confirmed' and confirmed_by is not null and confirmed_at is not null)
  )
);

create unique index if not exists route_runs_operator_active_unique
  on public.route_runs(user_id, operator_id)
  where status = 'in_progress';
create index if not exists route_runs_owner_status_idx
  on public.route_runs(user_id, status, started_at desc);

alter table public.route_runs enable row level security;
drop policy if exists route_runs_read on public.route_runs;
create policy route_runs_read
on public.route_runs
for select
to authenticated
using (public.can_view_owner_screen(user_id, 'route_search'));
revoke all on public.route_runs from public, anon, authenticated;
grant select on public.route_runs to authenticated;

create table if not exists public.route_capture_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null,
  unit_id text not null,
  client_name text not null default '',
  published_at text not null,
  route_assignment text not null default '',
  route_run_id uuid references public.route_runs(id) on delete set null,
  reported_by uuid references auth.users(id) on delete set null,
  reporter_name text not null,
  reported_at timestamptz not null default clock_timestamp(),
  status text not null default 'pending' check (status in ('pending', 'confirmed')),
  confirmed_by uuid references auth.users(id) on delete set null,
  confirmed_at timestamptz,
  released_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  constraint route_capture_confirmation_consistent check (
    (status = 'pending' and confirmed_by is null and confirmed_at is null)
    or (status = 'confirmed' and confirmed_by is not null and confirmed_at is not null)
  )
);

alter table public.route_capture_events
  add column if not exists route_run_id uuid references public.route_runs(id) on delete set null;

create index if not exists route_capture_events_owner_reported_idx
  on public.route_capture_events(user_id, reported_at desc);
create index if not exists route_capture_events_owner_status_idx
  on public.route_capture_events(user_id, status, reported_at desc);
create unique index if not exists route_capture_events_active_item_unique
  on public.route_capture_events(user_id, client_id)
  where released_at is null;

alter table public.route_capture_events enable row level security;

drop policy if exists route_capture_events_read on public.route_capture_events;
create policy route_capture_events_read
on public.route_capture_events
for select
to authenticated
using (public.can_view_owner_screen(user_id, 'route_search'));

revoke all on public.route_capture_events from public, anon, authenticated;
grant select on public.route_capture_events to authenticated;

create or replace function public.start_route_run(p_user_id uuid, p_route text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_route text := upper(btrim(regexp_replace(coalesce(p_route, ''), '[[:space:]]+', ' ', 'g')));
  v_email text;
  v_expected_route text;
  v_id uuid;
begin
  if not coalesce(public.can_report_route_payment(p_user_id), false) then
    raise exception 'No tienes permiso para iniciar la ruta.';
  end if;
  if v_route = '' or char_length(v_route) > 12 then
    raise exception 'La ruta debe tener entre 1 y 12 caracteres.';
  end if;

  select lower(coalesce(email, '')) into v_email
  from public.user_profiles
  where id = auth.uid();

  v_expected_route := case v_email
    when 'delta1@auth.rentautos.local' then 'PTY'
    when 'delta2@auth.rentautos.local' then 'WC'
    when 'delta3@auth.rentautos.local' then 'PTY'
    else null
  end;
  if v_expected_route is not null and v_route <> v_expected_route then
    raise exception 'La ruta asignada a este Delta es %.', v_expected_route;
  end if;

  insert into public.route_runs(user_id, route_assignment, operator_id, operator_name)
  values (p_user_id, v_route, auth.uid(), coalesce(nullif(v_email, ''), auth.uid()::text))
  returning id into v_id;
  return v_id;
exception
  when unique_violation then
    raise exception 'Ya tienes una ruta en curso. Ciérrala antes de iniciar otra.';
end;
$$;

create or replace function public.submit_route_run(p_run_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.route_runs;
begin
  select * into v_run from public.route_runs where id = p_run_id for update;
  if not found then raise exception 'No existe la ruta indicada.'; end if;
  if v_run.operator_id <> auth.uid()
    and not (coalesce(public.is_admin(), false) and coalesce(public.can_edit_owner_screen(v_run.user_id, 'route_search'), false)) then
    raise exception 'Solo el Delta responsable puede cerrar esta ruta.';
  end if;
  if v_run.status <> 'in_progress' then raise exception 'La ruta ya fue cerrada.'; end if;

  update public.route_runs
  set status = 'pending', submitted_at = clock_timestamp()
  where id = p_run_id;
end;
$$;

create or replace function public.confirm_route_run(p_run_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.route_runs;
begin
  select * into v_run from public.route_runs where id = p_run_id for update;
  if not found then raise exception 'No existe la ruta indicada.'; end if;
  if not coalesce(public.is_admin(), false)
    or not coalesce(public.can_edit_owner_screen(v_run.user_id, 'route_search'), false) then
    raise exception 'Solo un administrador de Ruta en calle puede confirmar rutas.';
  end if;
  if v_run.status <> 'pending' then raise exception 'La ruta no está pendiente de confirmación.'; end if;
  if exists (
    select 1 from public.route_capture_events
    where route_run_id = p_run_id and status = 'pending'
  ) then
    raise exception 'Confirma primero todas las captaciones de esta ruta.';
  end if;

  update public.route_runs
  set status = 'confirmed', confirmed_by = auth.uid(), confirmed_at = clock_timestamp()
  where id = p_run_id;
end;
$$;

create or replace function public.close_route_capture_on_custody_exit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.in_custody and not new.in_custody then
    update public.route_capture_events
    set released_at = coalesce(released_at, clock_timestamp())
    where user_id = new.user_id
      and client_id = new.client_id
      and released_at is null;
  end if;
  return new;
end;
$$;

drop trigger if exists route_capture_close_on_custody_exit on public.active_route_items_cloud;
create trigger route_capture_close_on_custody_exit
after update of in_custody on public.active_route_items_cloud
for each row
when (old.in_custody is distinct from new.in_custody)
execute function public.close_route_capture_on_custody_exit();

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
      raise exception 'Inicia la ruta % antes de registrar una captación.', coalesce(v_item.data->>'routeAssignment', '');
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

create or replace function public.confirm_route_capture(p_capture_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_capture public.route_capture_events;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión.';
  end if;

  select * into v_capture
  from public.route_capture_events
  where id = p_capture_id
  for update;

  if not found then
    raise exception 'No existe la captación indicada.';
  end if;
  if not coalesce(public.is_admin(), false)
    or not coalesce(public.can_edit_owner_screen(v_capture.user_id, 'route_search'), false) then
    raise exception 'Solo un administrador de Ruta en calle puede confirmar captaciones.';
  end if;
  if v_capture.status <> 'pending' then
    raise exception 'La captación ya fue confirmada.';
  end if;

  update public.route_capture_events
  set status = 'confirmed',
      confirmed_by = auth.uid(),
      confirmed_at = clock_timestamp()
  where id = p_capture_id;
end;
$$;

-- Recupera las custodias activas creadas antes de este control.
insert into public.route_capture_events(
  user_id, client_id, unit_id, client_name, published_at, route_assignment,
  reported_by, reporter_name, reported_at
)
select
  route.user_id,
  route.client_id,
  coalesce(route.data->>'unitId', ''),
  coalesce(route.data->>'clientName', ''),
  coalesce(route.data->>'publishedAt', route.updated_at::text),
  coalesce(route.data->>'routeAssignment', ''),
  route.custody_changed_by,
  coalesce(profile.email, route.custody_changed_by::text, 'Usuario anterior'),
  coalesce(route.custody_since, route.custody_changed_at, route.updated_at)
from public.active_route_items_cloud route
left join public.user_profiles profile on profile.id = route.custody_changed_by
where route.in_custody
  and not exists (
    select 1
    from public.route_capture_events capture
    where capture.user_id = route.user_id
      and capture.client_id = route.client_id
      and capture.released_at is null
  );

revoke all on function public.set_active_route_custody(uuid,text,text,boolean,boolean) from public, anon;
grant execute on function public.set_active_route_custody(uuid,text,text,boolean,boolean) to authenticated;
revoke all on function public.start_route_run(uuid,text) from public, anon;
grant execute on function public.start_route_run(uuid,text) to authenticated;
revoke all on function public.submit_route_run(uuid) from public, anon;
grant execute on function public.submit_route_run(uuid) to authenticated;
revoke all on function public.confirm_route_run(uuid) from public, anon;
grant execute on function public.confirm_route_run(uuid) to authenticated;
revoke all on function public.confirm_route_capture(uuid) from public, anon;
grant execute on function public.confirm_route_capture(uuid) to authenticated;
revoke all on function public.close_route_capture_on_custody_exit() from public, anon, authenticated;

do $$
begin
  if exists(select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists(
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'route_runs'
    ) then
    alter publication supabase_realtime add table public.route_runs;
  end if;
  if exists(select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists(
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'route_capture_events'
    ) then
    alter publication supabase_realtime add table public.route_capture_events;
  end if;
end $$;

notify pgrst, 'reload schema';
