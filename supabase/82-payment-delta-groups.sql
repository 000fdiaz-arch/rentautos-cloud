-- Registra todos los grupos de pagos de una acción masiva en una sola solicitud.
-- La función completa es una transacción: si un cliente falla, no queda un lote parcial.
create or replace function public.register_client_payment_delta_groups(
  p_owner_user_id uuid,
  p_groups jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group jsonb;
  v_group_count integer;
  v_client_id text;
begin
  if not public.can_access_owner_data(p_owner_user_id) then
    raise exception 'No autorizado para registrar pagos de este owner';
  end if;

  if p_groups is null or jsonb_typeof(p_groups) <> 'array' then
    raise exception 'Los grupos de pagos son requeridos';
  end if;

  select count(*) into v_group_count from jsonb_array_elements(p_groups);
  if v_group_count <= 0 then
    raise exception 'Debe enviar al menos un grupo de pagos';
  end if;
  for v_group in
    select value
    from jsonb_array_elements(p_groups) with ordinality as item(value, ord)
    order by ord
  loop
    v_client_id := coalesce(v_group->>'clientId', '');
    if v_client_id = '' then
      raise exception 'Todos los grupos deben identificar un cliente';
    end if;

    perform public.register_client_payment_deltas(
      p_owner_user_id,
      v_client_id,
      nullif(v_group->>'expectedBalanceBefore', '')::numeric,
      v_group->'nextClient',
      v_group->'payments'
    );
  end loop;

  return jsonb_build_object(
    'groupCount', v_group_count
  );
end;
$$;

grant execute on function public.register_client_payment_delta_groups(uuid, jsonb) to authenticated;
