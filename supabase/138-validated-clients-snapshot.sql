-- Validate the complete owner-scoped dataset on every request. A matching
-- fingerprint avoids retransferring unchanged rows; RLS is still evaluated
-- under the caller's role and no table or write policy is changed.
begin;
set local lock_timeout = '3s';

create or replace function public.read_clients_snapshot_if_changed(
  p_user_id uuid,
  p_fingerprint text default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $function$
declare
  payload text;
  fingerprint text;
  row_count integer;
begin
  if p_user_id is null then
    raise exception 'An owner is required' using errcode = '22004';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'data', c.data) order by c.id), '[]'::jsonb)::text,
         count(*)::integer
    into payload, row_count
  from public.clients_cloud c
  where c.user_id = p_user_id;
  fingerprint := encode(sha256(convert_to(payload, 'UTF8')), 'hex');
  return jsonb_build_object(
    'version', 1,
    'owner', p_user_id,
    'fingerprint', fingerprint,
    'count', row_count,
    'not_modified', coalesce(p_fingerprint = fingerprint, false),
    'payload', case when p_fingerprint = fingerprint then null else payload end
  );
end;
$function$;

revoke all on function public.read_clients_snapshot_if_changed(uuid, text) from public, anon;
grant execute on function public.read_clients_snapshot_if_changed(uuid, text) to authenticated;
notify pgrst, 'reload schema';
commit;
