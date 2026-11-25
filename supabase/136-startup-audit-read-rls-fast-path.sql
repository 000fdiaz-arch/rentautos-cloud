-- Background audit pagination must not re-evaluate actor permissions for
-- every history row. Preserve all rows and the existing active-profile,
-- admin/own/shared-owner and payments-screen checks; change no write policy.
-- Keep the scope predicate aligned with can_access_owner_data if it changes.
begin;
set local lock_timeout = '3s';

alter policy manual_assignment_audit_cloud_screen_read on public.manual_assignment_audit_cloud
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
