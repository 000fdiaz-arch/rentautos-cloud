import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "../.tmp/lead-portal-tests/node_modules/@electric-sql/pglite/dist/index.js";

const db = new PGlite();
const owner = "11111111-1111-4111-8111-111111111111";
const otherOwner = "22222222-2222-4222-8222-222222222222";
const portal = "33333333-3333-4333-8333-333333333333";

try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table public.seller_lead_portals(
      id uuid primary key,
      user_id uuid not null references auth.users(id),
      enabled boolean not null default true
    );
    create function public.seller_lead_cedula_key(value text) returns text
      language sql immutable as $$ select regexp_replace(coalesce(value, ''), '[^0-9]', '', 'g') $$;
    create function public.check_seller_lead_portal_limit(portal_id uuid, operation_name text) returns void
      language plpgsql as $$ begin return; end $$;
    create function public.seller_lead_public_result(owner_id uuid, cedula_key text) returns jsonb
      language sql stable as $$ select jsonb_build_object('status', 'not_found') $$;
    insert into auth.users(id) values ('${owner}'), ('${otherOwner}');
    insert into public.seller_lead_portals(id,user_id) values ('${portal}','${owner}');
  `);

  const rootSql = readFileSync("supabase/120-seller-consultation-attribution.sql", "utf8");
  const migrationSql = readFileSync("supabase/migrations/20261104000200_seller_consultation_attribution.sql", "utf8");
  assert.equal(rootSql, migrationSql, "La migración y su copia numerada deben permanecer idénticas.");
  await db.exec(rootSql);

  const first = (await db.query(
    "select public.lookup_seller_lead_attributed($1,$2,$3) as value",
    [portal, "8-888-888", "Carlos Méndez"]
  )).rows[0].value;
  assert.equal(first.alreadyConsulted, false);
  assert.equal(first.consultationCount, 1);

  const second = (await db.query(
    "select public.lookup_seller_lead_attributed($1,$2,$3) as value",
    [portal, "8-888-888", "Mixsy P."]
  )).rows[0].value;
  assert.equal(second.alreadyConsulted, true);
  assert.equal(second.consultationCount, 2);

  const history = (await db.query(`
    select seller_name, consultation_kind
    from public.seller_lead_consultations
    order by consulted_at, id
  `)).rows;
  assert.deepEqual(history, [
    { seller_name: "Carlos Méndez", consultation_kind: "original" },
    { seller_name: "Mixsy P.", consultation_kind: "follow_up" }
  ]);

  await assert.rejects(
    db.query("select public.lookup_seller_lead_attributed($1,$2,$3)", [portal, "8-999-999", "X"]),
    /Vendedor no valido/
  );

  await db.exec(`grant usage on schema public, auth to authenticated; grant select on public.seller_lead_consultations to authenticated; grant execute on function auth.uid() to authenticated;`);
  await db.exec(`set role authenticated; set request.jwt.claim.sub = '${owner}';`);
  assert.equal((await db.query("select count(*)::int as total from public.seller_lead_consultations")).rows[0].total, 2);
  await db.exec(`reset role; set role authenticated; set request.jwt.claim.sub = '${otherOwner}';`);
  assert.equal((await db.query("select count(*)::int as total from public.seller_lead_consultations")).rows[0].total, 0);

  console.log("OK seller attribution: first owner retained, repeats logged, names validated and history isolated by RLS.");
} finally {
  await db.close();
}
