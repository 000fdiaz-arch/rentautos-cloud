-- Ejecutar después de 69-route-payment-reports.sql.
alter table public.route_payment_reports add column if not exists cash_amount numeric(12,2) not null default 0;
alter table public.route_payment_reports add column if not exists bank_amount numeric(12,2) not null default 0;
alter table public.route_payment_reports add column if not exists confirmed_cash_amount numeric(12,2) not null default 0;
alter table public.route_payment_reports add column if not exists confirmed_bank_amount numeric(12,2) not null default 0;
update public.route_payment_reports set
  cash_amount=case when method='cash' then amount else 0 end,
  bank_amount=case when method='bank' then amount else 0 end
where cash_amount=0 and bank_amount=0;
alter table public.route_payment_reports drop constraint if exists route_payment_reports_method_check;
alter table public.route_payment_reports add constraint route_payment_reports_method_check check(method in ('cash','bank','mixed'));
alter table public.route_payment_reports drop constraint if exists route_report_split_check;
alter table public.route_payment_reports add constraint route_report_split_check check(
  cash_amount>=0 and bank_amount>=0 and amount=cash_amount+bank_amount
  and ((method='cash' and cash_amount>0 and bank_amount=0)
    or (method='bank' and bank_amount>0 and cash_amount=0)
    or (method='mixed' and cash_amount>0 and bank_amount>0))
);

-- Cada pago real solo puede respaldar un reporte; cada medio tiene su vínculo.
create table if not exists public.route_report_payment_links (
  report_id uuid not null references public.route_payment_reports(id) on delete cascade,
  user_id uuid not null,
  payment_id text not null,
  method text not null check(method in ('cash','bank')),
  primary key(report_id,method),
  unique(user_id,payment_id)
);
alter table public.route_report_payment_links enable row level security;
revoke all on public.route_report_payment_links from public,anon,authenticated;
insert into public.route_report_payment_links(report_id,user_id,payment_id,method)
  select id,user_id,confirmed_payment_id,method from public.route_payment_reports
  where status='confirmed' and confirmed_payment_id is not null and method in ('cash','bank')
  on conflict do nothing;
update public.route_payment_reports set
  confirmed_cash_amount=case when status='confirmed' then cash_amount else 0 end,
  confirmed_bank_amount=case when status='confirmed' then bank_amount else 0 end
where method<>'mixed';

create or replace function public.report_route_payment_split(p_user_id uuid,p_client_id text,p_published_at text,p_cash_amount numeric,p_bank_amount numeric)
returns void language plpgsql security definer set search_path = '' as $$
declare v_item jsonb; v_name text; v_method text;
begin
  if not coalesce(public.can_report_route_payment(p_user_id),false) then raise exception 'No tienes permiso para reportar pagos.'; end if;
  if p_cash_amount is null or p_bank_amount is null
    or p_cash_amount::text in ('NaN','Infinity','-Infinity') or p_bank_amount::text in ('NaN','Infinity','-Infinity')
    or p_cash_amount<0 or p_bank_amount<0 or p_cash_amount+p_bank_amount<=0
    or p_cash_amount+p_bank_amount>9999999999.99
    or p_cash_amount<>round(p_cash_amount,2) or p_bank_amount<>round(p_bank_amount,2) then
    raise exception 'Indica importes válidos de efectivo y banca, con hasta dos decimales.';
  end if;
  select data into v_item from public.active_route_items_cloud where user_id=p_user_id and client_id=p_client_id for update;
  if v_item is null or coalesce(v_item->>'removedAt','')<>'' or (v_item->>'publishedAt') is distinct from p_published_at then
    raise exception 'La unidad cambió o ya no está activa. Actualiza la ruta.';
  end if;
  v_method:=case when p_cash_amount>0 and p_bank_amount>0 then 'mixed' when p_cash_amount>0 then 'cash' else 'bank' end;
  select coalesce(nullif(email,''),'Buscador') into v_name from public.user_profiles where id=auth.uid();
  insert into public.route_payment_reports(user_id,client_id,published_at,snapshot,amount,method,cash_amount,bank_amount,reported_by,reporter_name)
    values(p_user_id,p_client_id,p_published_at,v_item,p_cash_amount+p_bank_amount,v_method,p_cash_amount,p_bank_amount,auth.uid(),v_name);
exception when unique_violation then raise exception 'Esta unidad ya tiene un reporte. Actualiza la ruta.';
end;
$$;

