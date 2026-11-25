-- Cuentas por cobrar 2.0: isolated management. No rows copied or deleted.

-- Baseline deployment: e4541d2. Shared: clients, fleet, accounting payments.

begin;

set local check_function_bodies = off;

create table public.cxc_v2_street_management_items_cloud (like public.street_management_items_cloud including all);

alter table public.cxc_v2_street_management_items_cloud enable row level security;

revoke all on public.cxc_v2_street_management_items_cloud from public, anon, authenticated;

create table public.cxc_v2_daily_contact_attempts_cloud (like public.daily_contact_attempts_cloud including all);

alter table public.cxc_v2_daily_contact_attempts_cloud enable row level security;

revoke all on public.cxc_v2_daily_contact_attempts_cloud from public, anon, authenticated;

create table public.cxc_v2_collection_closures_cloud (like public.collection_closures_cloud including all);

alter table public.cxc_v2_collection_closures_cloud enable row level security;

revoke all on public.cxc_v2_collection_closures_cloud from public, anon, authenticated;

create table public.cxc_v2_receivables_operational_reviews (like public.receivables_operational_reviews including all);

alter table public.cxc_v2_receivables_operational_reviews enable row level security;

revoke all on public.cxc_v2_receivables_operational_reviews from public, anon, authenticated;

create table public.cxc_v2_active_route_items_cloud (like public.active_route_items_cloud including all);

alter table public.cxc_v2_active_route_items_cloud enable row level security;

revoke all on public.cxc_v2_active_route_items_cloud from public, anon, authenticated;

create table public.cxc_v2_route_payment_reports (like public.route_payment_reports including all);

alter table public.cxc_v2_route_payment_reports enable row level security;

revoke all on public.cxc_v2_route_payment_reports from public, anon, authenticated;

create table public.cxc_v2_route_report_payment_links (like public.route_report_payment_links including all);

alter table public.cxc_v2_route_report_payment_links enable row level security;

revoke all on public.cxc_v2_route_report_payment_links from public, anon, authenticated;

create table public.cxc_v2_route_runs (like public.route_runs including all);

alter table public.cxc_v2_route_runs enable row level security;

revoke all on public.cxc_v2_route_runs from public, anon, authenticated;

create table public.cxc_v2_route_capture_events (like public.route_capture_events including all);

alter table public.cxc_v2_route_capture_events enable row level security;

revoke all on public.cxc_v2_route_capture_events from public, anon, authenticated;

create table public.cxc_v2_notified_payments_cloud (like public.notified_payments_cloud including all);

alter table public.cxc_v2_notified_payments_cloud enable row level security;

revoke all on public.cxc_v2_notified_payments_cloud from public, anon, authenticated;

create table public.cxc_v2_notified_payment_tombstones (like public.notified_payment_tombstones including all);

alter table public.cxc_v2_notified_payment_tombstones enable row level security;

revoke all on public.cxc_v2_notified_payment_tombstones from public, anon, authenticated;

alter table public.cxc_v2_active_route_items_cloud add constraint "v2_active_route_items_cloud_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table public.cxc_v2_collection_closures_cloud add constraint "v2_collection_closures_cloud_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table public.cxc_v2_daily_contact_attempts_cloud add constraint "v2_daily_contact_attempts_cloud_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table public.cxc_v2_notified_payment_tombstones add constraint "v2_notified_payment_tombstones_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table public.cxc_v2_notified_payments_cloud add constraint "v2_notified_payments_cloud_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table public.cxc_v2_receivables_operational_reviews add constraint "v2_receivables_operational_reviews_reviewed_by_fkey" FOREIGN KEY (reviewed_by) REFERENCES auth.users(id);

alter table public.cxc_v2_receivables_operational_reviews add constraint "v2_receivables_operational_reviews_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table public.cxc_v2_route_capture_events add constraint "v2_route_capture_events_confirmed_by_fkey" FOREIGN KEY (confirmed_by) REFERENCES auth.users(id) ON DELETE SET NULL;

alter table public.cxc_v2_route_capture_events add constraint "v2_route_capture_events_reported_by_fkey" FOREIGN KEY (reported_by) REFERENCES auth.users(id) ON DELETE SET NULL;

alter table public.cxc_v2_route_capture_events add constraint "v2_route_capture_events_route_run_id_fkey" FOREIGN KEY (route_run_id) REFERENCES cxc_v2_route_runs(id) ON DELETE SET NULL;

alter table public.cxc_v2_route_capture_events add constraint "v2_route_capture_events_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table public.cxc_v2_route_payment_reports add constraint "v2_route_payment_reports_managed_hidden_by_fkey" FOREIGN KEY (managed_hidden_by) REFERENCES auth.users(id) ON DELETE SET NULL;

alter table public.cxc_v2_route_payment_reports add constraint "v2_route_payment_reports_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table public.cxc_v2_route_report_payment_links add constraint "v2_route_report_payment_links_report_id_fkey" FOREIGN KEY (report_id) REFERENCES cxc_v2_route_payment_reports(id) ON DELETE CASCADE;

alter table public.cxc_v2_route_runs add constraint "v2_route_runs_confirmed_by_fkey" FOREIGN KEY (confirmed_by) REFERENCES auth.users(id) ON DELETE SET NULL;

