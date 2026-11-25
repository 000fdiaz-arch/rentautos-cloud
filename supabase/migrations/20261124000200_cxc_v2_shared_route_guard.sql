-- Preserve active route preparation without discarding unrelated contact history.
create or replace function public.cxc_v2_guard_active_route_management_tag()
returns trigger language plpgsql set search_path to 'public'
as $function$
declare field text;
begin
  if old.data->>'isRouteTagged' = 'true'
     and coalesce(new.data->>'isRouteTagged','false') <> 'true'
     and exists (
       select 1 from public.active_route_items_cloud r
       where r.user_id=new.user_id and r.client_id=new.client_id
         and coalesce(r.data->>'removedAt','')=''
     ) then
    -- Stale clients may still send a route-cleared snapshot. Keep the route
    -- fields, but allow their new promise, note or contact outcome to be saved.
    foreach field in array array['isRouteTagged','routeTaggedAt','managementType',
      'managementAmount','managementComment','managementUpdatedAt',
      'routeReleaseAmount','routeReleaseUpdatedAt','routeAssignment',
      'routeAssignmentUpdatedAt','routeUrgency','routeUrgencyUpdatedAt'] loop
      if old.data ? field then
        new.data := jsonb_set(new.data,array[field],old.data->field,true);
      else
        new.data := new.data - field;
      end if;
    end loop;
  end if;
  return new;
end;
$function$;
