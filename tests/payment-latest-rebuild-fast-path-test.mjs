import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "../.tmp/lead-portal-tests/node_modules/@electric-sql/pglite/dist/index.js";

const db = new PGlite();
const owner = "11111111-1111-4111-8111-111111111111";

try {
  await db.exec(`
    create table public.clients_cloud(
      user_id uuid not null,
      id text not null,
      data jsonb not null,
      primary key(user_id, id)
    );
    create table public.payments_cloud(
      user_id uuid not null,
      id text not null,
      data jsonb not null,
      primary key(user_id, id)
    );
    create table public.latest_payments_by_client_cloud(
      user_id uuid not null,
      client_id text not null,
      payment_id text not null,
      client_unit text,
      date_applied text,
      created_at_payment text,
      data jsonb not null,
      updated_at timestamptz,
      primary key(user_id, client_id)
    );
    create function public.receivable_identity_unit(value text)
    returns text language sql immutable as $$
      select upper(regexp_replace(coalesce(value, ''), '[^a-zA-Z0-9]', '', 'g'))
    $$;
    create function public.receivable_identity_cedula(value text)
    returns text language sql immutable as $$
      select regexp_replace(coalesce(value, ''), '[^0-9]', '', 'g')
    $$;
    create function public.receivable_identity_name(value text)
    returns text language sql immutable as $$select lower(trim(coalesce(value, '')))$$;
    create function public.receivable_payment_matches_client(payment jsonb, client_id text, client jsonb)
    returns boolean language sql immutable as $$
      select coalesce(payment->>'clientId', '') = coalesce(client_id, '')
        or (
          public.receivable_identity_unit(payment->>'clientUnit') <> ''
          and public.receivable_identity_unit(payment->>'clientUnit') = public.receivable_identity_unit(client->>'unitId')
          and public.receivable_identity_cedula(payment->>'clientCedula') <> ''
          and public.receivable_identity_cedula(payment->>'clientCedula') = public.receivable_identity_cedula(client->>'cedula')
        )
    $$;
    create index payments_cloud_user_client_id_latest_idx
      on public.payments_cloud(user_id,(data->>'clientId'),(data->>'dateApplied') desc,(data->>'createdAt') desc,id desc)
      where nullif(data->>'clientId', '') is not null;
    create index payments_cloud_user_receivable_unit_latest_idx
      on public.payments_cloud(user_id,public.receivable_identity_unit(data->>'clientUnit'),(data->>'dateApplied') desc,(data->>'createdAt') desc,id desc)
      where nullif(data->>'clientUnit', '') is not null;

    insert into public.clients_cloud(user_id,id,data) values
      ('${owner}','client-new','{"id":"client-new","unitId":"T-25","cedula":"8-123-456","status":"activo"}');
    insert into public.payments_cloud(user_id,id,data) values
      ('${owner}','direct-old','{"id":"direct-old","clientId":"client-new","clientUnit":"T-25","dateApplied":"2026-10-01","createdAt":"2026-10-01T10:00:00Z"}'),
      ('${owner}','legacy-latest','{"id":"legacy-latest","clientId":"client-old","clientUnit":"T25","clientCedula":"8-123-456","dateApplied":"2026-11-01","createdAt":"2026-11-01T10:00:00Z"}'),
      ('${owner}','wrong-person','{"id":"wrong-person","clientId":"other","clientUnit":"T25","clientCedula":"9-999-999","dateApplied":"2026-11-10","createdAt":"2026-11-10T10:00:00Z"}');
  `);

  const rootSql = readFileSync("supabase/131-payment-latest-rebuild-fast-path.sql", "utf8");
  const migrationSql = readFileSync("supabase/migrations/20261118000100_payment_latest_rebuild_fast_path.sql", "utf8");
  assert.equal(rootSql, migrationSql, "La migracion y su copia numerada deben permanecer identicas.");
  await db.exec(rootSql);
  await db.exec(rootSql);

  await db.query("select public.rebuild_latest_payment_for_client($1,$2)", [owner, "client-new"]);
  const latest = await db.query("select payment_id from public.latest_payments_by_client_cloud where user_id=$1 and client_id=$2", [owner, "client-new"]);
  assert.equal(latest.rows[0]?.payment_id, "legacy-latest", "Debe conservar el pago legacy mas reciente que coincide por unidad e identidad.");

  assert.match(rootSql, /nullif\(direct_payment\.data->>'clientId', ''\) is not null/, "La ruta directa debe habilitar su indice parcial.");
  assert.match(rootSql, /nullif\(unit_payment\.data->>'clientUnit', ''\) is not null/, "La ruta por unidad debe habilitar su indice parcial.");
  assert.equal((rootSql.match(/limit 1/g) ?? []).length >= 4, true, "Cada rama debe limitar candidatos antes de unirlos.");
  const indexes = await db.query("select indexname from pg_indexes where indexname like 'payments_cloud_user_%_latest_nl_idx' order by indexname");
  assert.deepEqual(indexes.rows.map((row) => row.indexname), [
    "payments_cloud_user_client_id_latest_nl_idx",
    "payments_cloud_user_receivable_unit_latest_nl_idx"
  ], "La consulta debe tener indices con el mismo orden nulls last.");

  console.log("OK reconstruccion de ultimo pago: usa rutas indexadas y conserva coincidencias legacy seguras.");
} finally {
  await db.close();
}