alter table public.cxc_v2_route_runs add constraint "v2_route_runs_operator_id_fkey" FOREIGN KEY (operator_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table public.cxc_v2_route_runs add constraint "v2_route_runs_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table public.cxc_v2_street_management_items_cloud add constraint "v2_street_management_items_cloud_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

grant INSERT on public.cxc_v2_active_route_items_cloud to authenticated;

grant SELECT on public.cxc_v2_active_route_items_cloud to authenticated;

grant UPDATE on public.cxc_v2_active_route_items_cloud to authenticated;

grant DELETE on public.cxc_v2_active_route_items_cloud to authenticated;

grant TRUNCATE on public.cxc_v2_active_route_items_cloud to authenticated;

grant REFERENCES on public.cxc_v2_active_route_items_cloud to authenticated;

grant TRIGGER on public.cxc_v2_active_route_items_cloud to authenticated;

grant MAINTAIN on public.cxc_v2_active_route_items_cloud to authenticated;

grant INSERT on public.cxc_v2_active_route_items_cloud to service_role;

grant SELECT on public.cxc_v2_active_route_items_cloud to service_role;

grant UPDATE on public.cxc_v2_active_route_items_cloud to service_role;

grant DELETE on public.cxc_v2_active_route_items_cloud to service_role;

grant TRUNCATE on public.cxc_v2_active_route_items_cloud to service_role;

grant REFERENCES on public.cxc_v2_active_route_items_cloud to service_role;

grant TRIGGER on public.cxc_v2_active_route_items_cloud to service_role;

grant MAINTAIN on public.cxc_v2_active_route_items_cloud to service_role;

grant INSERT on public.cxc_v2_collection_closures_cloud to authenticated;

grant SELECT on public.cxc_v2_collection_closures_cloud to authenticated;

grant UPDATE on public.cxc_v2_collection_closures_cloud to authenticated;

grant DELETE on public.cxc_v2_collection_closures_cloud to authenticated;

grant TRUNCATE on public.cxc_v2_collection_closures_cloud to authenticated;

grant REFERENCES on public.cxc_v2_collection_closures_cloud to authenticated;

grant TRIGGER on public.cxc_v2_collection_closures_cloud to authenticated;

grant MAINTAIN on public.cxc_v2_collection_closures_cloud to authenticated;

grant INSERT on public.cxc_v2_collection_closures_cloud to service_role;

grant SELECT on public.cxc_v2_collection_closures_cloud to service_role;

grant UPDATE on public.cxc_v2_collection_closures_cloud to service_role;

grant DELETE on public.cxc_v2_collection_closures_cloud to service_role;

grant TRUNCATE on public.cxc_v2_collection_closures_cloud to service_role;

grant REFERENCES on public.cxc_v2_collection_closures_cloud to service_role;

grant TRIGGER on public.cxc_v2_collection_closures_cloud to service_role;

grant MAINTAIN on public.cxc_v2_collection_closures_cloud to service_role;

grant INSERT on public.cxc_v2_daily_contact_attempts_cloud to authenticated;

grant SELECT on public.cxc_v2_daily_contact_attempts_cloud to authenticated;

grant UPDATE on public.cxc_v2_daily_contact_attempts_cloud to authenticated;

grant DELETE on public.cxc_v2_daily_contact_attempts_cloud to authenticated;

grant TRUNCATE on public.cxc_v2_daily_contact_attempts_cloud to authenticated;

grant REFERENCES on public.cxc_v2_daily_contact_attempts_cloud to authenticated;

grant TRIGGER on public.cxc_v2_daily_contact_attempts_cloud to authenticated;

grant MAINTAIN on public.cxc_v2_daily_contact_attempts_cloud to authenticated;

grant INSERT on public.cxc_v2_daily_contact_attempts_cloud to service_role;

grant SELECT on public.cxc_v2_daily_contact_attempts_cloud to service_role;

grant UPDATE on public.cxc_v2_daily_contact_attempts_cloud to service_role;

grant DELETE on public.cxc_v2_daily_contact_attempts_cloud to service_role;

grant TRUNCATE on public.cxc_v2_daily_contact_attempts_cloud to service_role;

grant REFERENCES on public.cxc_v2_daily_contact_attempts_cloud to service_role;

grant TRIGGER on public.cxc_v2_daily_contact_attempts_cloud to service_role;

grant MAINTAIN on public.cxc_v2_daily_contact_attempts_cloud to service_role;

grant INSERT on public.cxc_v2_notified_payment_tombstones to service_role;

grant SELECT on public.cxc_v2_notified_payment_tombstones to service_role;

grant UPDATE on public.cxc_v2_notified_payment_tombstones to service_role;

grant DELETE on public.cxc_v2_notified_payment_tombstones to service_role;

grant TRUNCATE on public.cxc_v2_notified_payment_tombstones to service_role;

grant REFERENCES on public.cxc_v2_notified_payment_tombstones to service_role;

grant TRIGGER on public.cxc_v2_notified_payment_tombstones to service_role;

grant MAINTAIN on public.cxc_v2_notified_payment_tombstones to service_role;

grant INSERT on public.cxc_v2_notified_payments_cloud to authenticated;

grant SELECT on public.cxc_v2_notified_payments_cloud to authenticated;

grant UPDATE on public.cxc_v2_notified_payments_cloud to authenticated;

grant DELETE on public.cxc_v2_notified_payments_cloud to authenticated;

grant TRUNCATE on public.cxc_v2_notified_payments_cloud to authenticated;

grant REFERENCES on public.cxc_v2_notified_payments_cloud to authenticated;

grant TRIGGER on public.cxc_v2_notified_payments_cloud to authenticated;

grant MAINTAIN on public.cxc_v2_notified_payments_cloud to authenticated;

grant INSERT on public.cxc_v2_notified_payments_cloud to service_role;

grant SELECT on public.cxc_v2_notified_payments_cloud to service_role;

grant UPDATE on public.cxc_v2_notified_payments_cloud to service_role;

grant DELETE on public.cxc_v2_notified_payments_cloud to service_role;

grant TRUNCATE on public.cxc_v2_notified_payments_cloud to service_role;

grant REFERENCES on public.cxc_v2_notified_payments_cloud to service_role;

grant TRIGGER on public.cxc_v2_notified_payments_cloud to service_role;

grant MAINTAIN on public.cxc_v2_notified_payments_cloud to service_role;

grant INSERT on public.cxc_v2_receivables_operational_reviews to authenticated;

grant SELECT on public.cxc_v2_receivables_operational_reviews to authenticated;

grant UPDATE on public.cxc_v2_receivables_operational_reviews to authenticated;

grant DELETE on public.cxc_v2_receivables_operational_reviews to authenticated;

grant TRUNCATE on public.cxc_v2_receivables_operational_reviews to authenticated;

grant REFERENCES on public.cxc_v2_receivables_operational_reviews to authenticated;

grant TRIGGER on public.cxc_v2_receivables_operational_reviews to authenticated;

grant MAINTAIN on public.cxc_v2_receivables_operational_reviews to authenticated;

grant INSERT on public.cxc_v2_receivables_operational_reviews to service_role;

grant SELECT on public.cxc_v2_receivables_operational_reviews to service_role;

grant UPDATE on public.cxc_v2_receivables_operational_reviews to service_role;

grant DELETE on public.cxc_v2_receivables_operational_reviews to service_role;

grant TRUNCATE on public.cxc_v2_receivables_operational_reviews to service_role;

grant REFERENCES on public.cxc_v2_receivables_operational_reviews to service_role;

grant TRIGGER on public.cxc_v2_receivables_operational_reviews to service_role;

grant MAINTAIN on public.cxc_v2_receivables_operational_reviews to service_role;

grant INSERT on public.cxc_v2_route_capture_events to service_role;

grant SELECT on public.cxc_v2_route_capture_events to service_role;

grant UPDATE on public.cxc_v2_route_capture_events to service_role;

grant DELETE on public.cxc_v2_route_capture_events to service_role;

grant TRUNCATE on public.cxc_v2_route_capture_events to service_role;

grant REFERENCES on public.cxc_v2_route_capture_events to service_role;

grant TRIGGER on public.cxc_v2_route_capture_events to service_role;

grant MAINTAIN on public.cxc_v2_route_capture_events to service_role;

grant SELECT on public.cxc_v2_route_capture_events to authenticated;

grant INSERT on public.cxc_v2_route_payment_reports to service_role;

grant SELECT on public.cxc_v2_route_payment_reports to service_role;

grant UPDATE on public.cxc_v2_route_payment_reports to service_role;

grant DELETE on public.cxc_v2_route_payment_reports to service_role;

grant TRUNCATE on public.cxc_v2_route_payment_reports to service_role;

grant REFERENCES on public.cxc_v2_route_payment_reports to service_role;

grant TRIGGER on public.cxc_v2_route_payment_reports to service_role;

grant MAINTAIN on public.cxc_v2_route_payment_reports to service_role;

grant SELECT on public.cxc_v2_route_payment_reports to authenticated;

grant INSERT on public.cxc_v2_route_report_payment_links to service_role;

grant SELECT on public.cxc_v2_route_report_payment_links to service_role;

grant UPDATE on public.cxc_v2_route_report_payment_links to service_role;

grant DELETE on public.cxc_v2_route_report_payment_links to service_role;

grant TRUNCATE on public.cxc_v2_route_report_payment_links to service_role;

grant REFERENCES on public.cxc_v2_route_report_payment_links to service_role;

grant TRIGGER on public.cxc_v2_route_report_payment_links to service_role;

grant MAINTAIN on public.cxc_v2_route_report_payment_links to service_role;

grant INSERT on public.cxc_v2_route_runs to service_role;

grant SELECT on public.cxc_v2_route_runs to service_role;

grant UPDATE on public.cxc_v2_route_runs to service_role;

grant DELETE on public.cxc_v2_route_runs to service_role;

grant TRUNCATE on public.cxc_v2_route_runs to service_role;

grant REFERENCES on public.cxc_v2_route_runs to service_role;

grant TRIGGER on public.cxc_v2_route_runs to service_role;

grant MAINTAIN on public.cxc_v2_route_runs to service_role;

grant SELECT on public.cxc_v2_route_runs to authenticated;

grant INSERT on public.cxc_v2_street_management_items_cloud to authenticated;

grant SELECT on public.cxc_v2_street_management_items_cloud to authenticated;

grant UPDATE on public.cxc_v2_street_management_items_cloud to authenticated;

grant DELETE on public.cxc_v2_street_management_items_cloud to authenticated;

grant TRUNCATE on public.cxc_v2_street_management_items_cloud to authenticated;

grant REFERENCES on public.cxc_v2_street_management_items_cloud to authenticated;

grant TRIGGER on public.cxc_v2_street_management_items_cloud to authenticated;

grant MAINTAIN on public.cxc_v2_street_management_items_cloud to authenticated;

grant INSERT on public.cxc_v2_street_management_items_cloud to service_role;

grant SELECT on public.cxc_v2_street_management_items_cloud to service_role;

grant UPDATE on public.cxc_v2_street_management_items_cloud to service_role;

grant DELETE on public.cxc_v2_street_management_items_cloud to service_role;

grant TRUNCATE on public.cxc_v2_street_management_items_cloud to service_role;

grant REFERENCES on public.cxc_v2_street_management_items_cloud to service_role;

grant TRIGGER on public.cxc_v2_street_management_items_cloud to service_role;

grant MAINTAIN on public.cxc_v2_street_management_items_cloud to service_role;

create policy "active_route_items_receivables_delete" on public.cxc_v2_active_route_items_cloud as PERMISSIVE for DELETE to "authenticated" using (( SELECT can_edit_owner_screen(cxc_v2_active_route_items_cloud.user_id, 'receivables'::text) AS can_edit_owner_screen));

create policy "active_route_items_receivables_insert" on public.cxc_v2_active_route_items_cloud as PERMISSIVE for INSERT to "authenticated" with check (( SELECT can_edit_owner_screen(cxc_v2_active_route_items_cloud.user_id, 'receivables'::text) AS can_edit_owner_screen));

create policy "active_route_items_receivables_update" on public.cxc_v2_active_route_items_cloud as PERMISSIVE for UPDATE to "authenticated" using (( SELECT can_edit_owner_screen(cxc_v2_active_route_items_cloud.user_id, 'receivables'::text) AS can_edit_owner_screen)) with check (( SELECT can_edit_owner_screen(cxc_v2_active_route_items_cloud.user_id, 'receivables'::text) AS can_edit_owner_screen));

create policy "active_route_items_route_search_read" on public.cxc_v2_active_route_items_cloud as PERMISSIVE for SELECT to "authenticated" using ((( SELECT can_view_owner_screen(cxc_v2_active_route_items_cloud.user_id, 'route_search'::text) AS can_view_owner_screen) OR ( SELECT can_view_owner_screen(cxc_v2_active_route_items_cloud.user_id, 'receivables'::text) AS can_view_owner_screen)));

create policy "collection_closures_cloud_receivables_delete" on public.cxc_v2_collection_closures_cloud as PERMISSIVE for DELETE to "authenticated" using (( SELECT can_edit_owner_screen(cxc_v2_collection_closures_cloud.user_id, 'receivables'::text) AS can_edit_owner_screen));

create policy "collection_closures_cloud_receivables_insert" on public.cxc_v2_collection_closures_cloud as PERMISSIVE for INSERT to "authenticated" with check (( SELECT can_edit_owner_screen(cxc_v2_collection_closures_cloud.user_id, 'receivables'::text) AS can_edit_owner_screen));

create policy "collection_closures_cloud_receivables_read" on public.cxc_v2_collection_closures_cloud as PERMISSIVE for SELECT to "authenticated" using (( SELECT can_view_owner_screen(cxc_v2_collection_closures_cloud.user_id, 'receivables'::text) AS can_view_owner_screen));

create policy "collection_closures_cloud_receivables_update" on public.cxc_v2_collection_closures_cloud as PERMISSIVE for UPDATE to "authenticated" using (( SELECT can_edit_owner_screen(cxc_v2_collection_closures_cloud.user_id, 'receivables'::text) AS can_edit_owner_screen)) with check (( SELECT can_edit_owner_screen(cxc_v2_collection_closures_cloud.user_id, 'receivables'::text) AS can_edit_owner_screen));

create policy "daily_contact_attempts_receivables_delete" on public.cxc_v2_daily_contact_attempts_cloud as PERMISSIVE for DELETE to "authenticated" using (( SELECT can_edit_owner_screen(cxc_v2_daily_contact_attempts_cloud.user_id, 'receivables'::text) AS can_edit_owner_screen));

create policy "daily_contact_attempts_receivables_insert" on public.cxc_v2_daily_contact_attempts_cloud as PERMISSIVE for INSERT to "authenticated" with check (( SELECT can_edit_owner_screen(cxc_v2_daily_contact_attempts_cloud.user_id, 'receivables'::text) AS can_edit_owner_screen));

create policy "daily_contact_attempts_receivables_read" on public.cxc_v2_daily_contact_attempts_cloud as PERMISSIVE for SELECT to "authenticated" using (( SELECT can_view_owner_screen(cxc_v2_daily_contact_attempts_cloud.user_id, 'receivables'::text) AS can_view_owner_screen));

create policy "daily_contact_attempts_receivables_update" on public.cxc_v2_daily_contact_attempts_cloud as PERMISSIVE for UPDATE to "authenticated" using (( SELECT can_edit_owner_screen(cxc_v2_daily_contact_attempts_cloud.user_id, 'receivables'::text) AS can_edit_owner_screen)) with check (( SELECT can_edit_owner_screen(cxc_v2_daily_contact_attempts_cloud.user_id, 'receivables'::text) AS can_edit_owner_screen));

create policy "notified_payments_cloud_operational_read" on public.cxc_v2_notified_payments_cloud as PERMISSIVE for SELECT to "authenticated" using ((( SELECT can_view_owner_screen(cxc_v2_notified_payments_cloud.user_id, 'payments'::text) AS can_view_owner_screen) OR ( SELECT can_view_owner_screen(cxc_v2_notified_payments_cloud.user_id, 'route_search'::text) AS can_view_owner_screen)));

create policy "notified_payments_cloud_route_insert" on public.cxc_v2_notified_payments_cloud as PERMISSIVE for INSERT to "authenticated" with check ((( SELECT can_report_route_payment(cxc_v2_notified_payments_cloud.user_id) AS can_report_route_payment) AND ((data ->> 'source'::text) = 'route'::text) AND ((data ->> 'paymentMethod'::text) = 'bank'::text)));

create policy "notified_payments_cloud_screen_delete" on public.cxc_v2_notified_payments_cloud as PERMISSIVE for DELETE to "authenticated" using (can_edit_owner_screen(user_id, 'payments'::text));

create policy "notified_payments_cloud_screen_insert" on public.cxc_v2_notified_payments_cloud as PERMISSIVE for INSERT to "authenticated" with check (can_edit_owner_screen(user_id, 'payments'::text));

create policy "notified_payments_cloud_screen_update" on public.cxc_v2_notified_payments_cloud as PERMISSIVE for UPDATE to "authenticated" using (can_edit_owner_screen(user_id, 'payments'::text)) with check (can_edit_owner_screen(user_id, 'payments'::text));

create policy "receivables_operational_reviews_read" on public.cxc_v2_receivables_operational_reviews as PERMISSIVE for SELECT to "authenticated" using (can_view_owner_screen(user_id, 'receivables'::text));

create policy "route_capture_events_read" on public.cxc_v2_route_capture_events as PERMISSIVE for SELECT to "authenticated" using (can_view_owner_screen(user_id, 'route_search'::text));

create policy "route_report_read" on public.cxc_v2_route_payment_reports as PERMISSIVE for SELECT to "authenticated" using ((can_view_owner_screen(user_id, 'route_search'::text) OR can_view_owner_screen(user_id, 'receivables'::text) OR can_view_owner_screen(user_id, 'payments'::text)));

create policy "route_runs_read" on public.cxc_v2_route_runs as PERMISSIVE for SELECT to "authenticated" using (can_view_owner_screen(user_id, 'route_search'::text));

create policy "street_management_items_receivables_delete" on public.cxc_v2_street_management_items_cloud as PERMISSIVE for DELETE to "authenticated" using (( SELECT can_edit_owner_screen(cxc_v2_street_management_items_cloud.user_id, 'receivables'::text) AS can_edit_owner_screen));

create policy "street_management_items_receivables_insert" on public.cxc_v2_street_management_items_cloud as PERMISSIVE for INSERT to "authenticated" with check (( SELECT can_edit_owner_screen(cxc_v2_street_management_items_cloud.user_id, 'receivables'::text) AS can_edit_owner_screen));

create policy "street_management_items_receivables_read" on public.cxc_v2_street_management_items_cloud as PERMISSIVE for SELECT to "authenticated" using (( SELECT can_view_owner_screen(cxc_v2_street_management_items_cloud.user_id, 'receivables'::text) AS can_view_owner_screen));

create policy "street_management_items_receivables_update" on public.cxc_v2_street_management_items_cloud as PERMISSIVE for UPDATE to "authenticated" using (( SELECT can_edit_owner_screen(cxc_v2_street_management_items_cloud.user_id, 'receivables'::text) AS can_edit_owner_screen)) with check (( SELECT can_edit_owner_screen(cxc_v2_street_management_items_cloud.user_id, 'receivables'::text) AS can_edit_owner_screen));

CREATE OR REPLACE FUNCTION public.cxc_v2_set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
;

revoke all on function public.cxc_v2_set_updated_at() from public, anon, authenticated;

grant execute on function public.cxc_v2_set_updated_at() to public;

grant execute on function public.cxc_v2_set_updated_at() to "anon";

grant execute on function public.cxc_v2_set_updated_at() to "authenticated";

grant execute on function public.cxc_v2_set_updated_at() to "service_role";

CREATE OR REPLACE FUNCTION public.cxc_v2_set_daily_contact_attempt_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.updated_at := now();
  return new;
end;
$function$
;

revoke all on function public.cxc_v2_set_daily_contact_attempt_updated_at() from public, anon, authenticated;

grant execute on function public.cxc_v2_set_daily_contact_attempt_updated_at() to public;

grant execute on function public.cxc_v2_set_daily_contact_attempt_updated_at() to "anon";

grant execute on function public.cxc_v2_set_daily_contact_attempt_updated_at() to "authenticated";

grant execute on function public.cxc_v2_set_daily_contact_attempt_updated_at() to "service_role";

CREATE OR REPLACE FUNCTION public.cxc_v2_visual_route_bank_report_matches_payment(r cxc_v2_route_payment_reports, p jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_report_amount numeric;
  v_payment_amount numeric;
  v_report_date date;
  v_payment_date date;
  v_payment_created_at timestamptz;
begin
  if r.status = 'cancelled'
    or r.bank_confirmed_visually_at is null
    or r.bank_amount <= 0
    or coalesce(p->>'paymentMethod', '') not in (
      'ACH Express',
      'Deposito Bancario',
      'Transferencia Bancaria'
    )
    or coalesce(p->>'paymentContext', 'regular') <> 'regular'
    or nullif(p->>'clientId', '') is null
    or (p->>'clientId') is distinct from r.client_id then
    return false;
  end if;

  v_report_amount := round(r.bank_amount, 2);
  v_payment_amount := round(
    (p->>'amountReceived')::numeric
      - coalesce((nullif(p->>'centavosAhorro', ''))::numeric, 0),
    2
  );
  v_report_date := (r.reported_at at time zone 'America/Panama')::date;
  v_payment_date := coalesce(
    nullif(p->>'fundsReceivedDate', ''),
    nullif(p->>'dateApplied', '')
  )::date;
  v_payment_created_at := (p->>'createdAt')::timestamptz;

  return abs(v_report_amount - v_payment_amount) <= 0.02
    and abs(v_payment_date - v_report_date) <= 7
    and v_payment_created_at >= r.reported_at;
exception when others then
  return false;
end;
$function$
;

revoke all on function public.cxc_v2_visual_route_bank_report_matches_payment(r cxc_v2_route_payment_reports, p jsonb) from public, anon, authenticated;

grant execute on function public.cxc_v2_visual_route_bank_report_matches_payment(r cxc_v2_route_payment_reports, p jsonb) to "service_role";

CREATE OR REPLACE FUNCTION public.cxc_v2_route_report_matches_payment(r cxc_v2_route_payment_reports, p jsonb)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select coalesce(p->>'clientId'=r.client_id
    and p->>'clientUnit'=r.snapshot->>'unitId'
    and coalesce(p->>'paymentContext','regular')='regular'
    and coalesce(nullif(p->>'fundsReceivedDate',''),p->>'dateApplied')=to_char(r.reported_at at time zone 'America/Panama','YYYY-MM-DD')
    and ((p->>'paymentMethod'='Efectivo'
        and r.cash_amount>0
        and trunc((p->>'amountReceived')::numeric)=trunc(r.cash_amount))
      or (p->>'paymentMethod' in ('ACH Express','Deposito Bancario','Transferencia Bancaria')
        and r.bank_amount>0
        and trunc((p->>'amountReceived')::numeric)=trunc(r.bank_amount))),false);
$function$
;

revoke all on function public.cxc_v2_route_report_matches_payment(r cxc_v2_route_payment_reports, p jsonb) from public, anon, authenticated;

grant execute on function public.cxc_v2_route_report_matches_payment(r cxc_v2_route_payment_reports, p jsonb) to "anon";

grant execute on function public.cxc_v2_route_report_matches_payment(r cxc_v2_route_payment_reports, p jsonb) to "authenticated";

grant execute on function public.cxc_v2_route_report_matches_payment(r cxc_v2_route_payment_reports, p jsonb) to "service_role";

CREATE OR REPLACE FUNCTION public.cxc_v2_reconcile_notices_when_route_activates()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_notice_id text;
begin
  if coalesce(new.data->>'removedAt', '') <> '' then return new; end if;
  for v_notice_id in
    select n.id
    from public.cxc_v2_notified_payments_cloud n
    where n.user_id = new.user_id
      and n.data->>'clientId' = new.client_id
      and coalesce(n.data->>'routeReportId', '') = ''
    order by coalesce(n.data->>'createdAt', '') desc, n.id
  loop
    perform public.cxc_v2_reconcile_notified_payment_route(new.user_id, v_notice_id);
  end loop;
  return new;
end;
$function$
;

revoke all on function public.cxc_v2_reconcile_notices_when_route_activates() from public, anon, authenticated;

grant execute on function public.cxc_v2_reconcile_notices_when_route_activates() to "service_role";

CREATE OR REPLACE FUNCTION public.cxc_v2_cancel_route_report_when_notice_deleted()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_report_id uuid;
begin
  begin
    v_report_id := nullif(old.data->>'routeReportId', '')::uuid;
  exception when others then
    return old;
  end;
  if v_report_id is null then return old; end if;

  update public.cxc_v2_route_payment_reports
  set status = 'cancelled',
      cancelled_by = coalesce(auth.uid(), old.user_id),
      cancelled_at = clock_timestamp()
  where user_id = old.user_id and id = v_report_id and status = 'review';
  return old;
end;
$function$
;

revoke all on function public.cxc_v2_cancel_route_report_when_notice_deleted() from public, anon, authenticated;

grant execute on function public.cxc_v2_cancel_route_report_when_notice_deleted() to "service_role";

CREATE OR REPLACE FUNCTION public.cxc_v2_update_active_route_zone(p_user_id uuid, p_client_id text, p_route_assignment text, p_zone text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_zone text := regexp_replace(btrim(coalesce(p_zone, '')), '\s+', ' ', 'g');
  v_updated_count integer;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesion.';
  end if;

  if not public.can_view_owner_screen(p_user_id, 'route_search') then
    raise exception 'No tienes acceso a Ruta en calle.';
  end if;

  if char_length(v_zone) > 40 then
    raise exception 'La zona no puede superar 40 caracteres.';
  end if;

  update public.cxc_v2_active_route_items_cloud
  set
    data = case
      when v_zone = '' then data - 'zone'
      else jsonb_set(data, '{zone}', to_jsonb(v_zone), true)
    end,
    updated_at = now()
  where user_id = p_user_id
    and client_id = p_client_id
    and coalesce(data ->> 'removedAt', '') = ''
    and upper(btrim(coalesce(data ->> 'routeAssignment', ''))) = upper(btrim(coalesce(p_route_assignment, '')));

  get diagnostics v_updated_count = row_count;
  if v_updated_count = 0 then
    raise exception 'La ruta cambio o el cliente ya no esta activo.';
  end if;
end;
$function$
;

revoke all on function public.cxc_v2_update_active_route_zone(p_user_id uuid, p_client_id text, p_route_assignment text, p_zone text) from public, anon, authenticated;

grant execute on function public.cxc_v2_update_active_route_zone(p_user_id uuid, p_client_id text, p_route_assignment text, p_zone text) to "anon";

grant execute on function public.cxc_v2_update_active_route_zone(p_user_id uuid, p_client_id text, p_route_assignment text, p_zone text) to "authenticated";

grant execute on function public.cxc_v2_update_active_route_zone(p_user_id uuid, p_client_id text, p_route_assignment text, p_zone text) to "service_role";

CREATE OR REPLACE FUNCTION public.cxc_v2_guard_legacy_active_route_removal()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if old.data ->> 'removedAt' is null
     and new.data ->> 'removedAt' is not null
     and new.data ->> 'removedReason' = 'removed' then
    return null;
  end if;

  return new;
end;
$function$
;

revoke all on function public.cxc_v2_guard_legacy_active_route_removal() from public, anon, authenticated;

grant execute on function public.cxc_v2_guard_legacy_active_route_removal() to public;

grant execute on function public.cxc_v2_guard_legacy_active_route_removal() to "anon";

grant execute on function public.cxc_v2_guard_legacy_active_route_removal() to "authenticated";

grant execute on function public.cxc_v2_guard_legacy_active_route_removal() to "service_role";

CREATE OR REPLACE FUNCTION public.cxc_v2_guard_active_route_management_tag()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if old.data ->> 'isRouteTagged' = 'true'
     and coalesce(new.data ->> 'isRouteTagged', 'false') <> 'true'
     and exists (
       select 1
       from public.cxc_v2_active_route_items_cloud route_item
       where route_item.user_id = new.user_id
         and route_item.client_id = new.client_id
         and route_item.data ->> 'removedAt' is null
     ) then
    return null;
  end if;

  return new;
end;
$function$
;

revoke all on function public.cxc_v2_guard_active_route_management_tag() from public, anon, authenticated;

grant execute on function public.cxc_v2_guard_active_route_management_tag() to public;

grant execute on function public.cxc_v2_guard_active_route_management_tag() to "anon";

grant execute on function public.cxc_v2_guard_active_route_management_tag() to "authenticated";

grant execute on function public.cxc_v2_guard_active_route_management_tag() to "service_role";

CREATE OR REPLACE FUNCTION public.cxc_v2_update_active_route_comment(p_user_id uuid, p_client_id text, p_comment text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_comment text := btrim(coalesce(p_comment, ''));
  v_updated_count integer;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesion.';
  end if;

  if not public.can_edit_owner_screen(p_user_id, 'route_search') then
    raise exception 'No tienes permiso para editar Ruta en calle.';
  end if;

  if char_length(v_comment) > 25 then
    raise exception 'El comentario no puede superar 25 caracteres.';
  end if;

  update public.cxc_v2_active_route_items_cloud
  set
    data = case
      when v_comment = '' then data - 'comment'
      else jsonb_set(data, '{comment}', to_jsonb(v_comment), true)
    end,
    updated_at = now()
  where user_id = p_user_id
    and client_id = p_client_id
    and coalesce(data ->> 'removedAt', '') = '';

  get diagnostics v_updated_count = row_count;
  if v_updated_count = 0 then
    raise exception 'La unidad ya no esta activa en la ruta.';
  end if;
end;
$function$
;

revoke all on function public.cxc_v2_update_active_route_comment(p_user_id uuid, p_client_id text, p_comment text) from public, anon, authenticated;

grant execute on function public.cxc_v2_update_active_route_comment(p_user_id uuid, p_client_id text, p_comment text) to "anon";

grant execute on function public.cxc_v2_update_active_route_comment(p_user_id uuid, p_client_id text, p_comment text) to "authenticated";

grant execute on function public.cxc_v2_update_active_route_comment(p_user_id uuid, p_client_id text, p_comment text) to "service_role";

CREATE OR REPLACE FUNCTION public.cxc_v2_keep_active_route_item_after_partial_payment(p_user_id uuid, p_client_id text, p_confirmed_rent_amount numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_confirmed_amount numeric := round(coalesce(p_confirmed_rent_amount, 0), 2);
  v_updated_count integer;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesion.';
  end if;

  if not public.can_edit_owner_screen(p_user_id, 'route_search') then
    raise exception 'No tienes permiso para editar Ruta en calle.';
  end if;

  if v_confirmed_amount <= 0 then
    raise exception 'El pago parcial debe ser mayor a cero.';
  end if;

  update public.cxc_v2_active_route_items_cloud
  set
    data = jsonb_set(
      jsonb_set(data, '{partialDecisionRentAmount}', to_jsonb(v_confirmed_amount), true),
      '{partialDecisionAt}',
      to_jsonb(now()),
      true
    ),
    updated_at = now()
  where user_id = p_user_id
    and client_id = p_client_id
    and coalesce(data ->> 'removedAt', '') = ''
    and coalesce((data ->> 'releaseAmount')::numeric, 0) > v_confirmed_amount;

  get diagnostics v_updated_count = row_count;
  if v_updated_count = 0 then
    raise exception 'La unidad ya no tiene un pago parcial pendiente de decision.';
  end if;
end;
$function$
;

revoke all on function public.cxc_v2_keep_active_route_item_after_partial_payment(p_user_id uuid, p_client_id text, p_confirmed_rent_amount numeric) from public, anon, authenticated;

grant execute on function public.cxc_v2_keep_active_route_item_after_partial_payment(p_user_id uuid, p_client_id text, p_confirmed_rent_amount numeric) to "anon";

grant execute on function public.cxc_v2_keep_active_route_item_after_partial_payment(p_user_id uuid, p_client_id text, p_confirmed_rent_amount numeric) to "authenticated";

grant execute on function public.cxc_v2_keep_active_route_item_after_partial_payment(p_user_id uuid, p_client_id text, p_confirmed_rent_amount numeric) to "service_role";

CREATE OR REPLACE FUNCTION public.cxc_v2_cancel_route_payment_report(p_report_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_report public.cxc_v2_route_payment_reports;
  v_can_edit_route boolean;
  v_can_edit_payments boolean;
begin
  select * into v_report from public.cxc_v2_route_payment_reports where id = p_report_id for update;
  if not found then raise exception 'No existe el reporte indicado.'; end if;

  v_can_edit_route := coalesce(public.can_edit_owner_screen(v_report.user_id, 'route_search'), false);
  v_can_edit_payments := coalesce(public.can_edit_owner_screen(v_report.user_id, 'payments'), false);
  if not coalesce(public.can_report_route_payment(v_report.user_id), false)
    or (v_report.reported_by <> auth.uid() and not v_can_edit_route and not v_can_edit_payments) then
    raise exception 'No tienes permiso para devolver este reporte.';
  end if;
  if v_report.status <> 'review' then raise exception 'Solo puedes devolver reportes pendientes.'; end if;

  update public.cxc_v2_route_payment_reports
  set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = clock_timestamp()
  where id = p_report_id;
end;
$function$
;

revoke all on function public.cxc_v2_cancel_route_payment_report(p_report_id uuid) from public, anon, authenticated;

grant execute on function public.cxc_v2_cancel_route_payment_report(p_report_id uuid) to "anon";

grant execute on function public.cxc_v2_cancel_route_payment_report(p_report_id uuid) to "authenticated";

grant execute on function public.cxc_v2_cancel_route_payment_report(p_report_id uuid) to "service_role";

CREATE OR REPLACE FUNCTION public.cxc_v2_set_active_route_custody(p_user_id uuid, p_client_id text, p_published_at text, p_in_custody boolean, p_expected_in_custody boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_item public.cxc_v2_active_route_items_cloud;
  v_capture_id uuid;
  v_run_id uuid;
  v_reporter_name text;
  v_now timestamptz := clock_timestamp();
begin
  if not coalesce(public.can_report_route_payment(p_user_id), false) then
    raise exception 'No tienes permiso para cambiar la custodia.';
  end if;
  if p_in_custody is null or p_expected_in_custody is null or p_in_custody = p_expected_in_custody then
    raise exception 'Indica un cambio de custodia válido.';
  end if;

  select * into v_item
  from public.cxc_v2_active_route_items_cloud
  where user_id = p_user_id and client_id = p_client_id
  for update;

  if not found or v_item.data->>'publishedAt' is distinct from p_published_at
    or v_item.in_custody is distinct from p_expected_in_custody
    or (p_in_custody and coalesce(v_item.data->>'removedAt','') <> '') then
    raise exception 'La unidad cambió o ya no está activa. Actualiza la ruta.';
  end if;

  if p_in_custody then
    select coalesce(nullif(email, ''), auth.uid()::text)
    into v_reporter_name
    from public.user_profiles
    where id = auth.uid();

    v_reporter_name := coalesce(v_reporter_name, auth.uid()::text);
    select run.id into v_run_id
    from public.cxc_v2_route_runs run
    where run.user_id = p_user_id
      and run.operator_id = auth.uid()
      and run.status = 'in_progress'
      and upper(btrim(run.route_assignment)) = upper(btrim(coalesce(v_item.data->>'routeAssignment', '')))
    order by run.started_at desc
    limit 1;

    if lower(v_reporter_name) ~ '^delta[0-9]+@auth\.rentautos\.local$' and v_run_id is null then
      v_run_id := public.cxc_v2_start_route_run(
        p_user_id,
        coalesce(v_item.data->>'routeAssignment', '')
      );
    end if;

    v_capture_id := gen_random_uuid();

    insert into public.cxc_v2_route_capture_events(
      id, user_id, client_id, unit_id, client_name, published_at,
      route_assignment, route_run_id, reported_by, reporter_name, reported_at
    ) values (
      v_capture_id,
      p_user_id,
      p_client_id,
      coalesce(v_item.data->>'unitId', ''),
      coalesce(v_item.data->>'clientName', ''),
      p_published_at,
      coalesce(v_item.data->>'routeAssignment', ''),
      v_run_id,
      auth.uid(),
      v_reporter_name,
      v_now
    );
  end if;

  update public.cxc_v2_active_route_items_cloud
  set in_custody = p_in_custody,
      custody_since = case when p_in_custody then v_now else null end,
      custody_changed_at = v_now,
      custody_changed_by = auth.uid(),
      updated_at = v_now,
      custody_history = custody_history || jsonb_build_array(
        jsonb_strip_nulls(jsonb_build_object(
          'inCustody', p_in_custody,
          'at', v_now,
          'by', auth.uid(),
          'unitId', data->>'unitId',
          'publishedAt', data->>'publishedAt',
          'routeAssignment', data->>'routeAssignment',
          'captureEventId', v_capture_id
        ))
      )
  where user_id = p_user_id and client_id = p_client_id;
end;
$function$
;

revoke all on function public.cxc_v2_set_active_route_custody(p_user_id uuid, p_client_id text, p_published_at text, p_in_custody boolean, p_expected_in_custody boolean) from public, anon, authenticated;

grant execute on function public.cxc_v2_set_active_route_custody(p_user_id uuid, p_client_id text, p_published_at text, p_in_custody boolean, p_expected_in_custody boolean) to "authenticated";

grant execute on function public.cxc_v2_set_active_route_custody(p_user_id uuid, p_client_id text, p_published_at text, p_in_custody boolean, p_expected_in_custody boolean) to "service_role";

CREATE OR REPLACE FUNCTION public.cxc_v2_read_route_report_receipts(p_user_id uuid, p_report_id uuid)
 RETURNS SETOF jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not (coalesce(public.can_view_owner_screen(p_user_id, 'route_search'), false) or coalesce(public.can_view_owner_screen(p_user_id, 'receivables'), false)) then
    raise exception 'No tienes permiso para ver estos recibos.';
  end if;
  return query select p.data from public.payments_cloud p
    join public.cxc_v2_route_report_payment_links l on l.user_id = p.user_id and l.payment_id = p.id
    join public.cxc_v2_route_payment_reports r on r.id = l.report_id and r.user_id = l.user_id
    where r.user_id = p_user_id and r.id = p_report_id and r.status = 'confirmed'
    order by p.id;
end;
$function$
;

revoke all on function public.cxc_v2_read_route_report_receipts(p_user_id uuid, p_report_id uuid) from public, anon, authenticated;

grant execute on function public.cxc_v2_read_route_report_receipts(p_user_id uuid, p_report_id uuid) to "authenticated";

grant execute on function public.cxc_v2_read_route_report_receipts(p_user_id uuid, p_report_id uuid) to "service_role";

CREATE OR REPLACE FUNCTION public.cxc_v2_publish_prepared_route_item(p_user_id uuid, p_item jsonb, p_expected_updated_at text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_record jsonb; v_existing jsonb; v_client_id text; v_amount numeric; v_item jsonb;
begin
  if not coalesce(public.can_edit_owner_screen(p_user_id, 'receivables'), false) then
    raise exception 'No tienes permiso para enviar unidades a ruta.';
  end if;
  v_client_id := nullif(p_item->>'clientId', '');
  if v_client_id is null then raise exception 'Falta la unidad.'; end if;
  if not exists (select 1 from public.clients_cloud where user_id=p_user_id and id=v_client_id
    and coalesce(data->>'status','activo')='activo' and nullif(data->>'archivedAt','') is null
    and data->>'unitId'=p_item->>'unitId') then
    raise exception 'El cliente o la unidad cambió o ya no está activo. Actualiza las cuentas por cobrar.';
  end if;
  -- Serializa dos publicaciones de la misma preparación, incluso sin ruta previa.
  select data into v_record from public.cxc_v2_street_management_items_cloud
    where user_id=p_user_id and client_id=v_client_id for update;
  if v_record is null or v_record->>'isRouteTagged' is distinct from 'true'
    or v_record->>'updatedAt' is distinct from p_expected_updated_at then
    raise exception 'La preparación cambió o no se ha guardado. Reintenta el envío.';
  end if;
  v_amount := coalesce(v_record->>'routeReleaseAmount', v_record->>'managementAmount')::numeric;
  if v_amount is null or v_amount <= 0 or v_amount::text in ('NaN','Infinity','-Infinity')
    or nullif(btrim(v_record->>'routeAssignment'),'') is null then
    raise exception 'Completa el monto para liberar y la ruta asignada.';
  end if;
  select data into v_existing from public.cxc_v2_active_route_items_cloud
    where user_id=p_user_id and client_id=v_client_id for update;
  if v_existing is not null and coalesce(v_existing->>'removedAt','')='' then
    return v_existing; -- Conservar publicación, decisiones, reportes y custodia.
  end if;
  if nullif(v_existing->>'removedAt','') is not null and (v_existing->>'removedAt')::timestamptz >= greatest(
    nullif(v_record->>'updatedAt','')::timestamptz,
    nullif(v_record->>'managementUpdatedAt','')::timestamptz,
    nullif(v_record->>'routeReleaseUpdatedAt','')::timestamptz,
    nullif(v_record->>'routeAssignmentUpdatedAt','')::timestamptz) then
    raise exception 'La unidad fue retirada. Vuelve a enviarla a ruta desde Gestión.';
  end if;
  v_item := (p_item - 'removedAt' - 'removedReason' - 'partialDecisionRentAmount' - 'partialDecisionAt') || jsonb_build_object(
    'releaseAmount',v_amount,'routeAssignment',v_record->>'routeAssignment',
    'managementType',coalesce(v_record->>'managementType','solo_cobrar'),
    'urgency',coalesce(v_record->>'routeUrgency','normal'),
    'comment',v_record->>'managementComment','publishedAt',clock_timestamp());
  if v_existing is null then
    insert into public.cxc_v2_active_route_items_cloud(user_id,client_id,data,updated_at)
      values(p_user_id,v_client_id,v_item,now()) on conflict(user_id,client_id) do nothing;
  else
    -- La ruta retirada ya está bloqueada y se validó la reasignación más reciente.
    update public.cxc_v2_active_route_items_cloud set data=v_item,updated_at=now()
      where user_id=p_user_id and client_id=v_client_id;
  end if;
  select data into v_item from public.cxc_v2_active_route_items_cloud where user_id=p_user_id and client_id=v_client_id;
  if nullif(v_item->>'removedAt','') is not null then raise exception 'La unidad fue retirada mientras se enviaba. Actualiza la ruta.'; end if;
  return v_item;
end;
$function$
;

revoke all on function public.cxc_v2_publish_prepared_route_item(p_user_id uuid, p_item jsonb, p_expected_updated_at text) from public, anon, authenticated;

grant execute on function public.cxc_v2_publish_prepared_route_item(p_user_id uuid, p_item jsonb, p_expected_updated_at text) to "authenticated";

grant execute on function public.cxc_v2_publish_prepared_route_item(p_user_id uuid, p_item jsonb, p_expected_updated_at text) to "service_role";

CREATE OR REPLACE FUNCTION public.cxc_v2_set_active_route_inactive_status(p_user_id uuid, p_client_id text, p_published_at text, p_inactive boolean)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_changed_at timestamptz := case when p_inactive then now() else null end;
  v_count integer;
begin
  if not coalesce(public.can_report_route_payment(p_user_id), false) then
    raise exception 'No tienes permiso para cambiar el estado de la unidad.';
  end if;

  update public.cxc_v2_active_route_items_cloud
  set
    data = case when p_inactive then
      jsonb_set(
        jsonb_set(data, '{routeInactiveAt}', to_jsonb(v_changed_at), true),
        '{routeInactiveBy}', to_jsonb(auth.uid()), true
      )
    else data - 'routeInactiveAt' - 'routeInactiveBy' end,
    updated_at = now()
  where user_id = p_user_id
    and client_id = p_client_id
    and data ->> 'publishedAt' = p_published_at
    and coalesce(data ->> 'removedAt', '') = '';

  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'La unidad cambio o ya no esta activa. Actualiza e intenta nuevamente.';
  end if;
  return v_changed_at;
end;
$function$
;

revoke all on function public.cxc_v2_set_active_route_inactive_status(p_user_id uuid, p_client_id text, p_published_at text, p_inactive boolean) from public, anon, authenticated;

grant execute on function public.cxc_v2_set_active_route_inactive_status(p_user_id uuid, p_client_id text, p_published_at text, p_inactive boolean) to "authenticated";

grant execute on function public.cxc_v2_set_active_route_inactive_status(p_user_id uuid, p_client_id text, p_published_at text, p_inactive boolean) to "service_role";

CREATE OR REPLACE FUNCTION public.cxc_v2_reconcile_notified_payment_route(p_user_id uuid, p_notice_id text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_notice jsonb;
  v_item jsonb;
  v_client_id text;
  v_published_at text;
  v_amount numeric;
  v_report public.cxc_v2_route_payment_reports;
  v_reporter uuid;
  v_reporter_name text;
begin
  select n.data into v_notice
  from public.cxc_v2_notified_payments_cloud n
  where n.user_id = p_user_id and n.id = p_notice_id
  for update;

  if not found then return null; end if;

  if coalesce(v_notice->>'routeReportId', '') <> '' then
    select r.* into v_report
    from public.cxc_v2_route_payment_reports r
    where r.user_id = p_user_id
      and r.id::text = v_notice->>'routeReportId'
      and r.status = 'review';
    if found then return v_report.id; end if;
  end if;

  v_client_id := nullif(v_notice->>'clientId', '');
  if v_client_id is null then return null; end if;
  begin
    v_amount := (v_notice->>'amount')::numeric;
  exception when others then
    return null;
  end;
  if v_amount is null or v_amount <= 0 or v_amount > 9999999999.99 or v_amount <> round(v_amount, 2) then
    return null;
  end if;

  select a.data into v_item
  from public.cxc_v2_active_route_items_cloud a
  where a.user_id = p_user_id and a.client_id = v_client_id
  for update;

  if not found or coalesce(v_item->>'removedAt', '') <> '' then return null; end if;
  v_published_at := nullif(v_item->>'publishedAt', '');
  if v_published_at is null then return null; end if;

  select r.* into v_report
  from public.cxc_v2_route_payment_reports r
  where r.user_id = p_user_id
    and r.client_id = v_client_id
    and r.published_at = v_published_at
    and r.status = 'review'
  order by r.reported_at desc, r.id
  limit 1
  for update;

  if found then
    if v_report.method <> 'bank' or v_report.bank_amount <> v_amount then return null; end if;
  else
    v_reporter := coalesce(auth.uid(), p_user_id);
    select coalesce(nullif(p.email, ''), 'Pagos') into v_reporter_name
    from public.user_profiles p where p.id = v_reporter;
    v_reporter_name := coalesce(v_reporter_name, 'Pagos');

    insert into public.cxc_v2_route_payment_reports(
      user_id, client_id, published_at, snapshot, amount, method,
      cash_amount, bank_amount, reported_by, reporter_name
    ) values (
      p_user_id, v_client_id, v_published_at, v_item, v_amount, 'bank',
      0, v_amount, v_reporter, v_reporter_name
    )
    returning * into v_report;
  end if;

  -- Un reporte representa un solo aviso. Los duplicados permanecen solo en Pagos.
  if exists (
    select 1 from public.cxc_v2_notified_payments_cloud n
    where n.user_id = p_user_id
      and n.id <> p_notice_id
      and n.data->>'routeReportId' = v_report.id::text
  ) then return null; end if;

  update public.cxc_v2_notified_payments_cloud
  set data = data || jsonb_build_object(
    'routeReportId', v_report.id::text,
    'routePaymentMethod', 'bank',
    'routeAssignment', coalesce(v_item->>'routeAssignment', '')
  ),
  updated_at = clock_timestamp()
  where user_id = p_user_id and id = p_notice_id;

  return v_report.id;
end;
$function$
;

revoke all on function public.cxc_v2_reconcile_notified_payment_route(p_user_id uuid, p_notice_id text) from public, anon, authenticated;

grant execute on function public.cxc_v2_reconcile_notified_payment_route(p_user_id uuid, p_notice_id text) to "service_role";

CREATE OR REPLACE FUNCTION public.cxc_v2_change_active_route_assignment(p_user_id uuid, p_client_id text, p_published_at text, p_previous_route text, p_route text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_count integer;
  v_previous_route text;
  v_route text;
begin
  if not coalesce(public.can_report_route_payment(p_user_id), false) then
    raise exception 'No tienes permiso para cambiar la ruta.';
  end if;

  v_previous_route := upper(btrim(regexp_replace(coalesce(p_previous_route, ''), '[[:space:]]+', ' ', 'g')));
  v_route := upper(btrim(regexp_replace(coalesce(p_route, ''), '[[:space:]]+', ' ', 'g')));

  if v_route = '' or char_length(v_route) > 12 then
    raise exception 'La ruta debe tener entre 1 y 12 caracteres.';
  end if;

  update public.cxc_v2_active_route_items_cloud
  set data = jsonb_set(
        jsonb_set(
          jsonb_set(data, '{routeAssignment}', to_jsonb(v_route)),
          '{routeChangedBy}', to_jsonb(auth.uid())
        ),
        '{routeChangedAt}', to_jsonb(now())
      ),
      updated_at = now()
  where user_id = p_user_id
    and client_id = p_client_id
    and data->>'publishedAt' = p_published_at
    and upper(btrim(regexp_replace(coalesce(data->>'routeAssignment', ''), '[[:space:]]+', ' ', 'g'))) = v_previous_route
    and coalesce(data->>'removedAt','') = '';

  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'La ruta cambió o la unidad ya no está activa. Actualiza e intenta nuevamente.';
  end if;
end;
$function$
;

revoke all on function public.cxc_v2_change_active_route_assignment(p_user_id uuid, p_client_id text, p_published_at text, p_previous_route text, p_route text) from public, anon, authenticated;

grant execute on function public.cxc_v2_change_active_route_assignment(p_user_id uuid, p_client_id text, p_published_at text, p_previous_route text, p_route text) to "authenticated";

grant execute on function public.cxc_v2_change_active_route_assignment(p_user_id uuid, p_client_id text, p_published_at text, p_previous_route text, p_route text) to "service_role";

CREATE OR REPLACE FUNCTION public.cxc_v2_remove_notified_payment_for_closed_route_report()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.status <> 'review' then
    delete from public.cxc_v2_notified_payments_cloud
    where user_id = new.user_id and data->>'routeReportId' = new.id::text;
  end if;
  return new;
end;
$function$
;

revoke all on function public.cxc_v2_remove_notified_payment_for_closed_route_report() from public, anon, authenticated;

grant execute on function public.cxc_v2_remove_notified_payment_for_closed_route_report() to "service_role";

CREATE OR REPLACE FUNCTION public.cxc_v2_reconcile_notified_payment_route_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if coalesce(new.data->>'routeReportId', '') = '' then
    perform public.cxc_v2_reconcile_notified_payment_route(new.user_id, new.id);
  end if;
  return new;
end;
$function$
;

revoke all on function public.cxc_v2_reconcile_notified_payment_route_trigger() from public, anon, authenticated;

grant execute on function public.cxc_v2_reconcile_notified_payment_route_trigger() to "service_role";

CREATE OR REPLACE FUNCTION public.cxc_v2_report_route_payment_split(p_user_id uuid, p_client_id text, p_published_at text, p_cash_amount numeric, p_bank_amount numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_item jsonb;
  v_name text;
  v_method text;
begin
  if not coalesce(public.can_report_route_payment(p_user_id),false) then
    raise exception 'No tienes permiso para reportar pagos.';
  end if;
  if p_cash_amount is null or p_bank_amount is null
    or p_cash_amount::text in ('NaN','Infinity','-Infinity') or p_bank_amount::text in ('NaN','Infinity','-Infinity')
    or p_cash_amount<0 or p_bank_amount<0 or p_cash_amount+p_bank_amount<=0
    or p_cash_amount+p_bank_amount>9999999999.99
    or p_cash_amount<>round(p_cash_amount,2) or p_bank_amount<>round(p_bank_amount,2) then
    raise exception 'Indica importes válidos de efectivo y banca, con hasta dos decimales.';
  end if;

  select data into v_item
  from public.cxc_v2_active_route_items_cloud
  where user_id=p_user_id and client_id=p_client_id
  for update;

  if v_item is null or coalesce(v_item->>'removedAt','')<>'' or (v_item->>'publishedAt') is distinct from p_published_at then
    raise exception 'La unidad cambió o ya no está activa. Actualiza la ruta.';
  end if;

  v_method:=case
    when p_cash_amount>0 and p_bank_amount>0 then 'mixed'
    when p_cash_amount>0 then 'cash'
    else 'bank'
  end;
  select coalesce(nullif(email,''),'Buscador') into v_name
  from public.user_profiles
  where id=auth.uid();

  insert into public.cxc_v2_route_payment_reports(
    user_id,client_id,published_at,snapshot,amount,method,
    cash_amount,bank_amount,reported_by,reporter_name
  ) values (
    p_user_id,p_client_id,p_published_at,v_item,p_cash_amount+p_bank_amount,v_method,
    p_cash_amount,p_bank_amount,auth.uid(),coalesce(v_name,'Buscador')
  );
end;
$function$
;

revoke all on function public.cxc_v2_report_route_payment_split(p_user_id uuid, p_client_id text, p_published_at text, p_cash_amount numeric, p_bank_amount numeric) from public, anon, authenticated;

grant execute on function public.cxc_v2_report_route_payment_split(p_user_id uuid, p_client_id text, p_published_at text, p_cash_amount numeric, p_bank_amount numeric) to "authenticated";

grant execute on function public.cxc_v2_report_route_payment_split(p_user_id uuid, p_client_id text, p_published_at text, p_cash_amount numeric, p_bank_amount numeric) to "service_role";

CREATE OR REPLACE FUNCTION public.cxc_v2_record_notified_payment_tombstone()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  insert into public.cxc_v2_notified_payment_tombstones(user_id, notice_id, reason)
  values(old.user_id, old.id, 'deleted')
  on conflict (user_id, notice_id) do nothing;
  return old;
end;
$function$
;

revoke all on function public.cxc_v2_record_notified_payment_tombstone() from public, anon, authenticated;

grant execute on function public.cxc_v2_record_notified_payment_tombstone() to "service_role";

CREATE OR REPLACE FUNCTION public.cxc_v2_block_consumed_notified_payment_restore()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_payment_id text;
  v_claimed integer;
begin
  if exists (
    select 1
    from public.cxc_v2_notified_payment_tombstones t
    where t.user_id = new.user_id and t.notice_id = new.id
  ) then return null; end if;

  if tg_op = 'INSERT' then
    select p.id into v_payment_id
    from public.payments_cloud p
    where p.user_id = new.user_id
      and public.notified_payment_matches_bank_payment(new.data, p.data)
      and not exists (
        select 1
        from public.cxc_v2_notified_payment_tombstones t
        where t.user_id = p.user_id
          and t.consumed_by_payment_id = p.id
      )
    order by (p.data->>'createdAt')::timestamptz, p.id
    limit 1
    for update;

    if v_payment_id is not null then
      insert into public.cxc_v2_notified_payment_tombstones(
        user_id,
        notice_id,
        consumed_by_payment_id,
        reason
      ) values (
        new.user_id,
        new.id,
        v_payment_id,
        'bank_payment_already_applied'
      )
      on conflict do nothing;
      get diagnostics v_claimed = row_count;
      if v_claimed > 0 then return null; end if;
    end if;
  end if;

  return new;
end;
$function$
;

revoke all on function public.cxc_v2_block_consumed_notified_payment_restore() from public, anon, authenticated;

grant execute on function public.cxc_v2_block_consumed_notified_payment_restore() to "service_role";

CREATE OR REPLACE FUNCTION public.cxc_v2_remove_active_route_item_from_search(p_user_id uuid, p_client_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_updated_count integer;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesion.';
  end if;

  if coalesce(public.current_user_role()::text = 'buscador', false) then
    raise exception 'Las cuentas Delta no pueden sacar autos de Ruta en calle.';
  end if;

  if not coalesce(public.can_edit_owner_screen(p_user_id, 'route_search'), false) then
    raise exception 'No tienes permiso para editar Ruta en calle.';
  end if;

  update public.cxc_v2_active_route_items_cloud
  set
    data = jsonb_set(
      jsonb_set(
        jsonb_set(data, '{removedAt}', to_jsonb(clock_timestamp()), true),
        '{removedReason}',
        to_jsonb('route_editor_removed'::text),
        true
      ),
      '{removedBy}',
      to_jsonb(auth.uid()),
      true
    ),
    in_custody = false,
    custody_since = null,
    custody_changed_at = case when in_custody then clock_timestamp() else custody_changed_at end,
    custody_changed_by = case when in_custody then auth.uid() else custody_changed_by end,
    custody_history = case
      when in_custody then custody_history || jsonb_build_array(jsonb_build_object(
        'inCustody', false,
        'at', clock_timestamp(),
        'by', auth.uid(),
        'unitId', data ->> 'unitId',
        'publishedAt', data ->> 'publishedAt',
        'reason', 'route_removed'
      ))
      else custody_history
    end,
    updated_at = clock_timestamp()
  where user_id = p_user_id
    and client_id = p_client_id
    and coalesce(data ->> 'removedAt', '') = '';

  get diagnostics v_updated_count = row_count;
  if v_updated_count = 0 then
    raise exception 'La unidad ya no esta activa en la ruta.';
  end if;
end;
$function$
;

revoke all on function public.cxc_v2_remove_active_route_item_from_search(p_user_id uuid, p_client_id text) from public, anon, authenticated;

grant execute on function public.cxc_v2_remove_active_route_item_from_search(p_user_id uuid, p_client_id text) to "anon";

grant execute on function public.cxc_v2_remove_active_route_item_from_search(p_user_id uuid, p_client_id text) to "authenticated";

grant execute on function public.cxc_v2_remove_active_route_item_from_search(p_user_id uuid, p_client_id text) to "service_role";

CREATE OR REPLACE FUNCTION public.cxc_v2_sync_route_payment_report()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_report_id uuid;
  v_method text;
  v_link_method text;
  v_report public.cxc_v2_route_payment_reports;
begin
  if tg_op in ('UPDATE','DELETE') then
    select report_id, method into v_report_id, v_link_method
    from public.cxc_v2_route_report_payment_links
    where user_id = old.user_id and payment_id = old.id;

    if v_report_id is not null then
      select * into v_report
      from public.cxc_v2_route_payment_reports
      where id = v_report_id
      for update;

      if tg_op = 'DELETE' then
        if v_link_method = 'cash' and coalesce(old.data->>'source', '') = 'route' then
          delete from public.cxc_v2_route_report_payment_links
          where report_id = v_report_id;

          update public.cxc_v2_route_payment_reports
          set status = 'cancelled',
              cancelled_by = coalesce(auth.uid(), old.user_id),
              cancelled_at = clock_timestamp(),
              confirmed_cash_amount = 0,
              confirmed_bank_amount = 0,
              confirmed_payment_id = null,
              confirmed_at = null
          where id = v_report_id;
        else
          delete from public.cxc_v2_route_report_payment_links
          where user_id = old.user_id and payment_id = old.id;
          perform public.cxc_v2_refresh_route_report_confirmation(v_report_id);
        end if;
      else
        v_method := case
          when new.data->>'paymentMethod' = 'Efectivo' then 'cash'
          when new.data->>'paymentMethod' in ('ACH Express','Deposito Bancario','Transferencia Bancaria') then 'bank'
        end;
        if new.user_id is distinct from old.user_id
          or new.id is distinct from old.id
          or v_method is distinct from v_link_method
          or not public.cxc_v2_route_report_matches_payment(v_report, new.data) then
          delete from public.cxc_v2_route_report_payment_links
          where user_id = old.user_id and payment_id = old.id;
        end if;
        perform public.cxc_v2_refresh_route_report_confirmation(v_report_id);
      end if;
    end if;

    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  v_method := case
    when new.data->>'paymentMethod' = 'Efectivo' then 'cash'
    when new.data->>'paymentMethod' in ('ACH Express','Deposito Bancario','Transferencia Bancaria') then 'bank'
  end;
  if v_method is null then return new; end if;

  -- El efectivo generado desde el mismo formulario de Ruta identifica su
  -- reporte de forma inequívoca. Se conservan las validaciones de cliente,
  -- unidad, fecha, método y monto antes de crear el vínculo.
  if v_method = 'cash'
     and coalesce(new.data->>'source', '') = 'route'
     and coalesce(new.data->>'cxcV2RouteReportId', '') <> '' then
    select * into v_report
    from public.cxc_v2_route_payment_reports r
    where r.id::text = new.data->>'cxcV2RouteReportId'
      and r.user_id = new.user_id
      and r.status = 'review'
    for update;

    if not found or not public.cxc_v2_route_report_matches_payment(v_report, new.data) then
      raise exception 'El recibo de efectivo no coincide con su aviso de Ruta. Actualiza y vuelve a intentar.';
    end if;

    insert into public.cxc_v2_route_report_payment_links(report_id, user_id, payment_id, method)
    values(v_report.id, new.user_id, new.id, 'cash');
    perform public.cxc_v2_refresh_route_report_confirmation(v_report.id);
    return new;
  end if;

  -- Compatibilidad para pagos creados por versiones anteriores.
  for v_report in
    select r.*
    from public.cxc_v2_route_payment_reports r
    where r.user_id = new.user_id
      and r.status = 'review'
      and public.cxc_v2_route_report_matches_payment(r, new.data)
      and (new.data->>'createdAt')::timestamptz >= r.reported_at
    order by r.reported_at desc
    for update
  loop
    if not exists (
      select 1 from public.cxc_v2_route_report_payment_links
      where report_id = v_report.id and method = v_method
    ) then
      insert into public.cxc_v2_route_report_payment_links(report_id, user_id, payment_id, method)
      values(v_report.id, new.user_id, new.id, v_method);
      perform public.cxc_v2_refresh_route_report_confirmation(v_report.id);
      exit;
    end if;
  end loop;
  return new;
end;
$function$
;

revoke all on function public.cxc_v2_sync_route_payment_report() from public, anon, authenticated;

grant execute on function public.cxc_v2_sync_route_payment_report() to "service_role";

CREATE OR REPLACE FUNCTION public.cxc_v2_confirm_route_bank_report(p_report_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_report public.cxc_v2_route_payment_reports;
  v_route public.cxc_v2_active_route_items_cloud;
  v_pending_bank numeric(12,2);
  v_release_amount numeric(12,2);
  v_report_confirmed_amount numeric(12,2);
  v_previous_decision_amount numeric(12,2);
  v_confirmed_amount numeric(12,2);
  v_complete boolean;
  v_now timestamptz := clock_timestamp();
  v_outcome text := 'decision';
begin
  select * into v_report
  from public.cxc_v2_route_payment_reports
  where id = p_report_id
  for update;

  if not found or not coalesce(public.can_confirm_route_bank_payment(v_report.user_id), false) then
    raise exception 'Solo el administrador con acceso a Pagos y Ruta puede confirmar banca.';
  end if;

  v_pending_bank := round(v_report.bank_amount - v_report.confirmed_bank_amount, 2);
  if v_report.status <> 'review' or v_pending_bank <= 0 then
    raise exception 'Este pago bancario ya fue confirmado o cambio. Actualiza la ruta.';
  end if;

  select * into v_route
  from public.cxc_v2_active_route_items_cloud
  where user_id = v_report.user_id and client_id = v_report.client_id
  for update;

  if not found
    or coalesce(v_route.data->>'removedAt', '') <> ''
    or (v_route.data->>'publishedAt') is distinct from v_report.published_at then
    raise exception 'La unidad cambio o ya no esta activa. Actualiza la ruta.';
  end if;

  v_complete := v_report.cash_amount = 0 or v_report.confirmed_cash_amount >= v_report.cash_amount;
  update public.cxc_v2_route_payment_reports set
    confirmed_bank_amount = bank_amount,
    confirmed_bank_received_amount = bank_amount,
    confirmed_bank_savings_amount = 0,
    bank_confirmed_visually_at = v_now,
    bank_confirmed_visually_by = auth.uid(),
    status = case when v_complete then 'confirmed' else 'review' end,
    confirmed_at = case when v_complete then v_now else null end,
    confirmed_payment_id = null
  where id = v_report.id;

  select round(coalesce(sum(
    confirmed_cash_amount
    + case when bank_confirmed_visually_at is not null then confirmed_bank_amount else 0 end
  ), 0), 2)
  into v_report_confirmed_amount
  from public.cxc_v2_route_payment_reports
  where user_id = v_report.user_id
    and client_id = v_report.client_id
    and published_at = v_report.published_at
    and status <> 'cancelled';

  v_release_amount := round(coalesce((v_route.data->>'releaseAmount')::numeric, 0), 2);
  v_previous_decision_amount := round(coalesce((v_route.data->>'partialDecisionRentAmount')::numeric, 0), 2);
  v_confirmed_amount := greatest(
    coalesce(v_report_confirmed_amount, 0),
    v_previous_decision_amount + v_pending_bank
  );

  if v_release_amount > 0 and v_confirmed_amount >= v_release_amount then
    update public.cxc_v2_active_route_items_cloud
    set
      data = jsonb_set(
        jsonb_set(data, '{removedAt}', to_jsonb(v_now), true),
        '{removedReason}',
        to_jsonb('bank_confirmed_amount_met'::text),
        true
      ),
      in_custody = false,
      custody_since = null,
      custody_changed_at = case when in_custody then v_now else custody_changed_at end,
      custody_changed_by = case when in_custody then auth.uid() else custody_changed_by end,
      custody_history = case
        when in_custody then custody_history || jsonb_build_array(jsonb_build_object(
          'inCustody', false,
          'at', v_now,
          'by', auth.uid(),
          'unitId', data->>'unitId',
          'publishedAt', data->>'publishedAt',
          'reason', 'bank_confirmed_amount_met'
        ))
        else custody_history
      end,
      updated_at = v_now
    where user_id = v_report.user_id and client_id = v_report.client_id;
    v_outcome := 'removed';
  end if;

  return jsonb_build_object(
    'outcome', v_outcome,
    'confirmedAmount', v_confirmed_amount,
    'releaseAmount', v_release_amount
  );
end;
$function$
;

revoke all on function public.cxc_v2_confirm_route_bank_report(p_report_id uuid) from public, anon, authenticated;

grant execute on function public.cxc_v2_confirm_route_bank_report(p_report_id uuid) to "authenticated";

grant execute on function public.cxc_v2_confirm_route_bank_report(p_report_id uuid) to "service_role";

CREATE OR REPLACE FUNCTION public.cxc_v2_refresh_route_report_confirmation(p_report_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r public.cxc_v2_route_payment_reports;
  v_cash boolean;
  v_linked_bank boolean;
  v_visual_bank boolean;
  v_bank boolean;
  v_complete boolean;
  v_bank_payment jsonb;
begin
  select * into r from public.cxc_v2_route_payment_reports where id = p_report_id for update;
  if not found or r.status = 'cancelled' then return; end if;

  select
    exists(select 1 from public.cxc_v2_route_report_payment_links where report_id = r.id and method = 'cash'),
    exists(select 1 from public.cxc_v2_route_report_payment_links where report_id = r.id and method = 'bank')
  into v_cash, v_linked_bank;
  v_visual_bank := r.bank_confirmed_visually_at is not null;
  v_bank := v_linked_bank or v_visual_bank;

  if v_linked_bank then
    select p.data into v_bank_payment
    from public.cxc_v2_route_report_payment_links l
    join public.payments_cloud p on p.user_id = l.user_id and p.id = l.payment_id
    where l.report_id = r.id and l.method = 'bank'
    limit 1;
  end if;

  v_complete := (r.cash_amount = 0 or v_cash) and (r.bank_amount = 0 or v_bank);
  update public.cxc_v2_route_payment_reports set
    confirmed_cash_amount = case when v_cash then cash_amount else 0 end,
    confirmed_bank_amount = case when v_bank then bank_amount else 0 end,
    confirmed_bank_received_amount = case
      when v_linked_bank then coalesce((v_bank_payment->>'amountReceived')::numeric, bank_amount)
      when v_visual_bank then bank_amount
      else 0
    end,
    confirmed_bank_savings_amount = case
      when v_linked_bank then coalesce((nullif(v_bank_payment->>'centavosAhorro',''))::numeric, 0)
      else 0
    end,
    status = case when v_complete then 'confirmed' else 'review' end,
    confirmed_at = case when v_complete then coalesce(confirmed_at, clock_timestamp()) else null end,
    confirmed_payment_id = case when v_complete and method <> 'mixed' and not v_visual_bank then
      (select payment_id from public.cxc_v2_route_report_payment_links where report_id = r.id limit 1)
      else null
    end
  where id = r.id;
end;
$function$
;

revoke all on function public.cxc_v2_refresh_route_report_confirmation(p_report_id uuid) from public, anon, authenticated;

grant execute on function public.cxc_v2_refresh_route_report_confirmation(p_report_id uuid) to "service_role";

CREATE OR REPLACE FUNCTION public.cxc_v2_sync_visual_route_bank_payment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_report public.cxc_v2_route_payment_reports;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    select * into v_report
    from public.cxc_v2_route_payment_reports
    where user_id = old.user_id
      and bank_settled_payment_id = old.id
    for update;

    if found and (
      tg_op = 'DELETE'
      or new.user_id is distinct from old.user_id
      or new.id is distinct from old.id
      or not public.cxc_v2_visual_route_bank_report_matches_payment(v_report, new.data)
    ) then
      update public.cxc_v2_route_payment_reports
      set bank_settled_payment_id = null,
          bank_settled_at = null
      where id = v_report.id;
    end if;

    if tg_op = 'DELETE' then return old; end if;
  end if;

  if coalesce(new.data->>'paymentMethod', '') not in (
    'ACH Express',
    'Deposito Bancario',
    'Transferencia Bancaria'
  ) or coalesce(new.data->>'paymentContext', 'regular') <> 'regular' then
    return new;
  end if;

  select r.* into v_report
  from public.cxc_v2_route_report_payment_links link
  join public.cxc_v2_route_payment_reports r
    on r.id = link.report_id and r.user_id = link.user_id
  where link.user_id = new.user_id
    and link.payment_id = new.id
    and link.method = 'bank'
    and r.bank_confirmed_visually_at is not null
  limit 1
  for update of r;

  if found then
    update public.cxc_v2_route_payment_reports
    set bank_settled_payment_id = new.id,
        bank_settled_at = clock_timestamp()
    where id = v_report.id
      and bank_settled_payment_id is null;
    return new;
  end if;

  if exists (
    select 1
    from public.cxc_v2_route_payment_reports
    where user_id = new.user_id and bank_settled_payment_id = new.id
  ) or exists (
    select 1
    from public.cxc_v2_route_payment_reports
    where user_id = new.user_id and confirmed_payment_id = new.id
  ) or exists (
    select 1
    from public.cxc_v2_route_report_payment_links
    where user_id = new.user_id and payment_id = new.id
  ) then
    return new;
  end if;

  select * into v_report
  from public.cxc_v2_route_payment_reports r
  where r.user_id = new.user_id
    and r.status <> 'cancelled'
    and r.bank_confirmed_visually_at is not null
    and r.bank_settled_payment_id is null
    and public.cxc_v2_visual_route_bank_report_matches_payment(r, new.data)
  order by r.reported_at, r.id
  limit 1
  for update skip locked;

  if found then
    update public.cxc_v2_route_payment_reports
    set bank_settled_payment_id = new.id,
        bank_settled_at = clock_timestamp()
    where id = v_report.id
      and bank_settled_payment_id is null;
  end if;

  return new;
end;
$function$
;

revoke all on function public.cxc_v2_sync_visual_route_bank_payment() from public, anon, authenticated;

grant execute on function public.cxc_v2_sync_visual_route_bank_payment() to "service_role";

CREATE OR REPLACE FUNCTION public.cxc_v2_settle_visual_route_bank_report_after_confirmation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.bank_confirmed_visually_at is not null
    and new.bank_settled_payment_id is null then
    perform public.cxc_v2_settle_visual_route_bank_report(new.id);
  end if;
  return new;
end;
$function$
;

revoke all on function public.cxc_v2_settle_visual_route_bank_report_after_confirmation() from public, anon, authenticated;

grant execute on function public.cxc_v2_settle_visual_route_bank_report_after_confirmation() to "service_role";

CREATE OR REPLACE FUNCTION public.cxc_v2_start_route_run(p_user_id uuid, p_route text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_route text := upper(btrim(regexp_replace(coalesce(p_route, ''), '[[:space:]]+', ' ', 'g')));
  v_email text;
  v_expected_route text;
  v_id uuid;
begin
  if not coalesce(public.can_report_route_payment(p_user_id), false) then
    raise exception 'No tienes permiso para iniciar la ruta.';
  end if;
  if v_route = '' or char_length(v_route) > 12 then
    raise exception 'La ruta debe tener entre 1 y 12 caracteres.';
  end if;

  select lower(coalesce(email, '')) into v_email
  from public.user_profiles
  where id = auth.uid();

  v_expected_route := case v_email
    when 'delta1@auth.rentautos.local' then 'PTY'
    when 'delta2@auth.rentautos.local' then 'WC'
    when 'delta3@auth.rentautos.local' then 'PTY'
    else null
  end;
  if v_expected_route is not null and v_route <> v_expected_route then
    raise exception 'La ruta asignada a este Delta es %.', v_expected_route;
  end if;

  insert into public.cxc_v2_route_runs(user_id, route_assignment, operator_id, operator_name)
  values (p_user_id, v_route, auth.uid(), coalesce(nullif(v_email, ''), auth.uid()::text))
  returning id into v_id;
  return v_id;
exception
  when unique_violation then
    raise exception 'Ya tienes una ruta en curso. Ciérrala antes de iniciar otra.';
end;
$function$
;

revoke all on function public.cxc_v2_start_route_run(p_user_id uuid, p_route text) from public, anon, authenticated;

grant execute on function public.cxc_v2_start_route_run(p_user_id uuid, p_route text) to "authenticated";

grant execute on function public.cxc_v2_start_route_run(p_user_id uuid, p_route text) to "service_role";

CREATE OR REPLACE FUNCTION public.cxc_v2_submit_route_run(p_run_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_run public.cxc_v2_route_runs;
begin
  select * into v_run from public.cxc_v2_route_runs where id = p_run_id for update;
  if not found then raise exception 'No existe la ruta indicada.'; end if;
  if v_run.operator_id <> auth.uid()
    and not (coalesce(public.is_admin(), false) and coalesce(public.can_edit_owner_screen(v_run.user_id, 'route_search'), false)) then
    raise exception 'Solo el Delta responsable puede cerrar esta ruta.';
  end if;
  if v_run.status <> 'in_progress' then raise exception 'La ruta ya fue cerrada.'; end if;

  update public.cxc_v2_route_runs
  set status = 'pending', submitted_at = clock_timestamp()
  where id = p_run_id;
end;
$function$
;

revoke all on function public.cxc_v2_submit_route_run(p_run_id uuid) from public, anon, authenticated;

grant execute on function public.cxc_v2_submit_route_run(p_run_id uuid) to "authenticated";

grant execute on function public.cxc_v2_submit_route_run(p_run_id uuid) to "service_role";

CREATE OR REPLACE FUNCTION public.cxc_v2_confirm_route_run(p_run_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_run public.cxc_v2_route_runs;
begin
  select * into v_run from public.cxc_v2_route_runs where id = p_run_id for update;
  if not found then raise exception 'No existe la ruta indicada.'; end if;
  if not coalesce(public.is_admin(), false)
    or not coalesce(public.can_edit_owner_screen(v_run.user_id, 'route_search'), false) then
    raise exception 'Solo un administrador de Ruta en calle puede confirmar rutas.';
  end if;
  if v_run.status <> 'pending' then raise exception 'La ruta no está pendiente de confirmación.'; end if;
  if exists (
    select 1 from public.cxc_v2_route_capture_events
    where route_run_id = p_run_id and status = 'pending'
  ) then
    raise exception 'Confirma primero todas las captaciones de esta ruta.';
  end if;

  update public.cxc_v2_route_runs
  set status = 'confirmed', confirmed_by = auth.uid(), confirmed_at = clock_timestamp()
  where id = p_run_id;
end;
$function$
;

revoke all on function public.cxc_v2_confirm_route_run(p_run_id uuid) from public, anon, authenticated;

grant execute on function public.cxc_v2_confirm_route_run(p_run_id uuid) to "authenticated";

grant execute on function public.cxc_v2_confirm_route_run(p_run_id uuid) to "service_role";

CREATE OR REPLACE FUNCTION public.cxc_v2_confirm_route_capture(p_capture_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_capture public.cxc_v2_route_capture_events;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión.';
  end if;

  select * into v_capture
  from public.cxc_v2_route_capture_events
  where id = p_capture_id
  for update;

  if not found then
    raise exception 'No existe la captación indicada.';
  end if;
  if not coalesce(public.is_admin(), false)
    or not coalesce(public.can_edit_owner_screen(v_capture.user_id, 'route_search'), false) then
    raise exception 'Solo un administrador de Ruta en calle puede confirmar captaciones.';
  end if;
  if v_capture.status <> 'pending' then
    raise exception 'La captación ya fue confirmada.';
  end if;

  update public.cxc_v2_route_capture_events
  set status = 'confirmed',
      confirmed_by = auth.uid(),
      confirmed_at = clock_timestamp()
  where id = p_capture_id;
end;
$function$
;

revoke all on function public.cxc_v2_confirm_route_capture(p_capture_id uuid) from public, anon, authenticated;

grant execute on function public.cxc_v2_confirm_route_capture(p_capture_id uuid) to "authenticated";

grant execute on function public.cxc_v2_confirm_route_capture(p_capture_id uuid) to "service_role";

CREATE OR REPLACE FUNCTION public.cxc_v2_close_route_capture_on_custody_exit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if old.in_custody and not new.in_custody then
    update public.cxc_v2_route_capture_events
    set released_at = coalesce(released_at, clock_timestamp())
    where user_id = new.user_id
      and client_id = new.client_id
      and released_at is null;
  end if;
  return new;
end;
$function$
;

revoke all on function public.cxc_v2_close_route_capture_on_custody_exit() from public, anon, authenticated;

grant execute on function public.cxc_v2_close_route_capture_on_custody_exit() to "service_role";

CREATE OR REPLACE FUNCTION public.cxc_v2_settle_visual_route_bank_report(p_report_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_report public.cxc_v2_route_payment_reports;
  v_payment_id text;
begin
  select * into v_report
  from public.cxc_v2_route_payment_reports
  where id = p_report_id
  for update;

  if not found
    or v_report.status = 'cancelled'
    or v_report.bank_confirmed_visually_at is null
    or v_report.bank_settled_payment_id is not null then
    return;
  end if;

  select p.id into v_payment_id
  from public.payments_cloud p
  where p.user_id = v_report.user_id
    and p.data->>'clientId' = v_report.client_id
    and p.data->>'paymentMethod' in (
      'ACH Express',
      'Deposito Bancario',
      'Transferencia Bancaria'
    )
    and coalesce(p.data->>'paymentContext', 'regular') = 'regular'
    and public.cxc_v2_visual_route_bank_report_matches_payment(v_report, p.data)
    and not exists (
      select 1
      from public.cxc_v2_route_payment_reports other_report
      where other_report.user_id = p.user_id
        and other_report.id <> v_report.id
        and (
          other_report.confirmed_payment_id = p.id
          or other_report.bank_settled_payment_id = p.id
        )
    )
    and not exists (
      select 1
      from public.cxc_v2_route_report_payment_links link
      where link.user_id = p.user_id
        and link.payment_id = p.id
        and link.report_id <> v_report.id
    )
  order by (p.data->>'createdAt')::timestamptz, p.id
  limit 1
  for update of p skip locked;

  if v_payment_id is null then return; end if;

  update public.cxc_v2_route_payment_reports
  set bank_settled_payment_id = v_payment_id,
      bank_settled_at = clock_timestamp()
  where id = v_report.id
    and bank_settled_payment_id is null;
end;
$function$
;

revoke all on function public.cxc_v2_settle_visual_route_bank_report(p_report_id uuid) from public, anon, authenticated;

grant execute on function public.cxc_v2_settle_visual_route_bank_report(p_report_id uuid) to "service_role";

CREATE OR REPLACE FUNCTION public.cxc_v2_assign_active_route_pty_delta()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_route text;
  v_previous_route text;
  v_current text;
  v_default_delta text;
  v_route_changed boolean := true;
begin
  v_route := upper(btrim(regexp_replace(coalesce(new.data->>'routeAssignment', ''), '[[:space:]]+', ' ', 'g')));
  v_current := lower(btrim(coalesce(new.data->>'assignedDelta', '')));

  if tg_op = 'UPDATE' then
    v_previous_route := upper(btrim(regexp_replace(coalesce(old.data->>'routeAssignment', ''), '[[:space:]]+', ' ', 'g')));
    v_route_changed := v_route is distinct from v_previous_route;
  end if;

  v_default_delta := case
    when v_route = 'WC' then 'delta2'
    when v_route = 'PTY' then 'delta1'
    else null
  end;

  -- La acción más reciente manda: cambiar la ruta estándar aplica su Delta.
  -- Una edición manual posterior no cambia la ruta y pasa por la rama siguiente.
  if v_route_changed and v_default_delta is not null then
    if not public.is_route_delta_active(new.user_id, v_default_delta) then
      new.data := new.data - 'assignedDelta' - 'assignedDeltaAt' - 'assignedDeltaBy' - 'assignedDeltaMode';
      return new;
    end if;

    new.data := jsonb_set(
      jsonb_set(
        jsonb_set(new.data - 'assignedDeltaBy', '{assignedDelta}', to_jsonb(v_default_delta), true),
        '{assignedDeltaAt}', to_jsonb(clock_timestamp()), true
      ),
      '{assignedDeltaMode}', '"route-default"'::jsonb, true
    );
    return new;
  end if;

  -- Con la misma ruta, una asignación válida (incluida la manual) se conserva.
  if (v_current = 'delta1' and public.is_route_delta_active(new.user_id, 'delta1'))
    or (v_current = 'delta2' and public.is_route_delta_active(new.user_id, 'delta2'))
    or (v_current = 'delta3' and public.is_route_delta_active(new.user_id, 'delta3'))
  then
    return new;
  end if;

  if v_default_delta is null or not public.is_route_delta_active(new.user_id, v_default_delta) then
    new.data := new.data - 'assignedDelta' - 'assignedDeltaAt' - 'assignedDeltaBy' - 'assignedDeltaMode';
    return new;
  end if;

  new.data := jsonb_set(
    jsonb_set(
      jsonb_set(new.data - 'assignedDeltaBy', '{assignedDelta}', to_jsonb(v_default_delta), true),
      '{assignedDeltaAt}', to_jsonb(clock_timestamp()), true
    ),
    '{assignedDeltaMode}', '"route-default"'::jsonb, true
  );
  return new;
end;
$function$
;

revoke all on function public.cxc_v2_assign_active_route_pty_delta() from public, anon, authenticated;

grant execute on function public.cxc_v2_assign_active_route_pty_delta() to public;

grant execute on function public.cxc_v2_assign_active_route_pty_delta() to "anon";

grant execute on function public.cxc_v2_assign_active_route_pty_delta() to "authenticated";

grant execute on function public.cxc_v2_assign_active_route_pty_delta() to "service_role";

CREATE OR REPLACE FUNCTION public.cxc_v2_remove_active_route_item_from_receivables(p_user_id uuid, p_client_id text, p_expected_updated_at text DEFAULT ''::text)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_management jsonb;
  v_removed_at timestamptz := clock_timestamp();
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesion.';
  end if;

  if not coalesce(public.can_edit_owner_screen(p_user_id, 'receivables'), false) then
    raise exception 'No tienes permiso para editar Cuentas por cobrar.';
  end if;

  select data
  into v_management
  from public.cxc_v2_street_management_items_cloud
  where user_id = p_user_id
    and client_id = p_client_id
  for update;

  if v_management is null or v_management ->> 'isRouteTagged' is distinct from 'true' then
    raise exception 'La unidad ya no esta preparada para Ruta. Actualiza e intenta nuevamente.';
  end if;

  if nullif(btrim(coalesce(p_expected_updated_at, '')), '') is not null
     and v_management ->> 'updatedAt' is distinct from p_expected_updated_at then
    raise exception 'La gestion de la unidad cambio. Actualiza antes de sacarla de Ruta.';
  end if;

  update public.cxc_v2_active_route_items_cloud
  set
    data = jsonb_set(
      jsonb_set(data, '{removedAt}', to_jsonb(v_removed_at), true),
      '{removedReason}',
      to_jsonb('manual_management'::text),
      true
    ),
    in_custody = false,
    custody_since = null,
    custody_changed_at = case when in_custody then v_removed_at else custody_changed_at end,
    custody_changed_by = case when in_custody then auth.uid() else custody_changed_by end,
    custody_history = case
      when in_custody then coalesce(custody_history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'inCustody', false,
        'at', v_removed_at,
        'by', auth.uid(),
        'unitId', data ->> 'unitId',
        'publishedAt', data ->> 'publishedAt',
        'reason', 'route_removed'
      ))
      else custody_history
    end,
    updated_at = v_removed_at
  where user_id = p_user_id
    and client_id = p_client_id
    and coalesce(data ->> 'removedAt', '') = '';

  update public.cxc_v2_street_management_items_cloud
  set
    data = (
      data
      - 'routeTaggedAt'
      - 'managementType'
      - 'managementAmount'
      - 'managementUpdatedAt'
      - 'routeReleaseAmount'
      - 'routeReleaseUpdatedAt'
      - 'routeAssignment'
      - 'routeAssignmentUpdatedAt'
      - 'routeUrgency'
      - 'routeUrgencyUpdatedAt'
    ) || jsonb_build_object(
      'status', 'pending',
      'isRouteTagged', false,
      'managementComment', '',
      'updatedAt', v_removed_at::text
    ),
    updated_at = v_removed_at
  where user_id = p_user_id
    and client_id = p_client_id;

  return v_removed_at;
end;
$function$
;

revoke all on function public.cxc_v2_remove_active_route_item_from_receivables(p_user_id uuid, p_client_id text, p_expected_updated_at text) from public, anon, authenticated;

grant execute on function public.cxc_v2_remove_active_route_item_from_receivables(p_user_id uuid, p_client_id text, p_expected_updated_at text) to "authenticated";

grant execute on function public.cxc_v2_remove_active_route_item_from_receivables(p_user_id uuid, p_client_id text, p_expected_updated_at text) to "service_role";

CREATE OR REPLACE FUNCTION public.cxc_v2_change_active_route_delta_assignment(p_user_id uuid, p_client_id text, p_published_at text, p_previous_delta text, p_delta text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_count integer;
  v_previous_delta text;
  v_delta text;
  v_client_name text;
begin
  if coalesce(public.current_user_role()::text = 'buscador', false) then
    raise exception 'Los buscadores no pueden cambiar al responsable de búsqueda.';
  end if;
  if not coalesce(public.can_edit_owner_screen(p_user_id, 'route_search'), false) then
    raise exception 'Solo un editor de Ruta puede cambiar el buscador asignado.';
  end if;

  v_previous_delta := lower(btrim(coalesce(p_previous_delta, '')));
  v_delta := lower(btrim(coalesce(p_delta, '')));
  if v_delta not in ('delta1', 'delta2', 'delta3') then
    raise exception 'Selecciona Delta 1, Delta 2 o Delta 3.';
  end if;
  if not public.is_route_delta_active(p_user_id, v_delta) then
    raise exception '% está inactivo y no puede recibir carros.', initcap(replace(v_delta, 'delta', 'Delta '));
  end if;

  select data->>'clientName'
  into v_client_name
  from public.cxc_v2_active_route_items_cloud
  where user_id = p_user_id
    and client_id = p_client_id
    and data->>'publishedAt' = p_published_at
    and coalesce(data->>'removedAt', '') = '';

  if not found then
    raise exception 'La unidad ya no está activa. Actualiza e intenta nuevamente.';
  end if;
  if v_delta <> 'delta1' and public.is_delta1_only_route_client_name(v_client_name) then
    raise exception '% debe permanecer asignado a Delta 1.', v_client_name;
  end if;

  update public.cxc_v2_active_route_items_cloud
  set data = jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(data, '{assignedDelta}', to_jsonb(v_delta), true),
            '{assignedDeltaAt}', to_jsonb(clock_timestamp()), true
          ),
          '{assignedDeltaBy}', to_jsonb(auth.uid()), true
        ),
        '{assignedDeltaMode}', '"manual"'::jsonb, true
      ),
      updated_at = now()
  where user_id = p_user_id
    and client_id = p_client_id
    and data->>'publishedAt' = p_published_at
    and lower(btrim(coalesce(data->>'assignedDelta', ''))) = v_previous_delta
    and coalesce(data->>'removedAt', '') = '';

  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'La asignación cambió o la unidad ya no está activa. Actualiza e intenta nuevamente.';
  end if;
end;
$function$
;

revoke all on function public.cxc_v2_change_active_route_delta_assignment(p_user_id uuid, p_client_id text, p_published_at text, p_previous_delta text, p_delta text) from public, anon, authenticated;

grant execute on function public.cxc_v2_change_active_route_delta_assignment(p_user_id uuid, p_client_id text, p_published_at text, p_previous_delta text, p_delta text) to "authenticated";

grant execute on function public.cxc_v2_change_active_route_delta_assignment(p_user_id uuid, p_client_id text, p_published_at text, p_previous_delta text, p_delta text) to "service_role";

CREATE OR REPLACE FUNCTION public.cxc_v2_set_route_report_management_outcome(p_report_id uuid, p_management_outcome text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_report public.cxc_v2_route_payment_reports;
begin
  if p_management_outcome is null or p_management_outcome not in ('collected', 'remote') then
    raise exception 'Selecciona si fue cobrado o gestión remota.';
  end if;

  select * into v_report
  from public.cxc_v2_route_payment_reports
  where id = p_report_id
  for update;

  if not found or v_report.status = 'cancelled' then
    raise exception 'No existe el registro indicado.';
  end if;

  if not coalesce(public.is_admin(), false)
    or not coalesce(public.can_edit_owner_screen(v_report.user_id, 'route_search'), false) then
    raise exception 'Solo Administración puede cambiar el resultado de una gestión.';
  end if;

  update public.cxc_v2_route_payment_reports
  set management_outcome = p_management_outcome
  where id = p_report_id;
end;
$function$
;

revoke all on function public.cxc_v2_set_route_report_management_outcome(p_report_id uuid, p_management_outcome text) from public, anon, authenticated;

grant execute on function public.cxc_v2_set_route_report_management_outcome(p_report_id uuid, p_management_outcome text) to "authenticated";

grant execute on function public.cxc_v2_set_route_report_management_outcome(p_report_id uuid, p_management_outcome text) to "service_role";

CREATE OR REPLACE FUNCTION public.cxc_v2_update_active_route_release_amount(p_user_id uuid, p_client_id text, p_published_at text, p_release_amount numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_amount numeric(12,2);
  v_updated_count integer;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesion.';
  end if;

  if not coalesce(public.can_edit_owner_screen(p_user_id, 'route_search'), false) then
    raise exception 'No tienes permiso para editar Ruta en calle.';
  end if;

  if exists (
    select 1
    from public.user_profiles profile
    where profile.id = auth.uid()
      and lower(split_part(btrim(coalesce(profile.email, '')), '@', 1)) in ('delta1', 'delta2', 'delta3')
  ) then
    raise exception 'Los perfiles de buscador no pueden editar el monto por cobrar.';
  end if;

  if p_client_id is null or btrim(p_client_id) = '' or p_published_at is null or btrim(p_published_at) = '' then
    raise exception 'La unidad indicada no es valida.';
  end if;

  if p_release_amount is null
    or p_release_amount <= 0
    or p_release_amount > 9999999999.99
    or p_release_amount <> round(p_release_amount, 2) then
    raise exception 'El monto debe ser mayor que cero y tener maximo dos decimales.';
  end if;
  v_amount := round(p_release_amount, 2);

  if exists (
    select 1
    from public.cxc_v2_route_payment_reports report
    where report.user_id = p_user_id
      and report.client_id = p_client_id
      and report.published_at = p_published_at
      and report.status = 'review'
  ) then
    raise exception 'No se puede editar el monto mientras esta unidad tenga un pago pendiente de revision.';
  end if;

  update public.cxc_v2_active_route_items_cloud
  set data = jsonb_set(
        jsonb_set(data, '{releaseAmount}', to_jsonb(v_amount), true),
        '{releaseAmountEdits}',
        coalesce(data->'releaseAmountEdits', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
          'previousAmount', round(coalesce((data->>'releaseAmount')::numeric, 0), 2),
          'amount', v_amount,
          'at', clock_timestamp(),
          'by', auth.uid()
        )),
        true
      ),
      updated_at = clock_timestamp()
  where user_id = p_user_id
    and client_id = p_client_id
    and data->>'publishedAt' = p_published_at
    and coalesce(data->>'removedAt', '') = '';

  get diagnostics v_updated_count = row_count;
  if v_updated_count = 0 then
    raise exception 'La unidad cambio o ya no esta activa. Actualiza la ruta.';
  end if;
end;
$function$
;

revoke all on function public.cxc_v2_update_active_route_release_amount(p_user_id uuid, p_client_id text, p_published_at text, p_release_amount numeric) from public, anon, authenticated;

grant execute on function public.cxc_v2_update_active_route_release_amount(p_user_id uuid, p_client_id text, p_published_at text, p_release_amount numeric) to "authenticated";

grant execute on function public.cxc_v2_update_active_route_release_amount(p_user_id uuid, p_client_id text, p_published_at text, p_release_amount numeric) to "service_role";

CREATE OR REPLACE FUNCTION public.cxc_v2_hide_route_managed_report(p_report_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_report public.cxc_v2_route_payment_reports;
begin
  select * into v_report
  from public.cxc_v2_route_payment_reports
  where id = p_report_id
  for update;

  if not found then
    raise exception 'No existe el registro indicado.';
  end if;

  if not coalesce(public.is_admin(), false)
    or not coalesce(public.can_edit_owner_screen(v_report.user_id, 'route_search'), false) then
    raise exception 'Solo Administración puede quitar registros de Gestionados hoy.';
  end if;

  update public.cxc_v2_route_payment_reports
  set managed_hidden_at = clock_timestamp(),
      managed_hidden_by = auth.uid()
  where id = p_report_id;
end;
$function$
;

revoke all on function public.cxc_v2_hide_route_managed_report(p_report_id uuid) from public, anon, authenticated;

grant execute on function public.cxc_v2_hide_route_managed_report(p_report_id uuid) to "authenticated";

grant execute on function public.cxc_v2_hide_route_managed_report(p_report_id uuid) to "service_role";

CREATE OR REPLACE FUNCTION public.cxc_v2_report_route_payment_split(p_user_id uuid, p_client_id text, p_published_at text, p_cash_amount numeric, p_bank_amount numeric, p_management_outcome text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_item jsonb;
  v_name text;
  v_method text;
begin
  if not coalesce(public.can_report_route_payment(p_user_id), false) then
    raise exception 'No tienes permiso para reportar pagos.';
  end if;
  if p_cash_amount is null or p_bank_amount is null
    or p_cash_amount::text in ('NaN','Infinity','-Infinity') or p_bank_amount::text in ('NaN','Infinity','-Infinity')
    or p_cash_amount < 0 or p_bank_amount < 0 or p_cash_amount + p_bank_amount <= 0
    or p_cash_amount + p_bank_amount > 9999999999.99
    or p_cash_amount <> round(p_cash_amount, 2) or p_bank_amount <> round(p_bank_amount, 2) then
    raise exception 'Indica importes válidos de efectivo y banca, con hasta dos decimales.';
  end if;
  if p_management_outcome is null or p_management_outcome not in ('collected', 'remote') then
    raise exception 'Selecciona si fue cobrado o gestión remota.';
  end if;

  select data into v_item
  from public.cxc_v2_active_route_items_cloud
  where user_id = p_user_id and client_id = p_client_id
  for update;

  if v_item is null or coalesce(v_item->>'removedAt', '') <> '' or (v_item->>'publishedAt') is distinct from p_published_at then
    raise exception 'La unidad cambió o ya no está activa. Actualiza la ruta.';
  end if;

  v_method := case
    when p_cash_amount > 0 and p_bank_amount > 0 then 'mixed'
    when p_cash_amount > 0 then 'cash'
    else 'bank'
  end;
  select coalesce(nullif(email, ''), 'Buscador') into v_name
  from public.user_profiles
  where id = auth.uid();

  insert into public.cxc_v2_route_payment_reports(
    user_id, client_id, published_at, snapshot, amount, method,
    cash_amount, bank_amount, management_outcome, reported_by, reporter_name
  ) values (
    p_user_id, p_client_id, p_published_at, v_item, p_cash_amount + p_bank_amount, v_method,
    p_cash_amount, p_bank_amount, p_management_outcome, auth.uid(), coalesce(v_name, 'Buscador')
  );
end;
$function$
;

revoke all on function public.cxc_v2_report_route_payment_split(p_user_id uuid, p_client_id text, p_published_at text, p_cash_amount numeric, p_bank_amount numeric, p_management_outcome text) from public, anon, authenticated;

grant execute on function public.cxc_v2_report_route_payment_split(p_user_id uuid, p_client_id text, p_published_at text, p_cash_amount numeric, p_bank_amount numeric, p_management_outcome text) to "authenticated";

grant execute on function public.cxc_v2_report_route_payment_split(p_user_id uuid, p_client_id text, p_published_at text, p_cash_amount numeric, p_bank_amount numeric, p_management_outcome text) to "service_role";

CREATE OR REPLACE FUNCTION public.cxc_v2_validate_receivable_unit_status(p_owner uuid, p_unit text, p_expected_status text, p_status text, p_collector text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_unit text := upper(btrim(p_unit));
  v_status text := lower(btrim(p_status));
  v_current text;
  v_fleet public.fleet_units_cloud%rowtype;
  v_review public.cxc_v2_receivables_operational_reviews%rowtype;
  v_archived text[] := '{}';
  v_updated text[] := '{}';
  v_now timestamptz := clock_timestamp();
begin
  if auth.uid() is null or not coalesce(public.can_edit_owner_screen(p_owner, 'receivables'), false) then
    raise exception 'No tienes permiso para validar estados en Cuentas por cobrar.';
  end if;
  if p_collector not in ('collector-1', 'collector-2') or p_collector is null or
    (p_collector = 'collector-1' and left(v_unit,1) not in ('A','C','E')) or
    (p_collector = 'collector-2' and left(v_unit,1) not in ('B','D','T')) then
    raise exception 'La unidad no pertenece a la cartera seleccionada.';
  end if;
  select * into v_fleet from public.fleet_units_cloud
    where user_id=p_owner and upper(btrim(unit_id))=v_unit and retired_at is null for update;
  if not found then raise exception 'Unidad no encontrada en la flota vigente.'; end if;
  -- Lock associated clients as the control-unit view prioritizes their state.
  perform id from public.clients_cloud where user_id=p_owner
    and upper(btrim(data->>'unitId'))=v_unit for update;
  select lower(coalesce(data->>'status','activo')) into v_current from public.clients_cloud
    where user_id=p_owner and upper(btrim(data->>'unitId'))=v_unit
      and coalesce(data->>'status','activo') <> 'archivado'
    order by updated_at desc limit 1;
  v_current := coalesce(v_current, lower(coalesce(v_fleet.operational_status,'libre')));
  if v_current <> lower(btrim(p_expected_status)) or p_expected_status is null then
    raise exception 'El estado cambió en otra sesión. Recarga y valida el estado actual.';
  end if;
  if v_current = 'activo' then raise exception 'La unidad ya está activa; continúa con su gestión.'; end if;
  if v_status is null or v_status = '' then raise exception 'Selecciona el estado real.'; end if;
  if v_status <> v_current then
    if v_status not in ('activo','libre','taller','chapisteria','custodia','archivado') then
      raise exception 'Estado de destino no válido.';
    end if;
    update public.fleet_units_cloud set operational_status=v_status, updated_at=v_now
      where fleet_id=v_fleet.fleet_id;
    if v_status in ('libre','archivado') then
      with changed as (
        update public.clients_cloud set data=data || jsonb_build_object('status','archivado','archivedAt',v_now,
          'statusComment','Estado validado desde Cuentas por cobrar.'), updated_at=v_now
        where user_id=p_owner and upper(btrim(data->>'unitId'))=v_unit
          and coalesce(data->>'status','activo') <> 'archivado' returning id
      ) select coalesce(array_agg(id),'{}') into v_archived from changed;
    else
      with changed as (
        update public.clients_cloud set data=(data - 'archivedAt' - 'statusComment') || jsonb_build_object('status',v_status), updated_at=v_now
        where user_id=p_owner and upper(btrim(data->>'unitId'))=v_unit
          and coalesce(data->>'status','activo') <> 'archivado' returning id
      ) select coalesce(array_agg(id),'{}') into v_updated from changed;
    end if;
    v_fleet.updated_at := v_now;
  end if;
  insert into public.cxc_v2_receivables_operational_reviews(user_id,unit_id,previous_status,status,collector,reviewed_by,reviewed_at,fleet_updated_at)
    values(p_owner,v_unit,v_current,v_status,p_collector,auth.uid(),v_now,v_fleet.updated_at) returning * into v_review;
  return jsonb_build_object('review',to_jsonb(v_review),'archived_client_ids',v_archived,'updated_client_ids',v_updated);
end;
$function$
;

revoke all on function public.cxc_v2_validate_receivable_unit_status(p_owner uuid, p_unit text, p_expected_status text, p_status text, p_collector text) from public, anon, authenticated;

grant execute on function public.cxc_v2_validate_receivable_unit_status(p_owner uuid, p_unit text, p_expected_status text, p_status text, p_collector text) to "authenticated";

grant execute on function public.cxc_v2_validate_receivable_unit_status(p_owner uuid, p_unit text, p_expected_status text, p_status text, p_collector text) to "service_role";

CREATE TRIGGER trg_notified_payments_cloud_updated_at BEFORE UPDATE ON public.cxc_v2_notified_payments_cloud FOR EACH ROW EXECUTE FUNCTION cxc_v2_set_updated_at();

CREATE TRIGGER cxc_v2_guard_legacy_active_route_removal BEFORE UPDATE ON public.cxc_v2_active_route_items_cloud FOR EACH ROW EXECUTE FUNCTION cxc_v2_guard_legacy_active_route_removal();

CREATE TRIGGER cxc_v2_guard_active_route_management_tag BEFORE UPDATE ON public.cxc_v2_street_management_items_cloud FOR EACH ROW EXECUTE FUNCTION cxc_v2_guard_active_route_management_tag();

CREATE TRIGGER notified_payment_reconcile_route AFTER INSERT OR UPDATE OF data ON public.cxc_v2_notified_payments_cloud FOR EACH ROW EXECUTE FUNCTION cxc_v2_reconcile_notified_payment_route_trigger();

CREATE TRIGGER active_route_reconcile_notices AFTER INSERT OR UPDATE OF data ON public.cxc_v2_active_route_items_cloud FOR EACH ROW EXECUTE FUNCTION cxc_v2_reconcile_notices_when_route_activates();

CREATE TRIGGER notified_payment_cancel_route_report AFTER DELETE ON public.cxc_v2_notified_payments_cloud FOR EACH ROW EXECUTE FUNCTION cxc_v2_cancel_route_report_when_notice_deleted();

CREATE TRIGGER cxc_v2_record_notified_payment_tombstone AFTER DELETE ON public.cxc_v2_notified_payments_cloud FOR EACH ROW EXECUTE FUNCTION cxc_v2_record_notified_payment_tombstone();

CREATE TRIGGER cxc_v2_block_consumed_notified_payment_restore BEFORE INSERT OR UPDATE ON public.cxc_v2_notified_payments_cloud FOR EACH ROW EXECUTE FUNCTION cxc_v2_block_consumed_notified_payment_restore();

CREATE TRIGGER daily_contact_attempt_updated_at BEFORE UPDATE ON public.cxc_v2_daily_contact_attempts_cloud FOR EACH ROW EXECUTE FUNCTION cxc_v2_set_daily_contact_attempt_updated_at();

CREATE TRIGGER route_report_remove_linked_notice AFTER UPDATE OF status ON public.cxc_v2_route_payment_reports FOR EACH ROW WHEN ((old.status IS DISTINCT FROM new.status)) EXECUTE FUNCTION cxc_v2_remove_notified_payment_for_closed_route_report();

CREATE TRIGGER cxc_v2_settle_visual_route_bank_report_after_confirmation AFTER INSERT OR UPDATE OF bank_confirmed_visually_at ON public.cxc_v2_route_payment_reports FOR EACH ROW EXECUTE FUNCTION cxc_v2_settle_visual_route_bank_report_after_confirmation();

CREATE TRIGGER route_capture_close_on_custody_exit AFTER UPDATE OF in_custody ON public.cxc_v2_active_route_items_cloud FOR EACH ROW WHEN ((old.in_custody IS DISTINCT FROM new.in_custody)) EXECUTE FUNCTION cxc_v2_close_route_capture_on_custody_exit();

CREATE TRIGGER active_route_assign_pty_delta BEFORE INSERT OR UPDATE OF data ON public.cxc_v2_active_route_items_cloud FOR EACH ROW EXECUTE FUNCTION cxc_v2_assign_active_route_pty_delta();

CREATE TRIGGER cxc_v2_sync_route_payment_report AFTER INSERT OR DELETE OR UPDATE ON public.payments_cloud FOR EACH ROW EXECUTE FUNCTION cxc_v2_sync_route_payment_report();

CREATE TRIGGER cxc_v2_sync_visual_route_bank_payment AFTER INSERT OR DELETE OR UPDATE ON public.payments_cloud FOR EACH ROW EXECUTE FUNCTION cxc_v2_sync_visual_route_bank_payment();

alter table public.cxc_v2_street_management_items_cloud replica identity full;

do $$ begin if exists(select 1 from pg_publication where pubname='supabase_realtime') then alter publication supabase_realtime add table public.cxc_v2_street_management_items_cloud; end if; end $$;

alter table public.cxc_v2_daily_contact_attempts_cloud replica identity full;

do $$ begin if exists(select 1 from pg_publication where pubname='supabase_realtime') then alter publication supabase_realtime add table public.cxc_v2_daily_contact_attempts_cloud; end if; end $$;

alter table public.cxc_v2_collection_closures_cloud replica identity full;

do $$ begin if exists(select 1 from pg_publication where pubname='supabase_realtime') then alter publication supabase_realtime add table public.cxc_v2_collection_closures_cloud; end if; end $$;

alter table public.cxc_v2_receivables_operational_reviews replica identity full;

do $$ begin if exists(select 1 from pg_publication where pubname='supabase_realtime') then alter publication supabase_realtime add table public.cxc_v2_receivables_operational_reviews; end if; end $$;

alter table public.cxc_v2_active_route_items_cloud replica identity full;

do $$ begin if exists(select 1 from pg_publication where pubname='supabase_realtime') then alter publication supabase_realtime add table public.cxc_v2_active_route_items_cloud; end if; end $$;

alter table public.cxc_v2_route_payment_reports replica identity full;

do $$ begin if exists(select 1 from pg_publication where pubname='supabase_realtime') then alter publication supabase_realtime add table public.cxc_v2_route_payment_reports; end if; end $$;

alter table public.cxc_v2_route_report_payment_links replica identity full;

do $$ begin if exists(select 1 from pg_publication where pubname='supabase_realtime') then alter publication supabase_realtime add table public.cxc_v2_route_report_payment_links; end if; end $$;

alter table public.cxc_v2_route_runs replica identity full;

do $$ begin if exists(select 1 from pg_publication where pubname='supabase_realtime') then alter publication supabase_realtime add table public.cxc_v2_route_runs; end if; end $$;

alter table public.cxc_v2_route_capture_events replica identity full;

do $$ begin if exists(select 1 from pg_publication where pubname='supabase_realtime') then alter publication supabase_realtime add table public.cxc_v2_route_capture_events; end if; end $$;

alter table public.cxc_v2_notified_payments_cloud replica identity full;

do $$ begin if exists(select 1 from pg_publication where pubname='supabase_realtime') then alter publication supabase_realtime add table public.cxc_v2_notified_payments_cloud; end if; end $$;

alter table public.cxc_v2_notified_payment_tombstones replica identity full;

do $$ begin if exists(select 1 from pg_publication where pubname='supabase_realtime') then alter publication supabase_realtime add table public.cxc_v2_notified_payment_tombstones; end if; end $$;

notify pgrst, 'reload schema';

commit;
