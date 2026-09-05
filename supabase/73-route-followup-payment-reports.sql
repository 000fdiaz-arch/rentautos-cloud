-- Permitir abonos sucesivos sin borrar reportes ni vínculos de recibos.
-- El control de duplicados vive en el RPC, bajo el bloqueo de la ruta.
-- No se impone unicidad por estado: corregir un recibo anterior debe poder
-- reabrir su reporte incluso cuando exista un abono nuevo en revisión.
drop index if exists public.route_report_active_unique;
create index if not exists route_report_pending_idx on public.route_payment_reports(user_id,client_id,published_at) where status='review';

create or replace function public.report_route_payment_split(p_user_id uuid,p_client_id text,p_published_at text,p_cash_amount numeric,p_bank_amount numeric)
returns void language plpgsql security definer set search_path = '' as $$
declare v_item jsonb; v_name text; v_method text;
begin
  if not coalesce(public.can_report_route_payment(p_user_id),false) then raise exception 'No tienes permiso para reportar pagos.'; end if;
  if p_cash_amount is null or p_bank_amount is null
    or p_cash_amount::text in ('NaN','Infinity','-Infinity') or p_bank_amount::text in ('NaN','Infinity','-Infinity')
    or p_cash_amount<0 or p_bank_amount<0 or p_cash_amount+p_bank_amount<=0
    or p_cash_amount+p_bank_amount>9999999999.99
    or p_cash_amount<>round(p_cash_amount,2) or p_bank_amount<>round(p_bank_amount,2) then
    raise exception 'Indica importes válidos de efectivo y banca, con hasta dos decimales.';
  end if;
  select data into v_item from public.active_route_items_cloud where user_id=p_user_id and client_id=p_client_id for update;
  if v_item is null or coalesce(v_item->>'removedAt','')<>'' or (v_item->>'publishedAt') is distinct from p_published_at then
    raise exception 'La unidad cambió o ya no está activa. Actualiza la ruta.';
  end if;
  -- La fila de ruta bloqueada serializa los envíos de ambos buscadores.
  -- Los confirmados son historial y no impiden un abono adicional.
  if exists (select 1 from public.route_payment_reports where user_id=p_user_id and client_id=p_client_id and published_at=p_published_at and status='review') then
    raise exception 'Esta unidad ya tiene un reporte en revisión. Actualiza la ruta.';
  end if;
  v_method:=case when p_cash_amount>0 and p_bank_amount>0 then 'mixed' when p_cash_amount>0 then 'cash' else 'bank' end;
  select coalesce(nullif(email,''),'Buscador') into v_name from public.user_profiles where id=auth.uid();
  insert into public.route_payment_reports(user_id,client_id,published_at,snapshot,amount,method,cash_amount,bank_amount,reported_by,reporter_name)
    values(p_user_id,p_client_id,p_published_at,v_item,p_cash_amount+p_bank_amount,v_method,p_cash_amount,p_bank_amount,auth.uid(),v_name);
exception when unique_violation then raise exception 'Esta unidad ya tiene un reporte. Actualiza la ruta.';
end;
$$;

revoke all on function public.report_route_payment_split(uuid,text,text,numeric,numeric) from public, anon;
grant execute on function public.report_route_payment_split(uuid,text,text,numeric,numeric) to authenticated;
notify pgrst, 'reload schema';
