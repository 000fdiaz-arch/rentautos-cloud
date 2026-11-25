-- Evaluate actor-only read permissions once per statement, not once per row.
-- Same active-profile, admin, own/shared-owner and screen checks as the existing
-- can_access_owner_data/can_view_owner_screen functions. No write policy changes.
begin;
set local lock_timeout = '3s';

alter policy clients_cloud_operational_read on public.clients_cloud
using (
  (select public.can_access_owner_data((select auth.uid())))
  and (
    user_id = (select auth.uid())
    or (select public.has_role('admin'::public.app_role))
    or user_id = (select public.current_data_owner_user_id())
  )
  and (
    (select public.current_user_can_view_screen('clients'))
    or (select public.current_user_can_view_screen('payments'))
    or (select public.current_user_can_view_screen('receivables'))
    or (select public.current_user_can_view_screen('route_search'))
    or (select public.current_user_can_view_screen('insurance_workflow'))
    or (select public.current_user_can_view_screen('collisions'))
  )
);

alter policy fleet_units_cloud_screen_read on public.fleet_units_cloud
using (
  (select public.can_access_owner_data((select auth.uid())))
  and (
    user_id = (select auth.uid())
    or (select public.has_role('admin'::public.app_role))
    or user_id = (select public.current_data_owner_user_id())
  )
  and (select public.current_user_can_view_screen('control_units'))
);

alter policy fleet_units_operational_read on public.fleet_units_cloud
using (
  (select public.can_access_owner_data((select auth.uid())))
  and (
    user_id = (select auth.uid())
    or (select public.has_role('admin'::public.app_role))
    or user_id = (select public.current_data_owner_user_id())
  )
  and (
    (select public.current_user_can_view_screen('control_units'))
    or (select public.current_user_can_view_screen('receivables'))
    or (select public.current_user_can_view_screen('insurance_workflow'))
    or (select public.current_user_can_view_screen('collisions'))
  )
);

alter policy late_fee_ledger_cloud_screen_read on public.late_fee_ledger_cloud
using (
  (select public.can_access_owner_data((select auth.uid())))
  and (
    user_id = (select auth.uid())
    or (select public.has_role('admin'::public.app_role))
    or user_id = (select public.current_data_owner_user_id())
  )
  and (select public.current_user_can_view_screen('payments'))
);

notify pgrst, 'reload schema';
commit;
