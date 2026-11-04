-- Seller portal OCR identity: persist the confirmed full name with the license.
begin;

alter table public.seller_lead_requests
  add column if not exists full_name text;

alter table public.seller_lead_requests
  drop constraint if exists seller_lead_requests_full_name_check;
alter table public.seller_lead_requests
  add constraint seller_lead_requests_full_name_check
  check (full_name is null or length(full_name) between 3 and 120);

create or replace function public.get_seller_lead_request(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target public.seller_lead_requests%rowtype;
  evaluation jsonb;
  public_status text;
begin
  select * into target from public.seller_lead_requests where token = p_token;
  if not found then return null; end if;
  public_status := case
    when target.expires_at < now() and target.status <> 'reviewed' then 'expired'
    else target.status
  end;
  if target.status = 'reviewed' and target.evaluation_id is not null then
    select data into evaluation from public.lead_evaluations_cloud
    where user_id = target.user_id and id = target.evaluation_id;
  end if;
  return jsonb_strip_nulls(jsonb_build_object(
    'status', public_status,
    'cedula', coalesce(target.cedula, ''),
    'fullName', target.full_name,
    'birthDate', coalesce(target.birth_date::text, ''),
    'attachmentName', target.attachment_name,
    'correctionNote', case when target.status = 'incomplete' then target.correction_note else null end,
    'expiresAt', target.expires_at,
    'decision', case when target.status = 'reviewed' then evaluation->>'decision' else null end,
    'extraDeposit', case when target.status = 'reviewed' then coalesce((evaluation->>'extraDeposit')::numeric, 0) else null end,
    'reviewedAt', target.reviewed_at
  ));
end;
$$;

revoke all on function public.get_seller_lead_request(uuid) from public;
grant execute on function public.get_seller_lead_request(uuid) to anon, authenticated;
notify pgrst, 'reload schema';
commit;
