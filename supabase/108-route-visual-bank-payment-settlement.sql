-- Mantiene visible la confirmacion bancaria de Ruta hasta que exista el pago real.
-- La conciliacion reutiliza las mismas reglas de Pago notificado y conserva
-- un vinculo durable para que la fila no reaparezca entre sesiones.

alter table public.route_payment_reports
  add column if not exists bank_settled_payment_id text;
alter table public.route_payment_reports
  add column if not exists bank_settled_at timestamptz;

create unique index if not exists route_report_visual_bank_payment_unique
  on public.route_payment_reports(user_id, bank_settled_payment_id)
  where bank_settled_payment_id is not null;

create or replace function public.visual_route_bank_report_matches_payment(
  r public.route_payment_reports,
  p jsonb
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    r.status <> 'cancelled'
    and r.bank_confirmed_visually_at is not null
    and r.bank_amount > 0
    and public.notified_payment_matches_bank_payment(
      jsonb_build_object(
        'clientId', r.client_id,
        'amount', r.bank_amount,
        'createdAt', r.reported_at
      ),
      p
    ),
    false
  );
$$;

create or replace function public.settle_visual_route_bank_report(p_report_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_report public.route_payment_reports;
  v_payment_id text;
begin
  select * into v_report
  from public.route_payment_reports
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
    and public.visual_route_bank_report_matches_payment(v_report, p.data)
    and not exists (
      select 1
      from public.route_payment_reports other_report
      where other_report.user_id = p.user_id
        and other_report.id <> v_report.id
        and (
          other_report.confirmed_payment_id = p.id
          or other_report.bank_settled_payment_id = p.id
        )
    )
    and not exists (
      select 1
      from public.route_report_payment_links link
      where link.user_id = p.user_id
        and link.payment_id = p.id
        and link.report_id <> v_report.id
    )
  order by (p.data->>'createdAt')::timestamptz, p.id
  limit 1
  for update of p skip locked;

  if v_payment_id is null then return; end if;

  update public.route_payment_reports
  set bank_settled_payment_id = v_payment_id,
      bank_settled_at = clock_timestamp()
  where id = v_report.id
    and bank_settled_payment_id is null;
end;
$$;

create or replace function public.sync_visual_route_bank_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_report public.route_payment_reports;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    select * into v_report
    from public.route_payment_reports
    where user_id = old.user_id
      and bank_settled_payment_id = old.id
    for update;

    if found and (
      tg_op = 'DELETE'
      or new.user_id is distinct from old.user_id
      or new.id is distinct from old.id
      or not public.visual_route_bank_report_matches_payment(v_report, new.data)
    ) then
      update public.route_payment_reports
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
  from public.route_report_payment_links link
  join public.route_payment_reports r
    on r.id = link.report_id and r.user_id = link.user_id
  where link.user_id = new.user_id
    and link.payment_id = new.id
    and link.method = 'bank'
    and r.bank_confirmed_visually_at is not null
  limit 1
  for update of r;

  if found then
    update public.route_payment_reports
    set bank_settled_payment_id = new.id,
        bank_settled_at = clock_timestamp()
    where id = v_report.id
      and bank_settled_payment_id is null;
    return new;
  end if;

  if exists (
    select 1
    from public.route_payment_reports
    where user_id = new.user_id and bank_settled_payment_id = new.id
  ) or exists (
    select 1
    from public.route_payment_reports
    where user_id = new.user_id and confirmed_payment_id = new.id
  ) or exists (
    select 1
    from public.route_report_payment_links
    where user_id = new.user_id and payment_id = new.id
  ) then
    return new;
  end if;

  select * into v_report
  from public.route_payment_reports r
  where r.user_id = new.user_id
    and r.status <> 'cancelled'
    and r.bank_confirmed_visually_at is not null
    and r.bank_settled_payment_id is null
    and public.visual_route_bank_report_matches_payment(r, new.data)
  order by r.reported_at, r.id
  limit 1
  for update skip locked;

  if found then
    update public.route_payment_reports
    set bank_settled_payment_id = new.id,
        bank_settled_at = clock_timestamp()
    where id = v_report.id
      and bank_settled_payment_id is null;
  end if;

  return new;
end;
$$;

drop trigger if exists sync_visual_route_bank_payment on public.payments_cloud;
create trigger sync_visual_route_bank_payment
after insert or update or delete on public.payments_cloud
for each row execute function public.sync_visual_route_bank_payment();

create or replace function public.settle_visual_route_bank_report_after_confirmation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.bank_confirmed_visually_at is not null
    and new.bank_settled_payment_id is null then
    perform public.settle_visual_route_bank_report(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists settle_visual_route_bank_report_after_confirmation on public.route_payment_reports;
create trigger settle_visual_route_bank_report_after_confirmation
after insert or update of bank_confirmed_visually_at on public.route_payment_reports
for each row execute function public.settle_visual_route_bank_report_after_confirmation();

do $$
declare
  v_report_id uuid;
begin
  for v_report_id in
    select id
    from public.route_payment_reports
    where status <> 'cancelled'
      and bank_confirmed_visually_at is not null
      and bank_settled_payment_id is null
    order by reported_at, id
  loop
    perform public.settle_visual_route_bank_report(v_report_id);
  end loop;
end;
$$;

revoke all on function public.visual_route_bank_report_matches_payment(public.route_payment_reports, jsonb) from public, anon, authenticated;
revoke all on function public.settle_visual_route_bank_report(uuid) from public, anon, authenticated;
revoke all on function public.sync_visual_route_bank_payment() from public, anon, authenticated;
revoke all on function public.settle_visual_route_bank_report_after_confirmation() from public, anon, authenticated;

notify pgrst, 'reload schema';

