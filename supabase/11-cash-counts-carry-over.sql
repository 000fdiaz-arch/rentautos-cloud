-- Rentautos: heredar conteo fisico al abrir jornada
-- Ejecutar despues de 08-daily-cash-ledger.sql y 09-cash-day-counts.sql

create or replace function public.open_cash_day(
  p_opening_date date default ((now() at time zone 'America/Panama')::date),
  p_seed_opening_balance numeric default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_user_id uuid := public.current_data_owner_user_id();
  v_existing_id uuid;
  v_previous_date date := (p_opening_date - 1);
  v_previous_status public.cash_day_status;
  v_previous_counted numeric(14,2);
  v_previous_expected numeric(14,2);
  v_opening_balance numeric(14,2);
  v_source text;
begin
  if not public.has_role('admin') then
    raise exception 'Solo admin puede abrir caja diaria.';
  end if;

  select id
  into v_existing_id
  from public.cash_day_openings o
  where o.owner_user_id = v_owner_user_id
    and o.opening_date = p_opening_date
  limit 1;

  if v_existing_id is not null then
    return v_existing_id;
  end if;

  select c.status, c.counted_balance, c.expected_balance
  into v_previous_status, v_previous_counted, v_previous_expected
  from public.cash_day_closings c
  where c.owner_user_id = v_owner_user_id
    and c.opening_date = v_previous_date
  limit 1;

  if v_previous_status = 'closed' and coalesce(v_previous_counted, v_previous_expected) is not null then
    v_opening_balance := coalesce(v_previous_counted, v_previous_expected);
    v_source := 'carry_over';
  elsif p_seed_opening_balance is not null then
    v_opening_balance := p_seed_opening_balance;
    v_source := 'manual_seed';
  else
    raise exception 'No existe cierre previo para % y no se envio saldo inicial manual.', p_opening_date;
  end if;

  insert into public.cash_day_openings (
    owner_user_id, opening_date, opening_balance, source, note, opened_by
  ) values (
    v_owner_user_id, p_opening_date, v_opening_balance, v_source, p_note, auth.uid()
  )
  returning id into v_existing_id;

  insert into public.cash_day_closings (
    owner_user_id, opening_date, status, expected_balance
  ) values (
    v_owner_user_id, p_opening_date, 'open', v_opening_balance
  )
  on conflict (owner_user_id, opening_date) do nothing;

  if to_regclass('public.cash_day_counts') is not null then
    insert into public.cash_day_counts (
      owner_user_id,
      opening_date,
      denomination_type,
      denomination_value,
      qty,
      created_by
    )
    select
      v_owner_user_id,
      p_opening_date,
      prev.denomination_type,
      prev.denomination_value,
      prev.qty,
      auth.uid()
    from public.cash_day_counts prev
    where prev.owner_user_id = v_owner_user_id
      and prev.opening_date = v_previous_date
      and prev.qty > 0
    on conflict (owner_user_id, opening_date, denomination_type, denomination_value)
    do nothing;
  end if;

  return v_existing_id;
end;
$$;
