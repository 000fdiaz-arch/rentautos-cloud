-- Prevent outdated open tabs from undoing a freshly published route item.
--
-- Older clients used the ambiguous `removed` reason both for manual removal and
-- for an automatic eligibility cleanup. Current clients use explicit reasons,
-- so a legacy removal can be safely ignored. This is especially important when
-- two devices or tabs share the same authenticated user and stay connected to
-- Realtime during a deployment.
create or replace function public.guard_legacy_active_route_removal()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.data ->> 'removedAt' is null
     and new.data ->> 'removedAt' is not null
     and new.data ->> 'removedReason' = 'removed' then
    return null;
  end if;

  return new;
end;
$$;

drop trigger if exists guard_legacy_active_route_removal
  on public.active_route_items_cloud;

create trigger guard_legacy_active_route_removal
before update on public.active_route_items_cloud
for each row
execute function public.guard_legacy_active_route_removal();

-- Keep the management tag consistent with the published route. An old client
-- cleared this flag immediately before attempting the legacy route removal.
-- The flag may only be cleared after the route row has a real removal reason.
create or replace function public.guard_active_route_management_tag()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.data ->> 'isRouteTagged' = 'true'
     and coalesce(new.data ->> 'isRouteTagged', 'false') <> 'true'
     and exists (
       select 1
       from public.active_route_items_cloud route_item
       where route_item.user_id = new.user_id
         and route_item.client_id = new.client_id
         and route_item.data ->> 'removedAt' is null
     ) then
    return null;
  end if;

  return new;
end;
$$;

drop trigger if exists guard_active_route_management_tag
  on public.street_management_items_cloud;

create trigger guard_active_route_management_tag
before update on public.street_management_items_cloud
for each row
execute function public.guard_active_route_management_tag();
