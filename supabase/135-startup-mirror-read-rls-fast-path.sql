-- Evaluate actor-only permissions once per statement for the remaining
-- startup mirror reads. Same active-profile, admin/own/shared-owner and
-- screen checks as can_view_owner_screen. No write policies are changed.
-- Keep the scope predicate aligned with can_access_owner_data if it changes.
begin;
set local lock_timeout = '3s';

alter policy bank_rules_cloud_settings_or_payments_read on public.bank_rules_cloud
using (
  (select public.can_access_owner_data((select auth.uid())))
  and (
    user_id = (select auth.uid())
    or (select public.has_role('admin'::public.app_role))
    or user_id = (select public.current_data_owner_user_id())
  )
  and (
    (select public.current_user_can_view_screen('settings'))
    or
    (select public.current_user_can_view_screen('payments'))
  )
);

alter policy cash_closing_audit_cloud_screen_read on public.cash_closing_audit_cloud
using (
  (select public.can_access_owner_data((select auth.uid())))
  and (
    user_id = (select auth.uid())
    or (select public.has_role('admin'::public.app_role))
    or user_id = (select public.current_data_owner_user_id())
  )
  and (
    (select public.current_user_can_view_screen('payments'))
  )
);

alter policy cash_closings_cloud_screen_read on public.cash_closings_cloud
using (
  (select public.can_access_owner_data((select auth.uid())))
  and (
    user_id = (select auth.uid())
    or (select public.has_role('admin'::public.app_role))
    or user_id = (select public.current_data_owner_user_id())
  )
  and (
    (select public.current_user_can_view_screen('payments'))
  )
);

alter policy pending_card_items_cloud_screen_read on public.pending_card_items_cloud
using (
  (select public.can_access_owner_data((select auth.uid())))
  and (
    user_id = (select auth.uid())
    or (select public.has_role('admin'::public.app_role))
    or user_id = (select public.current_data_owner_user_id())
  )
  and (
    (select public.current_user_can_view_screen('payments'))
  )
);

notify pgrst, 'reload schema';
commit;
