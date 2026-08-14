-- Acciones para usuarios con permiso de edicion en Ruta en calle.
-- Ver, editar comentarios, decidir pagos parciales y sacar unidades respetan
-- la configuracion de permisos de la pantalla.

create or replace function public.update_active_route_comment(
  p_user_id uuid,
  p_client_id text,
  p_comment text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_comment text := btrim(coalesce(p_comment, ''));
  v_updated_count integer;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesion.';
  end if;

  if not public.can_edit_owner_screen(p_user_id, 'route_search') then
    raise exception 'No tienes permiso para editar Ruta en calle.';
  end if;

  if char_length(v_comment) > 25 then
    raise exception 'El comentario no puede superar 25 caracteres.';
  end if;

  update public.active_route_items_cloud
  set
    data = case
      when v_comment = '' then data - 'comment'
      else jsonb_set(data, '{comment}', to_jsonb(v_comment), true)
    end,
    updated_at = now()
  where user_id = p_user_id
    and client_id = p_client_id
    and coalesce(data ->> 'removedAt', '') = '';

  get diagnostics v_updated_count = row_count;
  if v_updated_count = 0 then
    raise exception 'La unidad ya no esta activa en la ruta.';
  end if;
end;
$$;

create or replace function public.remove_active_route_item_from_search(
  p_user_id uuid,
  p_client_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated_count integer;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesion.';
  end if;

  if not public.can_edit_owner_screen(p_user_id, 'route_search') then
    raise exception 'No tienes permiso para editar Ruta en calle.';
  end if;

  update public.active_route_items_cloud
  set
    data = jsonb_set(
      jsonb_set(data, '{removedAt}', to_jsonb(now()), true),
      '{removedReason}',
      to_jsonb('route_editor_removed'::text),
      true
    ),
    updated_at = now()
  where user_id = p_user_id
    and client_id = p_client_id
    and coalesce(data ->> 'removedAt', '') = '';

  get diagnostics v_updated_count = row_count;
  if v_updated_count = 0 then
    raise exception 'La unidad ya no esta activa en la ruta.';
  end if;
end;
$$;

create or replace function public.keep_active_route_item_after_partial_payment(
  p_user_id uuid,
  p_client_id text,
  p_confirmed_rent_amount numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_confirmed_amount numeric := round(coalesce(p_confirmed_rent_amount, 0), 2);
  v_updated_count integer;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesion.';
  end if;

  if not public.can_edit_owner_screen(p_user_id, 'route_search') then
    raise exception 'No tienes permiso para editar Ruta en calle.';
  end if;

  if v_confirmed_amount <= 0 then
    raise exception 'El pago parcial debe ser mayor a cero.';
  end if;

  update public.active_route_items_cloud
  set
    data = jsonb_set(
      jsonb_set(data, '{partialDecisionRentAmount}', to_jsonb(v_confirmed_amount), true),
      '{partialDecisionAt}',
      to_jsonb(now()),
      true
    ),
    updated_at = now()
  where user_id = p_user_id
    and client_id = p_client_id
    and coalesce(data ->> 'removedAt', '') = ''
    and coalesce((data ->> 'releaseAmount')::numeric, 0) > v_confirmed_amount;

  get diagnostics v_updated_count = row_count;
  if v_updated_count = 0 then
    raise exception 'La unidad ya no tiene un pago parcial pendiente de decision.';
  end if;
end;
$$;

revoke all on function public.update_active_route_comment(uuid, text, text) from public;
grant execute on function public.update_active_route_comment(uuid, text, text) to authenticated;

revoke all on function public.remove_active_route_item_from_search(uuid, text) from public;
grant execute on function public.remove_active_route_item_from_search(uuid, text) to authenticated;

revoke all on function public.keep_active_route_item_after_partial_payment(uuid, text, numeric) from public;
grant execute on function public.keep_active_route_item_after_partial_payment(uuid, text, numeric) to authenticated;

-- Limpia la version anterior si esta migracion ya habia sido aplicada.
drop function if exists public.remove_active_route_item_as_operator(uuid, text);
