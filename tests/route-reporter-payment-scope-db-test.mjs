import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "../.tmp/lead-portal-tests/node_modules/@electric-sql/pglite/dist/index.js";

const sql = readFileSync("supabase/95-route-reporter-payment-scope.sql", "utf8");
const owner = "11111111-1111-4111-8111-111111111111";
const delta = "22222222-2222-4222-8222-222222222222";
const outsider = "33333333-3333-4333-8333-333333333333";
const db = new PGlite();

try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;

    create table public.user_profiles(
      id uuid primary key,
      owner_id uuid not null,
      can_report_route boolean not null default false,
      can_edit_payments boolean not null default false
    );
    insert into public.user_profiles values
      ('${delta}', '${owner}', true, false),
      ('${outsider}', '${outsider}', true, false);

    create function public.can_report_route_payment(p_owner uuid)
    returns boolean language sql stable security definer set search_path = public as $$
      select exists(
        select 1 from public.user_profiles
        where id = auth.uid() and owner_id = p_owner and can_report_route
      )
    $$;
    create function public.can_edit_owner_screen(p_owner uuid, p_screen text)
    returns boolean language sql stable security definer set search_path = public as $$
      select exists(
        select 1 from public.user_profiles
        where id = auth.uid() and owner_id = p_owner
          and p_screen = 'payments' and can_edit_payments
      )
    $$;

    create table public.payments_cloud(
      user_id uuid not null,
      id text not null,
      data jsonb not null,
      primary key(user_id, id)
    );
    create table public.notified_payments_cloud(
      user_id uuid not null,
      id text not null,
      data jsonb not null,
      primary key(user_id, id)
    );
    alter table public.payments_cloud enable row level security;
    alter table public.notified_payments_cloud enable row level security;
    grant usage on schema public to authenticated;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;
    grant insert, update on public.payments_cloud to authenticated;
    grant insert on public.notified_payments_cloud to authenticated;
  `);

  await db.exec(sql);
  await db.exec(sql);

  const login = async (id) => db.exec(`reset role; set request.jwt.claim.sub='${id}'; set role authenticated;`);

  await login(delta);
  await db.exec(`insert into payments_cloud values ('${owner}', 'cash-1', '{"source":"route"}')`);
  await db.exec(`insert into notified_payments_cloud values ('${owner}', 'bank-1', '{"source":"route","paymentMethod":"bank"}')`);
  await assert.rejects(
    db.exec(`insert into payments_cloud values ('${owner}', 'manual-1', '{"source":"payments"}')`),
    /row-level security|No autorizado|permission denied/
  );
  await assert.rejects(
    db.exec(`update payments_cloud set data='{"source":"route","changed":true}' where user_id='${owner}' and id='cash-1'`),
    /row-level security|No autorizado|permission denied/
  );

  await login(outsider);
  await assert.rejects(
    db.exec(`insert into payments_cloud values ('${owner}', 'cash-2', '{"source":"route"}')`),
    /row-level security|No autorizado|permission denied/
  );
} finally {
  await db.close();
}

console.log("OK: Delta puede emitir recibos de Ruta sin obtener permisos generales de Pagos.");
