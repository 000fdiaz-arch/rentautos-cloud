-- Permite corregir el monto por cobrar de una unidad activa desde Ruta en calle.
-- Los perfiles Delta/buscador no pueden ejecutar esta operacion.

create or replace function public.update_active_route_release_amount(
  p_user_id uuid,
  p_client_id text,
  p_published_at text,
  p_release_amount numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_amount numeric(12,2);
  v_updated_count integer;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesion.';
  end if;

  if not coalesce(public.can_edit_owner_screen(p_user_id, 'route_search'), false) then
    raise exception 'No tienes permiso para editar Ruta en calle.';
  end if;

  if exists (
    select 1
    from public.user_profiles profile
    where profile.id = auth.uid()
      and lower(split_part(btrim(coalesce(profile.email, '')), '@', 1)) in ('delta1', 'delta2', 'delta3')
  ) then
    raise exception 'Los perfiles de buscador no pueden editar el monto por cobrar.';
  end if;

  if p_client_id is null or btrim(p_client_id) = '' or p_published_at is null or btrim(p_published_at) = '' then
    raise exception 'La unidad indicada no es valida.';
  end if;

  if p_release_amount is null
    or p_release_amount <= 0
    or p_release_amount > 9999999999.99
    or p_release_amount <> round(p_release_amount, 2) then
    raise exception 'El monto debe ser mayor que cero y tener maximo dos decimales.';
  end if;
  v_amount := round(p_release_amount, 2);

  if exists (
    select 1
    from public.route_payment_reports report
    where report.user_id = p_user_id
      and report.client_id = p_client_id
      and report.published_at = p_published_at
      and report.status <> 'cancelled'
  ) then
    raise exception 'No se puede editar el monto porque esta unidad ya tiene un pago notificado.';
  end if;

  update public.active_route_items_cloud
  set data = jsonb_set(
        jsonb_set(data, '{releaseAmount}', to_jsonb(v_amount), true),
        '{releaseAmountEdits}',
        coalesce(data->'releaseAmountEdits', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
          'previousAmount', round(coalesce((data->>'releaseAmount')::numeric, 0), 2),
          'amount', v_amount,
          'at', clock_timestamp(),
          'by', auth.uid()
        )),
        true
      ),
      updated_at = clock_timestamp()
  where user_id = p_user_id
    and client_id = p_client_id
    and data->>'publishedAt' = p_published_at
    and coalesce(data->>'removedAt', '') = '';

  get diagnostics v_updated_count = row_count;
  if v_updated_count = 0 then
    raise exception 'La unidad cambio o ya no esta activa. Actualiza la ruta.';
  end if;
end;
$$;

revoke all on function public.update_active_route_release_amount(uuid,text,text,numeric) from public, anon;
grant execute on function public.update_active_route_release_amount(uuid,text,text,numeric) to authenticated;

notify pgrst, 'reload schema';
