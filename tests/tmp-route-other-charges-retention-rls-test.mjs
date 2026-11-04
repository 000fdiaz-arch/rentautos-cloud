import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "../.tmp/lead-portal-tests/node_modules/@electric-sql/pglite/dist/index.js";

const db = new PGlite();
const owner = "11111111-1111-4111-8111-111111111111";
const routeOperator = "22222222-2222-4222-8222-222222222222";
const unrelatedUser = "33333333-3333-4333-8333-333333333333";
const clientId = "e0f4e11c-9ef0-4176-9338-f993895f0960";

try {
  await db.exec(`
    create role authenticated;
    create schema auth;

    create function auth.uid()
    returns uuid
    language sql
    stable
    as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;

    create function public.can_view_owner_screen(target_user_id uuid, screen_name text)
    returns boolean
    language sql
    stable
    as $$
      select
        target_user_id = '${owner}'::uuid
        and screen_name = 'route_search'
        and auth.uid() = '${routeOperator}'::uuid
    $$;

    create table public.other_charges_retention_cloud (
      user_id uuid primary key,
      data jsonb not null,
      updated_at timestamptz not null default now()
    );

    insert into public.other_charges_retention_cloud(user_id, data)
    values (
      '${owner}',
      jsonb_build_object('${clientId}', jsonb_build_object('cycle', 'weekly', 'amount', 0))
    );

    alter table public.other_charges_retention_cloud enable row level security;
    grant usage on schema auth to authenticated;
    grant usage on schema public to authenticated;
    grant execute on function auth.uid() to authenticated;
    grant execute on function public.can_view_owner_screen(uuid, text) to authenticated;
    grant select, update on public.other_charges_retention_cloud to authenticated;
  `);

  const rootSql = readFileSync("supabase/118-route-other-charges-retention-read.sql", "utf8");
  const migrationSql = readFileSync("supabase/migrations/20261024000300_route_other_charges_retention_read.sql", "utf8");
  assert.equal(rootSql, migrationSql, "La migracion y su copia numerada deben permanecer identicas.");
  await db.exec(rootSql);

  await db.exec(`set role authenticated; set request.jwt.claim.sub = '${routeOperator}';`);
  const visibleRows = (await db.query(`
    select data->'${clientId}'->>'amount' as amount
    from public.other_charges_retention_cloud
    where user_id = '${owner}'
  `)).rows;
  assert.equal(visibleRows.length, 1, "Un operador solo Ruta debe poder leer la retencion del propietario.");
  assert.equal(Number(visibleRows[0].amount), 0, "La retencion explicita de A13 debe conservarse en cero.");

  await db.query(`
    update public.other_charges_retention_cloud
    set data = jsonb_set(data, '{${clientId},amount}', '5'::jsonb)
    where user_id = '${owner}'
  `);

  await db.exec(`reset role; reset request.jwt.claim.sub;`);
  const unchangedAmount = (await db.query(`
    select data->'${clientId}'->>'amount' as amount
    from public.other_charges_retention_cloud
    where user_id = '${owner}'
  `)).rows[0];
  assert.equal(Number(unchangedAmount.amount), 0, "Ruta debe tener lectura, nunca permiso para cambiar la retencion.");

  await db.exec(`set role authenticated; set request.jwt.claim.sub = '${unrelatedUser}';`);
  const hiddenRows = (await db.query("select * from public.other_charges_retention_cloud")).rows;
  assert.equal(hiddenRows.length, 0, "Un usuario ajeno no debe poder leer la configuracion del propietario.");

  console.log("OK Ruta RLS: operador solo Ruta lee retencion 0, no puede modificarla y no filtra datos ajenos.");
} finally {
  await db.close();
}
