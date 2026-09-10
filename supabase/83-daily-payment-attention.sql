-- Checklist diario compartido para pagos bancarios sin centavos.
-- Solo conserva una fecha por empresa; un nuevo día reemplaza el estado anterior.
create table if not exists public.daily_payment_attention_cloud (
  user_id uuid primary key references auth.users(id) on delete cascade,
  work_date date not null,
  payment_ids text[] not null default '{}',
  updated_at timestamptz not null default now()
);

alter table public.daily_payment_attention_cloud enable row level security;

drop policy if exists "daily_payment_attention_read" on public.daily_payment_attention_cloud;
create policy "daily_payment_attention_read"
on public.daily_payment_attention_cloud
for select
to authenticated
using ((select public.can_view_owner_screen(user_id, 'payments')));

drop policy if exists "daily_payment_attention_insert" on public.daily_payment_attention_cloud;
create policy "daily_payment_attention_insert"
on public.daily_payment_attention_cloud
for insert
to authenticated
with check ((select public.can_edit_owner_screen(user_id, 'payments')));

drop policy if exists "daily_payment_attention_update" on public.daily_payment_attention_cloud;
create policy "daily_payment_attention_update"
on public.daily_payment_attention_cloud
for update
to authenticated
using ((select public.can_edit_owner_screen(user_id, 'payments')))
with check ((select public.can_edit_owner_screen(user_id, 'payments')));

revoke insert, update, delete on public.daily_payment_attention_cloud from authenticated;
grant select on public.daily_payment_attention_cloud to authenticated;

create or replace function public.set_daily_payment_attention(
  p_owner_user_id uuid,
  p_work_date date,
  p_payment_id text,
  p_checked boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_is_valid_payment boolean;
  v_row public.daily_payment_attention_cloud%rowtype;
begin
  if auth.uid() is null
     or not coalesce(public.can_edit_owner_screen(p_owner_user_id, 'payments'), false) then
    raise exception 'No autorizado para actualizar llamados de pagos';
  end if;

  if p_work_date is null or coalesce(btrim(p_payment_id), '') = '' or p_checked is null then
    raise exception 'Fecha, pago y estado son requeridos';
  end if;

  select exists(
    select 1
    from public.payments_cloud payment
    where payment.user_id = p_owner_user_id
      and payment.id = p_payment_id
      and payment.data->>'dateApplied' = p_work_date::text
      and payment.data->>'paymentMethod' in ('ACH Express', 'Deposito Bancario', 'Transferencia Bancaria')
      and mod(abs(round(coalesce(nullif(payment.data->>'amountReceived', '')::numeric, 0) * 100)), 100) = 0
  ) into v_is_valid_payment;

  if not v_is_valid_payment then
    raise exception 'El pago no corresponde a un pago bancario sin centavos de la fecha indicada';
  end if;

  insert into public.daily_payment_attention_cloud as attention (
    user_id,
    work_date,
    payment_ids,
    updated_at
  )
  values (
    p_owner_user_id,
    p_work_date,
    case when p_checked then array[p_payment_id] else '{}'::text[] end,
    now()
  )
  on conflict (user_id) do update
  set work_date = excluded.work_date,
      payment_ids = case
        when attention.work_date <> excluded.work_date then excluded.payment_ids
        when p_checked then array(
          select distinct payment_id
          from unnest(attention.payment_ids || array[p_payment_id]) as item(payment_id)
          order by payment_id
        )
        else array_remove(attention.payment_ids, p_payment_id)
      end,
      updated_at = now()
  returning * into v_row;

  return jsonb_build_object(
    'workDate', v_row.work_date::text,
    'paymentIds', to_jsonb(v_row.payment_ids)
  );
end;
$$;

grant execute on function public.set_daily_payment_attention(uuid, date, text, boolean) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'daily_payment_attention_cloud'
     ) then
    alter publication supabase_realtime add table public.daily_payment_attention_cloud;
  end if;
end
$$;
