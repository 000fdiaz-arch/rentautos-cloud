-- Marca manual del motivo Panapass. No modifica importes ni crea pagos.
create or replace function public.set_route_panapass_reason(
  p_user_id uuid,p_client_id text,p_published_at text,p_previous boolean,
  p_panapass boolean,p_version text default 'legacy'
) returns void language plpgsql security definer set search_path='' as $$
declare v_table text; v_item jsonb; v_now timestamptz:=clock_timestamp();
begin
  if not exists(select 1 from public.user_profiles p where p.id=auth.uid() and p.is_active
    and p.role::text='admin' and coalesce(p.data_owner_user_id,p.id)=p_user_id)
    or not coalesce(public.can_edit_owner_screen(p_user_id,'route_search'),false) then
    raise exception 'Solo Administración puede marcar el motivo Panapass.';
  end if;
  if p_previous is null or p_panapass is null then raise exception 'Indica una marca Panapass válida.'; end if;
  if p_version='legacy' then v_table:='active_route_items_cloud';
  elsif p_version='v2' then v_table:='cxc_v2_active_route_items_cloud';
  else raise exception 'Versión de ruta no válida.'; end if;
  execute format('select data from public.%I where user_id=$1 and client_id=$2 for update',v_table)
    into v_item using p_user_id,p_client_id;
  if v_item is null or coalesce(v_item->>'removedAt','')<>''
    or (v_item->>'publishedAt') is distinct from p_published_at then
    raise exception 'La unidad cambió o ya no está en ruta. Actualiza la lista.';
  end if;
  if coalesce(v_item->'panapassRoute'='true'::jsonb,false) is distinct from p_previous then
    raise exception 'La marca Panapass cambió en otro dispositivo. Actualiza antes de editar.';
  end if;
  if p_previous=p_panapass then return; end if;
  execute format('update public.%I set data=data || $3,updated_at=$4 where user_id=$1 and client_id=$2',v_table)
    using p_user_id,p_client_id,jsonb_build_object('panapassRoute',p_panapass,'panapassUpdatedAt',v_now,'panapassUpdatedBy',auth.uid()),v_now;
end;$$;
revoke all on function public.set_route_panapass_reason(uuid,text,text,boolean,boolean,text) from public,anon;
grant execute on function public.set_route_panapass_reason(uuid,text,text,boolean,boolean,text) to authenticated;
notify pgrst,'reload schema';
