-- Rentautos: corridas de cierre modularizadas
-- Ejecutar despues de las migraciones base de nube y RLS compartido.

create table if not exists public.charge_run_headers_cloud (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  closing_date text not null,
  target_date text not null,
  expected_clients integer not null default 0,
  charged_clients integer not null default 0,
  anomaly_clients integer not null default 0,
  charged_total numeric not null default 0,
  status text,
  created_at_text text not null,
  reverted_at text,
  reverted_reason text,
  reverted_by text,
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  constraint charge_run_headers_status_chk
    check (status is null or status in ('pending', 'completed', 'reverted'))
);

create table if not exists public.charge_run_snapshots_cloud (
  user_id uuid not null,
  run_id text not null,
  client_id text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, run_id, client_id),
  foreign key (user_id, run_id)
    references public.charge_run_headers_cloud(user_id, id)
    on delete cascade
);

create table if not exists public.charge_run_late_fee_entries_cloud (
  user_id uuid not null,
  run_id text not null,
  entry_id text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, run_id, entry_id),
  foreign key (user_id, run_id)
    references public.charge_run_headers_cloud(user_id, id)
    on delete cascade
);

create index if not exists charge_run_headers_user_target_idx
  on public.charge_run_headers_cloud (user_id, target_date desc);
create index if not exists charge_run_headers_user_closing_idx
  on public.charge_run_headers_cloud (user_id, closing_date desc);
create index if not exists charge_run_snapshots_run_idx
  on public.charge_run_snapshots_cloud (user_id, run_id);
create index if not exists charge_run_late_fee_entries_run_idx
  on public.charge_run_late_fee_entries_cloud (user_id, run_id);

alter table public.charge_run_headers_cloud enable row level security;
alter table public.charge_run_snapshots_cloud enable row level security;
alter table public.charge_run_late_fee_entries_cloud enable row level security;

drop policy if exists "charge_run_headers_shared_owner_access" on public.charge_run_headers_cloud;
create policy "charge_run_headers_shared_owner_access" on public.charge_run_headers_cloud
for all to authenticated
using (public.can_access_owner_data(user_id))
with check (public.can_access_owner_data(user_id));

drop policy if exists "charge_run_snapshots_shared_owner_access" on public.charge_run_snapshots_cloud;
create policy "charge_run_snapshots_shared_owner_access" on public.charge_run_snapshots_cloud
for all to authenticated
using (public.can_access_owner_data(user_id))
with check (public.can_access_owner_data(user_id));

drop policy if exists "charge_run_late_fee_entries_shared_owner_access" on public.charge_run_late_fee_entries_cloud;
create policy "charge_run_late_fee_entries_shared_owner_access" on public.charge_run_late_fee_entries_cloud
for all to authenticated
using (public.can_access_owner_data(user_id))
with check (public.can_access_owner_data(user_id));

-- Copia historico legacy desde charge_runs_cloud, separando encabezado y detalles.
insert into public.charge_run_headers_cloud (
  user_id,
  id,
  closing_date,
  target_date,
  expected_clients,
  charged_clients,
  anomaly_clients,
  charged_total,
  status,
  created_at_text,
  reverted_at,
  reverted_reason,
  reverted_by,
  updated_at
)
select
  legacy.user_id,
  legacy.id,
  legacy.data->>'closingDate',
  legacy.data->>'targetDate',
  coalesce(nullif(legacy.data->>'expectedClients', '')::integer, 0),
  coalesce(nullif(legacy.data->>'chargedClients', '')::integer, 0),
  coalesce(nullif(legacy.data->>'anomalyClients', '')::integer, 0),
  coalesce(nullif(legacy.data->>'chargedTotal', '')::numeric, 0),
  case
    when legacy.data->>'status' in ('pending', 'completed', 'reverted') then legacy.data->>'status'
    else null
  end,
  coalesce(legacy.data->>'createdAt', legacy.updated_at::text),
  legacy.data->>'revertedAt',
  legacy.data->>'revertedReason',
  legacy.data->>'revertedBy',
  legacy.updated_at
from public.charge_runs_cloud legacy
where legacy.data ? 'closingDate'
  and legacy.data ? 'targetDate'
on conflict (user_id, id) do update set
  closing_date = excluded.closing_date,
  target_date = excluded.target_date,
  expected_clients = excluded.expected_clients,
  charged_clients = excluded.charged_clients,
  anomaly_clients = excluded.anomaly_clients,
  charged_total = excluded.charged_total,
  status = excluded.status,
  created_at_text = excluded.created_at_text,
  reverted_at = excluded.reverted_at,
  reverted_reason = excluded.reverted_reason,
  reverted_by = excluded.reverted_by,
  updated_at = excluded.updated_at;

insert into public.charge_run_snapshots_cloud (
  user_id,
  run_id,
  client_id,
  data,
  updated_at
)
select
  legacy.user_id,
  legacy.id,
  coalesce(snapshot.value->>'clientId', 'row-' || snapshot.ordinality::text),
  snapshot.value,
  legacy.updated_at
from public.charge_runs_cloud legacy
cross join lateral jsonb_array_elements(coalesce(legacy.data->'clientSnapshots', '[]'::jsonb))
  with ordinality as snapshot(value, ordinality)
where legacy.data ? 'closingDate'
  and legacy.data ? 'targetDate'
on conflict (user_id, run_id, client_id) do update set
  data = excluded.data,
  updated_at = excluded.updated_at;

insert into public.charge_run_late_fee_entries_cloud (
  user_id,
  run_id,
  entry_id,
  updated_at
)
select
  legacy.user_id,
  legacy.id,
  fee.value #>> '{}',
  legacy.updated_at
from public.charge_runs_cloud legacy
cross join lateral jsonb_array_elements(coalesce(legacy.data->'lateFeeEntryIds', '[]'::jsonb))
  with ordinality as fee(value, ordinality)
where legacy.data ? 'closingDate'
  and legacy.data ? 'targetDate'
  and fee.value #>> '{}' <> ''
on conflict (user_id, run_id, entry_id) do update set
  updated_at = excluded.updated_at;
