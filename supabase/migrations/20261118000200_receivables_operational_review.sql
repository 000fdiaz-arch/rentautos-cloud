-- Atomic operational validation from CxC. Does not grant general fleet editing.
begin;
create table if not exists public.receivables_operational_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  unit_id text not null,
  previous_status text not null,
  status text not null,
  collector text not null,
  reviewed_by uuid not null references auth.users(id),
  reviewed_at timestamptz not null default now(),
  fleet_updated_at timestamptz not null
);
create index if not exists receivables_operational_reviews_lookup
  on public.receivables_operational_reviews(user_id, collector, reviewed_at desc);
alter table public.receivables_operational_reviews enable row level security;
drop policy if exists receivables_operational_reviews_read on public.receivables_operational_reviews;
create policy receivables_operational_reviews_read on public.receivables_operational_reviews
  for select to authenticated using (public.can_view_owner_screen(user_id, 'receivables'));
grant select on public.receivables_operational_reviews to authenticated;

create or replace function public.validate_receivable_unit_status(
  p_owner uuid, p_unit text, p_expected_status text, p_status text, p_collector text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_unit text := upper(btrim(p_unit));
  v_status text := lower(btrim(p_status));
  v_current text;
  v_fleet public.fleet_units_cloud%rowtype;
  v_review public.receivables_operational_reviews%rowtype;
  v_archived text[] := '{}';
  v_updated text[] := '{}';
  v_now timestamptz := clock_timestamp();
begin
  if auth.uid() is null or not coalesce(public.can_edit_owner_screen(p_owner, 'receivables'), false) then
    raise exception 'No tienes permiso para validar estados en Cuentas por cobrar.';
  end if;
  if p_collector not in ('collector-1', 'collector-2') or p_collector is null or
    (p_collector = 'collector-1' and left(v_unit,1) not in ('A','C','E')) or
    (p_collector = 'collector-2' and left(v_unit,1) not in ('B','D','T')) then
    raise exception 'La unidad no pertenece a la cartera seleccionada.';
  end if;
  select * into v_fleet from public.fleet_units_cloud
    where user_id=p_owner and upper(btrim(unit_id))=v_unit and retired_at is null for update;
  if not found then raise exception 'Unidad no encontrada en la flota vigente.'; end if;
  -- Lock associated clients as the control-unit view prioritizes their state.
  perform id from public.clients_cloud where user_id=p_owner
    and upper(btrim(data->>'unitId'))=v_unit for update;
  select lower(coalesce(data->>'status','activo')) into v_current from public.clients_cloud
    where user_id=p_owner and upper(btrim(data->>'unitId'))=v_unit
      and coalesce(data->>'status','activo') <> 'archivado'
    order by updated_at desc limit 1;
  v_current := coalesce(v_current, lower(coalesce(v_fleet.operational_status,'libre')));
  if v_current <> lower(btrim(p_expected_status)) or p_expected_status is null then
    raise exception 'El estado cambió en otra sesión. Recarga y valida el estado actual.';
  end if;
  if v_current = 'activo' then raise exception 'La unidad ya está activa; continúa con su gestión.'; end if;
  if v_status is null or v_status = '' then raise exception 'Selecciona el estado real.'; end if;
  if v_status <> v_current then
    if v_status not in ('activo','libre','taller','chapisteria','custodia','archivado') then
      raise exception 'Estado de destino no válido.';
    end if;
    update public.fleet_units_cloud set operational_status=v_status, updated_at=v_now
      where fleet_id=v_fleet.fleet_id;
    if v_status in ('libre','archivado') then
      with changed as (
        update public.clients_cloud set data=data || jsonb_build_object('status','archivado','archivedAt',v_now,
          'statusComment','Estado validado desde Cuentas por cobrar.'), updated_at=v_now
        where user_id=p_owner and upper(btrim(data->>'unitId'))=v_unit
          and coalesce(data->>'status','activo') <> 'archivado' returning id
      ) select coalesce(array_agg(id),'{}') into v_archived from changed;
    else
      with changed as (
        update public.clients_cloud set data=(data - 'archivedAt' - 'statusComment') || jsonb_build_object('status',v_status), updated_at=v_now
        where user_id=p_owner and upper(btrim(data->>'unitId'))=v_unit
          and coalesce(data->>'status','activo') <> 'archivado' returning id
      ) select coalesce(array_agg(id),'{}') into v_updated from changed;
    end if;
    v_fleet.updated_at := v_now;
  end if;
  insert into public.receivables_operational_reviews(user_id,unit_id,previous_status,status,collector,reviewed_by,reviewed_at,fleet_updated_at)
    values(p_owner,v_unit,v_current,v_status,p_collector,auth.uid(),v_now,v_fleet.updated_at) returning * into v_review;
  return jsonb_build_object('review',to_jsonb(v_review),'archived_client_ids',v_archived,'updated_client_ids',v_updated);
end;
$$;
revoke all on function public.validate_receivable_unit_status(uuid,text,text,text,text) from public, anon;
grant execute on function public.validate_receivable_unit_status(uuid,text,text,text,text) to authenticated;
notify pgrst, 'reload schema';
commit;
