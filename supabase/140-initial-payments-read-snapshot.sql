-- Fresh, caller-scoped validation of the same recent and pending payments used
-- by startup. Unchanged snapshots avoid transferring both datasets again.
begin;
set local lock_timeout = '3s';
create or replace function public.read_initial_payments_snapshot(
  p_user_id uuid, p_through_date date, p_limit integer default 300,
  p_fingerprint text default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $function$
declare
  recent jsonb;
  pending jsonb;
  payload text;
  fingerprint text;
  safe_limit integer := greatest(1, least(1000, coalesce(p_limit, 300)));
begin
  if p_user_id is null or p_through_date is null then
    raise exception 'Owner and date are required' using errcode = '22004';
  end if;
  select coalesce(jsonb_agg(p.data), '[]'::jsonb) into recent
    from (select data from public.payments_cloud where user_id = p_user_id
          order by updated_at desc limit safe_limit) p;
  -- Keep the existing permission checks and all older undelivered cash.
  select coalesce(jsonb_agg(p.data), '[]'::jsonb) into pending
    from public.read_pending_cash_payments(p_user_id, p_through_date) p(data);
  payload := jsonb_build_object('recent', recent, 'pending', pending)::text;
  fingerprint := encode(sha256(convert_to(payload, 'UTF8')), 'hex');
  return jsonb_build_object(
    'version', 1, 'owner', p_user_id, 'through_date', p_through_date, 'limit', safe_limit,
    'recent_count', jsonb_array_length(recent), 'pending_count', jsonb_array_length(pending),
    'fingerprint', fingerprint, 'not_modified', coalesce(p_fingerprint = fingerprint, false),
    'payload', case when p_fingerprint = fingerprint then null else payload end
  );
end;
$function$;
revoke all on function public.read_initial_payments_snapshot(uuid,date,integer,text) from public, anon;
grant execute on function public.read_initial_payments_snapshot(uuid,date,integer,text) to authenticated;
notify pgrst, 'reload schema';
commit;
