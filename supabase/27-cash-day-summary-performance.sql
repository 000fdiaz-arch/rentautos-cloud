-- Rentautos: optimiza cash_day_summary_vw para consultas por dia/owner.
-- La version anterior agregaba todos los movimientos y ajustes antes de filtrar
-- por apertura, lo que podia causar statement timeout en cierres de caja.

create or replace view public.cash_day_summary_vw
with (security_invoker = true) as
select
  o.owner_user_id,
  o.opening_date,
  o.opening_balance,
  coalesce(m.income_total, 0) as income_total,
  coalesce(m.expense_total, 0) as expense_total,
  coalesce(a.adjustment_income_total, 0) as adjustment_income_total,
  coalesce(a.adjustment_expense_total, 0) as adjustment_expense_total,
  (o.opening_balance + coalesce(m.income_total, 0) + coalesce(a.adjustment_income_total, 0)
   - coalesce(m.expense_total, 0) - coalesce(a.adjustment_expense_total, 0)) as expected_balance,
  c.counted_balance,
  c.difference_balance,
  c.status,
  c.closed_at
from public.cash_day_openings o
left join lateral (
  select
    sum(case when m.movement_type = 'income' then m.amount else 0 end) as income_total,
    sum(case when m.movement_type = 'expense' then m.amount else 0 end) as expense_total
  from public.cash_day_movements m
  where m.owner_user_id = o.owner_user_id
    and m.opening_date = o.opening_date
) m on true
left join lateral (
  select
    sum(case when a.adjustment_type = 'income_adjustment' then a.amount else 0 end) as adjustment_income_total,
    sum(case when a.adjustment_type = 'expense_adjustment' then a.amount else 0 end) as adjustment_expense_total
  from public.cash_day_adjustments a
  where a.owner_user_id = o.owner_user_id
    and a.opening_date = o.opening_date
) a on true
left join public.cash_day_closings c
  on c.owner_user_id = o.owner_user_id and c.opening_date = o.opening_date;
