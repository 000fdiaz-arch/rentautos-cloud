-- Leads: physical summaries without documents and indexed, bounded reads.
-- Requires 20-screen-permissions.sql and 66-shared-seller-lead-portal.sql.
-- Existing data/documents and write APIs remain intact. Apply before the app release.
begin;
set local lock_timeout = '5s';

alter table public.lead_evaluations_cloud
  add column if not exists summary jsonb
  generated always as (data - 'attachmentDataUrl') stored;

create index if not exists lead_evaluations_recent_idx
  on public.lead_evaluations_cloud (user_id, updated_at desc, id desc);
create index if not exists lead_evaluations_summary_cedula_idx
  on public.lead_evaluations_cloud
  (user_id, public.seller_lead_cedula_key(summary->>'cedula'), updated_at desc, id desc);
create index if not exists seller_lead_requests_recent_idx
  on public.seller_lead_requests (user_id, updated_at desc, id desc);

-- Check the existing dataset/screen permission once per request, not for every
-- row. All branches remain restricted to that same dataset. No anonymous access.
create or replace function public.read_lead_evaluations_page(
  p_user_id uuid,
  p_cedula text default null,
  p_before_updated_at timestamptz default null,
  p_before_id text default null
)
returns table(id text, summary jsonb, updated_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not coalesce(public.can_view_owner_screen(p_user_id, 'leads'), false) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if (p_before_updated_at is null) <> (p_before_id is null) then
    raise exception 'Cursor incompleto' using errcode = '22023';
  end if;
  if p_cedula is not null then
    if length(public.seller_lead_cedula_key(p_cedula)) < 4 or length(p_cedula) > 32 then
      raise exception 'Cedula no valida' using errcode = '22023';
    end if;
    return query select l.id, l.summary, l.updated_at
      from public.lead_evaluations_cloud l
      where l.user_id = p_user_id
        and public.seller_lead_cedula_key(l.summary->>'cedula') = public.seller_lead_cedula_key(p_cedula)
      order by l.updated_at desc, l.id desc limit 1;
  elsif p_before_updated_at is null then
    return query select l.id, l.summary, l.updated_at
      from public.lead_evaluations_cloud l where l.user_id = p_user_id
      order by l.updated_at desc, l.id desc limit 21;
  else
    return query select l.id, l.summary, l.updated_at
      from public.lead_evaluations_cloud l where l.user_id = p_user_id
        and (l.updated_at, l.id) < (p_before_updated_at, p_before_id)
      order by l.updated_at desc, l.id desc limit 21;
  end if;
end;
$$;
revoke all on function public.read_lead_evaluations_page(uuid,text,timestamptz,text) from public, anon;
grant execute on function public.read_lead_evaluations_page(uuid,text,timestamptz,text) to authenticated;

-- The public portal keeps its allowlist and existing access/rate-limit guards.
-- It now reads the same small physical summary instead of the document JSON.
create or replace function public.seller_lead_public_result(p_user_id uuid, p_key text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare request_status text; verdict jsonb;
begin
  select status into request_status from public.seller_lead_requests
  where user_id = p_user_id and public.seller_lead_cedula_key(cedula) = p_key
    and status in ('pending_review', 'incomplete')
  order by updated_at desc, id limit 1;
  if found then return jsonb_build_object('status', request_status); end if;
  select summary into verdict from public.lead_evaluations_cloud
  where user_id = p_user_id and public.seller_lead_cedula_key(summary->>'cedula') = p_key
    and summary->>'decision' in ('aplica', 'aplica_con_abono', 'no_aplica')
  order by updated_at desc, id desc limit 1;
  if found then
    return jsonb_build_object('status', 'reviewed', 'decision', verdict->>'decision',
      'extraDeposit', case when verdict->>'decision' = 'no_aplica' then 0
        when jsonb_typeof(verdict->'extraDeposit') = 'number' then greatest(0, (verdict->>'extraDeposit')::numeric)
        else 0 end);
  end if;
  return jsonb_build_object('status', 'not_found');
end;
$$;
revoke all on function public.seller_lead_public_result(uuid,text) from public, anon, authenticated;

analyze public.lead_evaluations_cloud;
analyze public.seller_lead_requests;
notify pgrst, 'reload schema';
commit;
