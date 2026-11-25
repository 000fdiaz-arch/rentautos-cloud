-- Same authorization as can_view_owner_screen(user_id, screen), factored into
-- actor-only InitPlans and an own/shared/admin owner check. These values are
-- recomputed for each statement, so permission revocations remain immediate.
-- Keep this scope check aligned with can_access_owner_data if its rules change.
begin;
set local lock_timeout = '3s';

alter policy payments_cloud_operational_read on public.payments_cloud
using (
  (select public.can_access_owner_data((select auth.uid())))
  and (
    user_id = (select auth.uid())
    or (select public.has_role('admin'::public.app_role))
    or user_id = (select public.current_data_owner_user_id())
  )
  and (
    (select public.current_user_can_view_screen('payments'))
    or (select public.current_user_can_view_screen('receivables'))
    or (select public.current_user_can_view_screen('route_search'))
  )
);

notify pgrst, 'reload schema';
commit;
