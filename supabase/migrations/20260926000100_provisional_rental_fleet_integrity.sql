-- Rentautos: mantiene sincronizados el alquiler provisional del cliente y el estado de flota.
-- Ejecutar despues de 88-payment-insert-latest-fast-path.sql.

create or replace function public.sync_provisional_rental_fleet_state()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_owner_user_id uuid := case when tg_op in ('UPDATE', 'DELETE') then old.user_id else null end;
  v_new_owner_user_id uuid := case when tg_op in ('INSERT', 'UPDATE') then new.user_id else null end;
  v_old_unit_id text := case
    when tg_op in ('UPDATE', 'DELETE') then upper(btrim(coalesce(old.data #>> '{activeProvisionalRental,unitId}', '')))
    else ''
  end;
  v_new_unit_id text := case
    when tg_op in ('INSERT', 'UPDATE') then upper(btrim(coalesce(new.data #>> '{activeProvisionalRental,unitId}', '')))
    else ''
  end;
begin
  -- Si el vinculo se retiro o cambio de unidad, la unidad anterior no puede
  -- permanecer como provisional_rental sin un cliente que la respalde.
  if v_old_owner_user_id is not null
    and v_old_unit_id <> ''
    and (
      v_old_owner_user_id is distinct from v_new_owner_user_id
      or v_old_unit_id is distinct from v_new_unit_id
    )
  then
    update public.fleet_units_cloud f
    set operational_status = coalesce((
          select case
            when lower(coalesce(c.data->>'status', 'activo')) in ('activo', 'taller', 'chapisteria', 'custodia')
              then lower(coalesce(c.data->>'status', 'activo'))
            else 'activo'
          end
          from public.clients_cloud c
          where c.user_id = v_old_owner_user_id
            and upper(btrim(coalesce(c.data->>'unitId', ''))) = v_old_unit_id
            and lower(coalesce(c.data->>'status', 'activo')) <> 'archivado'
          order by c.updated_at desc, c.id
          limit 1
        ), 'libre'),
        updated_at = now()
    where f.user_id = v_old_owner_user_id
      and upper(btrim(f.unit_id)) = v_old_unit_id
      and lower(coalesce(f.operational_status, '')) = 'provisional_rental'
      and not exists (
        select 1
        from public.clients_cloud c
        where c.user_id = v_old_owner_user_id
          and upper(btrim(coalesce(c.data #>> '{activeProvisionalRental,unitId}', ''))) = v_old_unit_id
      );
  end if;

  -- El vinculo del cliente es la fuente de verdad: cualquier escritura que lo
  -- conserve debe mantener la unidad marcada como alquiler provisional.
  if v_new_owner_user_id is not null and v_new_unit_id <> '' then
    update public.fleet_units_cloud
    set operational_status = 'provisional_rental',
        updated_at = now()
    where user_id = v_new_owner_user_id
      and retired_at is null
      and upper(btrim(unit_id)) = v_new_unit_id;

    if not found then
      raise exception 'La unidad provisional % no existe o esta retirada.', v_new_unit_id;
    end if;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists clients_cloud_sync_provisional_fleet on public.clients_cloud;
create trigger clients_cloud_sync_provisional_fleet
after insert or update or delete on public.clients_cloud
for each row execute function public.sync_provisional_rental_fleet_state();

-- Repara estados huérfanos existentes. Si la unidad ya tiene un cliente
-- regular vigente, restaura su estado; de lo contrario queda libre.
update public.fleet_units_cloud f
set operational_status = coalesce((
      select case
        when lower(coalesce(c.data->>'status', 'activo')) in ('activo', 'taller', 'chapisteria', 'custodia')
          then lower(coalesce(c.data->>'status', 'activo'))
        else 'activo'
      end
      from public.clients_cloud c
      where c.user_id = f.user_id
        and upper(btrim(coalesce(c.data->>'unitId', ''))) = upper(btrim(f.unit_id))
        and lower(coalesce(c.data->>'status', 'activo')) <> 'archivado'
      order by c.updated_at desc, c.id
      limit 1
    ), 'libre'),
    updated_at = now()
where lower(coalesce(f.operational_status, '')) = 'provisional_rental'
  and not exists (
    select 1
    from public.clients_cloud c
    where c.user_id = f.user_id
      and upper(btrim(coalesce(c.data #>> '{activeProvisionalRental,unitId}', ''))) = upper(btrim(f.unit_id))
  );

-- Repara el caso inverso: un cliente conserva el alquiler, pero la unidad no
-- refleja el estado provisional.
update public.fleet_units_cloud f
set operational_status = 'provisional_rental',
    updated_at = now()
where f.retired_at is null
  and exists (
    select 1
    from public.clients_cloud c
    where c.user_id = f.user_id
      and upper(btrim(coalesce(c.data #>> '{activeProvisionalRental,unitId}', ''))) = upper(btrim(f.unit_id))
  )
  and lower(coalesce(f.operational_status, '')) <> 'provisional_rental';

revoke all on function public.sync_provisional_rental_fleet_state() from public;

notify pgrst, 'reload schema';
