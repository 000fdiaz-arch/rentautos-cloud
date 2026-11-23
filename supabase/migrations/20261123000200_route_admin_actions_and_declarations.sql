-- Editar la acción es una operación administrativa; declarar dinero pertenece
-- a los buscadores. No cambia los permisos de conciliación bancaria de Admin.
create or replace function public.update_route_management_type(
  p_user_id uuid, p_client_id text, p_published_at text, p_previous_type text,
  p_management_type text, p_version text default 'legacy'
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_route_table text; v_street_table text; v_route jsonb; v_street jsonb;
  v_previous text; v_now timestamptz := clock_timestamp();
begin
  if not exists (select 1 from public.user_profiles p where p.id=auth.uid()
      and p.is_active and p.role::text='admin' and coalesce(p.data_owner_user_id,p.id)=p_user_id)
    or not coalesce(public.can_edit_owner_screen(p_user_id,'route_search'),false) then
    raise exception 'Solo Administración puede cambiar la acción solicitada.';
  end if;
  if p_management_type is null or p_management_type not in ('solo_cobrar','cobrar_o_quitar','desiste','quitar') then
    raise exception 'Selecciona una acción válida.';
  end if;
  if p_version='legacy' then
    v_route_table := 'active_route_items_cloud'; v_street_table := 'street_management_items_cloud';
  elsif p_version='v2' then
    v_route_table := 'cxc_v2_active_route_items_cloud'; v_street_table := 'cxc_v2_street_management_items_cloud';
  else raise exception 'Versión de ruta no válida.';
  end if;
  -- Mismo orden de bloqueo que la publicación de preparaciones.
  execute format('select data from public.%I where user_id=$1 and client_id=$2 for update',v_street_table)
    into v_street using p_user_id,p_client_id;
  execute format('select data from public.%I where user_id=$1 and client_id=$2 for update',v_route_table)
    into v_route using p_user_id,p_client_id;
  if v_route is null or coalesce(v_route->>'removedAt','')<>'' or (v_route->>'publishedAt') is distinct from p_published_at then
    raise exception 'La unidad cambió o ya no está en ruta. Actualiza la lista.';
  end if;
  v_previous := coalesce(nullif(v_route->>'managementType',''),'solo_cobrar');
  if v_previous is distinct from p_previous_type then
    raise exception 'La acción cambió en otro dispositivo. Actualiza antes de editar.';
  end if;
  if v_previous=p_management_type then return; end if;
  v_route := v_route || jsonb_build_object('managementType',p_management_type,'managementUpdatedAt',v_now,
    'managementUpdatedBy',auth.uid(),'managementTypeEdits',coalesce(v_route->'managementTypeEdits','[]'::jsonb)
      || jsonb_build_array(jsonb_build_object('previous',v_previous,'type',p_management_type,'at',v_now,'by',auth.uid())));
  execute format('update public.%I set data=$3,updated_at=$4 where user_id=$1 and client_id=$2',v_route_table)
    using p_user_id,p_client_id,v_route,v_now;
  if v_street is not null then
    execute format('update public.%I set data=data || $3,updated_at=$4 where user_id=$1 and client_id=$2',v_street_table)
      using p_user_id,p_client_id,jsonb_build_object('managementType',p_management_type,'managementUpdatedAt',v_now,'updatedAt',v_now),v_now;
  end if;
end;
$$;
revoke all on function public.update_route_management_type(uuid,text,text,text,text,text) from public,anon;
grant execute on function public.update_route_management_type(uuid,text,text,text,text,text) to authenticated;

-- Mantener validaciones de importes, publicación y resultado en ambas carteras.
-- La firma de cinco parámetros también pasa por la comprobación de rol.
do $migration$
declare v_prefix text; v_routes text; v_reports text; v_function text;
begin
  foreach v_prefix in array array['','cxc_v2_'] loop
    v_routes := v_prefix || 'active_route_items_cloud';
    v_reports := v_prefix || 'route_payment_reports';
    v_function := v_prefix || 'report_route_payment_split';
    if to_regclass('public.' || v_routes) is null then continue; end if;
    execute format($ddl$
      create or replace function public.%I(p_user_id uuid,p_client_id text,p_published_at text,
        p_cash_amount numeric,p_bank_amount numeric,p_management_outcome text)
      returns void language plpgsql security definer set search_path = '' as $body$
      declare v_item jsonb; v_name text; v_delta text; v_method text;
      begin
        if not exists (select 1 from public.user_profiles p where p.id=auth.uid() and p.is_active
          and p.role::text='buscador' and coalesce(p.data_owner_user_id,p.id)=p_user_id) then
          raise exception 'Las declaraciones de dinero son exclusivas de los buscadores.';
        end if;
        if not coalesce(public.can_report_route_payment(p_user_id),false) then
          raise exception 'No tienes permiso para declarar pagos.';
        end if;
        if p_cash_amount is null or p_bank_amount is null
          or p_cash_amount::text in ('NaN','Infinity','-Infinity') or p_bank_amount::text in ('NaN','Infinity','-Infinity')
          or p_cash_amount<0 or p_bank_amount<0 or p_cash_amount+p_bank_amount<=0
          or p_cash_amount+p_bank_amount>9999999999.99
          or p_cash_amount<>round(p_cash_amount,2) or p_bank_amount<>round(p_bank_amount,2) then
          raise exception 'Indica importes válidos de efectivo y transferencia, con hasta dos decimales.';
        end if;
        if p_management_outcome is null or p_management_outcome not in ('collected','remote') then
          raise exception 'Resultado de gestión no válido.';
        end if;
        select data into v_item from public.%I where user_id=p_user_id and client_id=p_client_id for update;
        if v_item is null or coalesce(v_item->>'removedAt','')<>'' or (v_item->>'publishedAt') is distinct from p_published_at then
          raise exception 'La unidad cambió o ya no está en ruta. Actualiza la lista.';
        end if;
        select coalesce(nullif(email,''),'Buscador'),lower(split_part(btrim(email),'@',1))
          into v_name,v_delta from public.user_profiles where id=auth.uid();
        if v_delta in ('delta1','delta2','delta3') and coalesce(v_item->>'assignedDelta','')<>v_delta then
          raise exception 'La unidad no pertenece a tu Delta. Actualiza la lista.';
        end if;
        v_method := case when p_cash_amount>0 and p_bank_amount>0 then 'mixed' when p_cash_amount>0 then 'cash' else 'bank' end;
        insert into public.%I(user_id,client_id,published_at,snapshot,amount,method,cash_amount,bank_amount,
          management_outcome,reported_by,reporter_name)
        values(p_user_id,p_client_id,p_published_at,v_item,p_cash_amount+p_bank_amount,v_method,p_cash_amount,p_bank_amount,
          p_management_outcome,auth.uid(),coalesce(v_name,'Buscador'));
      end;
      $body$;
    $ddl$,v_function,v_routes,v_reports);
    execute format($ddl$
      create or replace function public.%I(p_user_id uuid,p_client_id text,p_published_at text,p_cash_amount numeric,p_bank_amount numeric)
      returns void language plpgsql security definer set search_path = '' as $body$
      begin
        perform public.%I(p_user_id,p_client_id,p_published_at,p_cash_amount,p_bank_amount,'collected');
      end;
      $body$;
    $ddl$,v_function,v_function);
    execute format('revoke all on function public.%I(uuid,text,text,numeric,numeric,text) from public,anon',v_function);
    execute format('revoke all on function public.%I(uuid,text,text,numeric,numeric) from public,anon',v_function);
    execute format('grant execute on function public.%I(uuid,text,text,numeric,numeric,text) to authenticated',v_function);
    execute format('grant execute on function public.%I(uuid,text,text,numeric,numeric) to authenticated',v_function);
  end loop;
end;
$migration$;
notify pgrst,'reload schema';
