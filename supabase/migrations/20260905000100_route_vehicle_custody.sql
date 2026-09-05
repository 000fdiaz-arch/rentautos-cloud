-- Custodia es un estado operativo: no modifica clientes, pagos ni cargos.
alter table public.active_route_items_cloud
  add column if not exists in_custody boolean not null default false,
  add column if not exists custody_since timestamptz,
  add column if not exists custody_changed_at timestamptz,
  add column if not exists custody_changed_by uuid,
  add column if not exists custody_history jsonb not null default '[]'::jsonb;

create or replace function public.set_active_route_custody(
  p_user_id uuid, p_client_id text, p_published_at text,
  p_in_custody boolean, p_expected_in_custody boolean
) returns void language plpgsql security definer set search_path = '' as $$
declare v_item public.active_route_items_cloud;
begin
  if not coalesce(public.can_report_route_payment(p_user_id), false) then
    raise exception 'No tienes permiso para cambiar la custodia.';
  end if;
  if p_in_custody is null or p_expected_in_custody is null or p_in_custody = p_expected_in_custody then
    raise exception 'Indica un cambio de custodia válido.';
  end if;
  select * into v_item from public.active_route_items_cloud
    where user_id = p_user_id and client_id = p_client_id for update;
  if not found or v_item.data->>'publishedAt' is distinct from p_published_at
    or v_item.in_custody is distinct from p_expected_in_custody
    or (p_in_custody and coalesce(v_item.data->>'removedAt','') <> '') then
    raise exception 'La unidad cambió o ya no está activa. Actualiza la ruta.';
  end if;
  update public.active_route_items_cloud
    set in_custody = p_in_custody,
      custody_since = case when p_in_custody then now() else null end,
      custody_changed_at = now(), custody_changed_by = auth.uid(), updated_at = now(),
      custody_history = custody_history || jsonb_build_array(jsonb_build_object(
        'inCustody', p_in_custody, 'at', now(), 'by', auth.uid(),
        'unitId', data->>'unitId', 'publishedAt', data->>'publishedAt'))
    where user_id = p_user_id and client_id = p_client_id;
end;
$$;
revoke all on function public.set_active_route_custody(uuid,text,text,boolean,boolean) from public, anon;
grant execute on function public.set_active_route_custody(uuid,text,text,boolean,boolean) to authenticated;
-- Solo recibos vinculados al reporte visible; la tabla de enlaces sigue privada.
create or replace function public.read_route_report_receipts(p_user_id uuid, p_report_id uuid)
returns setof jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce(public.can_view_owner_screen(p_user_id, 'route_search'), false) then
    raise exception 'No tienes permiso para ver estos recibos.';
  end if;
  return query select p.data from public.payments_cloud p
    join public.route_report_payment_links l on l.user_id = p.user_id and l.payment_id = p.id
    join public.route_payment_reports r on r.id = l.report_id and r.user_id = l.user_id
    where r.user_id = p_user_id and r.id = p_report_id and r.status = 'confirmed'
    order by p.id;
end;
$$;
revoke all on function public.read_route_report_receipts(uuid,uuid) from public, anon;
grant execute on function public.read_route_report_receipts(uuid,uuid) to authenticated;
notify pgrst, 'reload schema';
