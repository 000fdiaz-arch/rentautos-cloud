-- Supports the bounded route history and the always-complete review queue.
-- No data or RLS policy is changed by this migration.

create index if not exists route_report_history_read_idx
  on public.route_payment_reports (user_id, reported_at desc, id)
  where status <> 'cancelled';

create index if not exists route_report_review_read_idx
  on public.route_payment_reports (user_id, reported_at desc, id)
  where status = 'review';
