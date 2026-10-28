-- Evita registrar dos autos del mismo owner con la misma placa, chasis o motor.
-- Se aplica también a autos dados de baja para conservar la identidad histórica.

create or replace function public.enforce_fleet_unit_identity_uniqueness()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_conflicting_unit text;
  v_token text;
begin
  -- Serializa altas/ediciones de un mismo owner para evitar duplicados simultáneos.
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 0));

  v_token := upper(regexp_replace(coalesce(new.plate, ''), '[^A-Z0-9]', '', 'g'));
  if v_token <> '' then
    select f.unit_id into v_conflicting_unit
    from public.fleet_units_cloud f
    where f.user_id = new.user_id
      and f.fleet_id is distinct from new.fleet_id
      and upper(regexp_replace(coalesce(f.plate, ''), '[^A-Z0-9]', '', 'g')) = v_token
    limit 1;
    if found then
      raise exception 'La placa % ya esta registrada en la unidad %', new.plate, v_conflicting_unit using errcode = '23505';
    end if;
  end if;

  v_token := upper(regexp_replace(coalesce(new.chassis_serial, ''), '[^A-Z0-9]', '', 'g'));
  if v_token <> '' then
    select f.unit_id into v_conflicting_unit
    from public.fleet_units_cloud f
    where f.user_id = new.user_id
      and f.fleet_id is distinct from new.fleet_id
      and upper(regexp_replace(coalesce(f.chassis_serial, ''), '[^A-Z0-9]', '', 'g')) = v_token
    limit 1;
    if found then
      raise exception 'El serial de chasis % ya esta registrado en la unidad %', new.chassis_serial, v_conflicting_unit using errcode = '23505';
    end if;
  end if;

  v_token := upper(regexp_replace(coalesce(new.engine_serial, ''), '[^A-Z0-9]', '', 'g'));
  if v_token <> '' then
    select f.unit_id into v_conflicting_unit
    from public.fleet_units_cloud f
    where f.user_id = new.user_id
      and f.fleet_id is distinct from new.fleet_id
      and upper(regexp_replace(coalesce(f.engine_serial, ''), '[^A-Z0-9]', '', 'g')) = v_token
    limit 1;
    if found then
      raise exception 'El serial de motor % ya esta registrado en la unidad %', new.engine_serial, v_conflicting_unit using errcode = '23505';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists fleet_units_identity_uniqueness on public.fleet_units_cloud;
create trigger fleet_units_identity_uniqueness
before insert or update of plate, chassis_serial, engine_serial
on public.fleet_units_cloud
for each row execute function public.enforce_fleet_unit_identity_uniqueness();

notify pgrst, 'reload schema';
