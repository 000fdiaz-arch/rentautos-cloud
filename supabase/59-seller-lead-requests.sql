-- Portal privado para que el vendedor entregue sus datos y consulte el dictamen.

create table if not exists public.seller_lead_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token uuid not null unique default gen_random_uuid(),
  status text not null default 'waiting_information'
    check (status in ('waiting_information', 'pending_review', 'incomplete', 'reviewed')),
  cedula text,
  birth_date date,
  attachment_name text,
  attachment_data_url text,
  correction_note text,
  evaluation_id text,
  expires_at timestamptz not null default (now() + interval '30 days'),
  submitted_at timestamptz,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists seller_lead_requests_user_updated_idx
  on public.seller_lead_requests (user_id, updated_at desc);

alter table public.seller_lead_requests enable row level security;
grant select, insert, update, delete on public.seller_lead_requests to authenticated;
revoke all on public.seller_lead_requests from anon;

drop policy if exists "seller_lead_requests_owner_access" on public.seller_lead_requests;
create policy "seller_lead_requests_owner_access" on public.seller_lead_requests
for all to authenticated
using (public.can_access_owner_data(user_id))
with check (public.can_access_owner_data(user_id));

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
    select data into evaluation
    from public.lead_evaluations_cloud
    where user_id = target.user_id and id = target.evaluation_id;
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'status', public_status,
    'cedula', coalesce(target.cedula, ''),
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

create or replace function public.submit_seller_lead_request(
  p_token uuid,
  p_cedula text,
  p_birth_date date,
  p_attachment_name text,
  p_attachment_data_url text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target public.seller_lead_requests%rowtype;
begin
  select * into target
  from public.seller_lead_requests
  where token = p_token
  for update;

  if not found then raise exception 'Solicitud no encontrada'; end if;
  if target.expires_at < now() then raise exception 'La solicitud vencio'; end if;
  if target.status not in ('waiting_information', 'incomplete') then raise exception 'La solicitud ya fue enviada'; end if;
  if length(trim(coalesce(p_cedula, ''))) < 4 or p_birth_date is null then
    raise exception 'Cedula y fecha de nacimiento son obligatorias';
  end if;
  if target.attachment_data_url is null and length(coalesce(p_attachment_data_url, '')) = 0 then
    raise exception 'El documento adjunto es obligatorio';
  end if;
  if length(coalesce(p_attachment_data_url, '')) > 0
     and p_attachment_data_url !~ '^data:(image/[a-zA-Z0-9.+-]+|application/pdf);base64,' then
    raise exception 'El documento adjunto no es valido';
  end if;
  if octet_length(p_attachment_data_url) > 5600000 then raise exception 'El documento supera el limite permitido'; end if;

  update public.seller_lead_requests
  set cedula = upper(trim(p_cedula)),
      birth_date = p_birth_date,
      attachment_name = case when length(coalesce(p_attachment_data_url, '')) > 0 then left(trim(p_attachment_name), 240) else target.attachment_name end,
      attachment_data_url = case when length(coalesce(p_attachment_data_url, '')) > 0 then p_attachment_data_url else target.attachment_data_url end,
      correction_note = null,
      status = 'pending_review',
      submitted_at = now(),
      updated_at = now()
  where id = target.id;
end;
$$;

revoke all on function public.get_seller_lead_request(uuid) from public;
revoke all on function public.submit_seller_lead_request(uuid, text, date, text, text) from public;
grant execute on function public.get_seller_lead_request(uuid) to anon, authenticated;
grant execute on function public.submit_seller_lead_request(uuid, text, date, text, text) to anon, authenticated;
