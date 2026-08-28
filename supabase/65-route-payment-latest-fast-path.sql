-- Rentautos: evita reconstruir el historial completo al insertar pagos desde Ruta.
-- Ejecutar despues de 64-provisional-rental-payment-balance.sql.
-- Esta migracion solo mantiene latest_payments_by_client_cloud; no calcula ni
-- modifica balances en clients_cloud.

create or replace function public.refresh_latest_payment_for_payment_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_user_id uuid;
  v_client_id text;
  v_old_client_id text;
  v_old_unit text;
  v_new_client_id text;
  v_new_unit text;
begin
  v_owner_user_id := coalesce(new.user_id, old.user_id);
  v_old_client_id := case when tg_op in ('UPDATE', 'DELETE') then old.data->>'clientId' else null end;
  v_old_unit := case when tg_op in ('UPDATE', 'DELETE') then public.receivable_identity_unit(old.data->>'clientUnit') else null end;
  v_new_client_id := case when tg_op in ('INSERT', 'UPDATE') then new.data->>'clientId' else null end;
  v_new_unit := case when tg_op in ('INSERT', 'UPDATE') then public.receivable_identity_unit(new.data->>'clientUnit') else null end;

  -- Ruta siempre crea un pago nuevo con clientId. En ese caso no hace falta
  -- consultar payments_cloud: se compara el pago entrante con la unica fila
  -- auxiliar del cliente. UPDATE y DELETE conservan la reconstruccion completa.
  if tg_op = 'INSERT'
     and new.data->>'source' = 'route'
     and coalesce(v_new_client_id, '') <> ''
     and exists (
       select 1
       from public.clients_cloud client
       where client.user_id = new.user_id
         and client.id = v_new_client_id
         and coalesce(lower(client.data->>'status'), 'activo') <> 'archivado'
         and nullif(client.data->>'archivedAt', '') is null
     )
  then
    insert into public.latest_payments_by_client_cloud (
      user_id,
      client_id,
      payment_id,
      client_unit,
      date_applied,
      created_at_payment,
      data,
      updated_at
    )
    values (
      new.user_id,
      v_new_client_id,
      new.id,
      nullif(new.data->>'clientUnit', ''),
      nullif(new.data->>'dateApplied', ''),
      nullif(new.data->>'createdAt', ''),
      new.data,
      now()
    )
    on conflict (user_id, client_id) do update
    set payment_id = excluded.payment_id,
        client_unit = excluded.client_unit,
        date_applied = excluded.date_applied,
        created_at_payment = excluded.created_at_payment,
        data = excluded.data,
        updated_at = now()
    where (
      coalesce(excluded.date_applied, ''),
      coalesce(excluded.created_at_payment, ''),
      excluded.payment_id
    ) > (
      coalesce(latest_payments_by_client_cloud.date_applied, ''),
      coalesce(latest_payments_by_client_cloud.created_at_payment, ''),
      latest_payments_by_client_cloud.payment_id
    );

    return new;
  end if;

  -- Los cambios y eliminaciones pueden invalidar el ultimo pago, y los pagos
  -- legacy pueden relacionarse por unidad/identidad. Esos casos mantienen la
  -- reconstruccion segura que ya existia.
  for v_client_id in
    select distinct c.id
    from public.clients_cloud c
    where c.user_id = v_owner_user_id
      and coalesce(lower(c.data->>'status'), 'activo') <> 'archivado'
      and nullif(c.data->>'archivedAt', '') is null
      and (
        c.id = v_old_client_id
        or c.id = v_new_client_id
        or (coalesce(v_old_unit, '') <> '' and public.receivable_identity_unit(c.data->>'unitId') = v_old_unit)
        or (coalesce(v_new_unit, '') <> '' and public.receivable_identity_unit(c.data->>'unitId') = v_new_unit)
      )
  loop
    perform public.rebuild_latest_payment_for_client(v_owner_user_id, v_client_id);
  end loop;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists refresh_latest_payment_for_payment_row on public.payments_cloud;
create trigger refresh_latest_payment_for_payment_row
after insert or update or delete on public.payments_cloud
for each row execute function public.refresh_latest_payment_for_payment_row();

grant execute on function public.refresh_latest_payment_for_payment_row() to authenticated;