-- Compatibilidad con versiones anteriores: también usa la validación del servidor.
create or replace function public.report_route_payment(p_user_id uuid,p_client_id text,p_published_at text,p_amount numeric,p_method text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_method is null or p_method not in ('cash','bank') or p_amount is null or p_amount<=0 then
    raise exception 'Indica un monto válido y cómo pagó.';
  end if;
  perform public.report_route_payment_split(p_user_id,p_client_id,p_published_at,
    case when p_method='cash' then p_amount else 0 end,case when p_method='bank' then p_amount else 0 end);
end;
$$;

create or replace function public.route_report_matches_payment(r public.route_payment_reports,p jsonb)
returns boolean language sql stable set search_path = '' as $$
  select coalesce(p->>'clientId'=r.client_id
    and p->>'clientUnit'=r.snapshot->>'unitId'
    and coalesce(p->>'paymentContext','regular')='regular'
    and coalesce(nullif(p->>'fundsReceivedDate',''),p->>'dateApplied')=to_char(r.reported_at at time zone 'America/Panama','YYYY-MM-DD')
    and ((p->>'paymentMethod'='Efectivo' and r.cash_amount>0 and (p->>'amountReceived')::numeric=r.cash_amount)
      or (p->>'paymentMethod' in ('ACH Express','Deposito Bancario','Transferencia Bancaria') and r.bank_amount>0 and (p->>'amountReceived')::numeric=r.bank_amount)),false);
$$;

create or replace function public.refresh_route_report_confirmation(p_report_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.route_payment_reports; v_cash boolean; v_bank boolean; v_complete boolean;
begin
  select * into r from public.route_payment_reports where id=p_report_id for update;
  if not found or r.status='cancelled' then return; end if;
  select exists(select 1 from public.route_report_payment_links where report_id=r.id and method='cash'),
    exists(select 1 from public.route_report_payment_links where report_id=r.id and method='bank') into v_cash,v_bank;
  v_complete:=(r.cash_amount=0 or v_cash) and (r.bank_amount=0 or v_bank);
  update public.route_payment_reports set
    confirmed_cash_amount=case when v_cash then cash_amount else 0 end,
    confirmed_bank_amount=case when v_bank then bank_amount else 0 end,
    status=case when v_complete then 'confirmed' else 'review' end,
    confirmed_at=case when v_complete then coalesce(confirmed_at,clock_timestamp()) else null end,
    confirmed_payment_id=case when v_complete and method<>'mixed' then
      (select payment_id from public.route_report_payment_links where report_id=r.id limit 1) else null end
  where id=r.id;
end;
$$;

create or replace function public.sync_route_payment_report()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_report_id uuid; v_method text; v_link_method text; v_report public.route_payment_reports;
begin
  if tg_op in ('UPDATE','DELETE') then
    select report_id,method into v_report_id,v_link_method from public.route_report_payment_links where user_id=old.user_id and payment_id=old.id;
    if v_report_id is not null then
      select * into v_report from public.route_payment_reports where id=v_report_id for update;
      if tg_op='DELETE' then
        delete from public.route_report_payment_links where user_id=old.user_id and payment_id=old.id;
      else
        v_method:=case when new.data->>'paymentMethod'='Efectivo' then 'cash'
          when new.data->>'paymentMethod' in ('ACH Express','Deposito Bancario','Transferencia Bancaria') then 'bank' end;
        if new.user_id is distinct from old.user_id or new.id is distinct from old.id
          or v_method is distinct from v_link_method or not public.route_report_matches_payment(v_report,new.data) then
          delete from public.route_report_payment_links where user_id=old.user_id and payment_id=old.id;
        end if;
      end if;
      perform public.refresh_route_report_confirmation(v_report_id);
    end if;
    if tg_op='DELETE' then return old; end if;
    return new;
  end if;
  v_method:=case when new.data->>'paymentMethod'='Efectivo' then 'cash'
    when new.data->>'paymentMethod' in ('ACH Express','Deposito Bancario','Transferencia Bancaria') then 'bank' end;
  if v_method is null then return new; end if;
  -- Bloquear el reporte antes de examinar los vínculos evita perder una de dos
  -- confirmaciones simultáneas (efectivo y banca).
  for v_report in select r.* from public.route_payment_reports r
    where r.user_id=new.user_id and r.status='review' and public.route_report_matches_payment(r,new.data)
      and (new.data->>'createdAt')::timestamptz>=r.reported_at
    order by r.reported_at desc for update
  loop
    if not exists(select 1 from public.route_report_payment_links where report_id=v_report.id and method=v_method) then
      insert into public.route_report_payment_links(report_id,user_id,payment_id,method) values(v_report.id,new.user_id,new.id,v_method);
      perform public.refresh_route_report_confirmation(v_report.id);
      exit;
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function public.report_route_payment_split(uuid,text,text,numeric,numeric) from public;
revoke all on function public.refresh_route_report_confirmation(uuid) from public;
grant execute on function public.report_route_payment_split(uuid,text,text,numeric,numeric) to authenticated;
