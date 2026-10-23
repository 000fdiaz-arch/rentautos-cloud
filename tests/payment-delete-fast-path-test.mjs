import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "../.tmp/lead-portal-tests/node_modules/@electric-sql/pglite/dist/index.js";

const db = new PGlite();
const owner = "11111111-1111-4111-8111-111111111111";

try {
  await db.exec(`
    create role authenticated;
    create role anon;

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
      updated_at timestamptz default now(),
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
    create table public.fast_path_calls(kind text not null, client_id text not null);

    create function public.receivable_identity_unit(value text)
    returns text language sql immutable as $$select upper(trim(coalesce(value, '')))$$;
    create function public.rebuild_latest_payment_for_client(target_owner uuid, target_client text)
    returns void language plpgsql as $$
    begin
      insert into public.fast_path_calls(kind, client_id) values ('latest', target_client);
    end;
    $$;
    create function public.payment_has_other_charges_retention(payload jsonb)
    returns boolean language sql immutable as $$select coalesce((payload->>'retention')::boolean, false)$$;
    create function public.refresh_other_charges_retention_checkpoint(target_owner uuid, target_client text)
    returns void language plpgsql as $$
    begin
      insert into public.fast_path_calls(kind, client_id) values ('retention', target_client);
    end;
    $$;

    insert into public.clients_cloud(user_id,id,data) values
      ('${owner}', 'client-t25', '{"id":"client-t25","unitId":"T25","status":"Activo"}');
    insert into public.payments_cloud(user_id,id,data) values
      ('${owner}', 'payment-old', '{"id":"payment-old","clientId":"client-t25","clientUnit":"T25","dateApplied":"2026-10-01","createdAt":"2026-10-01T12:00:00Z"}'),
      ('${owner}', 'payment-latest', '{"id":"payment-latest","clientId":"client-t25","clientUnit":"T25","dateApplied":"2026-10-20","createdAt":"2026-10-20T12:00:00Z"}'),
      ('${owner}', 'payment-retention', '{"id":"payment-retention","clientId":"client-t25","clientUnit":"T25","dateApplied":"2026-10-10","createdAt":"2026-10-10T12:00:00Z","retention":true}');
    insert into public.latest_payments_by_client_cloud(user_id,client_id,payment_id,data)
    values ('${owner}', 'client-t25', 'payment-latest', '{"id":"payment-latest"}');
  `);

  const rootSql = readFileSync("supabase/116-payment-deletion-fast-paths.sql", "utf8");
  const migrationSql = readFileSync("supabase/migrations/20261022000200_payment_deletion_fast_paths.sql", "utf8");
  assert.equal(rootSql, migrationSql, "La migracion y su copia numerada deben permanecer identicas.");
  await db.exec(rootSql);
  await db.exec(rootSql);
  await db.exec(`
    create trigger refresh_latest_payment_for_payment_row
    after insert or update or delete on public.payments_cloud
    for each row execute function public.refresh_latest_payment_for_payment_row();
    create trigger payments_cloud_other_charges_retention_checkpoint
    after insert or update or delete on public.payments_cloud
    for each row execute function public.sync_other_charges_retention_checkpoint_from_payment();
  `);

  await db.exec("delete from public.payments_cloud where id = 'payment-old'");
  let calls = await db.query("select kind from public.fast_path_calls order by kind");
  assert.deepEqual(calls.rows, [], "Una factura anterior sin retencion no debe reconstruir caches.");

  await db.exec("delete from public.payments_cloud where id = 'payment-latest'");
  calls = await db.query("select kind,client_id from public.fast_path_calls order by kind");
  assert.deepEqual(calls.rows, [{ kind: "latest", client_id: "client-t25" }], "Solo el ultimo pago debe reconstruir el cache historico.");

  await db.exec("delete from public.fast_path_calls; delete from public.payments_cloud where id = 'payment-retention'");
  calls = await db.query("select kind,client_id from public.fast_path_calls order by kind");
  assert.deepEqual(calls.rows, [{ kind: "retention", client_id: "client-t25" }], "Una factura con retencion debe conservar su mantenimiento.");

  await db.exec(`
    insert into public.payments_cloud(user_id,id,data) values
      ('${owner}', 'payment-retention-update', '{"id":"payment-retention-update","clientId":"client-t25","clientUnit":"T25","dateApplied":"2026-10-15","createdAt":"2026-10-15T12:00:00Z","retention":true}');
    delete from public.fast_path_calls;
    update public.payments_cloud
    set data = data || '{"reference":"updated"}'::jsonb
    where id = 'payment-retention-update';
  `);
  calls = await db.query("select kind,client_id from public.fast_path_calls where kind = 'retention'");
  assert.deepEqual(calls.rows, [{ kind: "retention", client_id: "client-t25" }], "Una edicion con retencion debe refrescar el cliente una sola vez.");

  const indexes = await db.query("select indexname from pg_indexes where indexname = 'latest_payments_owner_payment_idx'");
  assert.equal(indexes.rows.length, 1, "La consulta directa del ultimo pago debe estar indexada.");

  console.log("OK eliminacion rapida: facturas anteriores y sin retencion omiten trabajo; casos aplicables conservan sus caches.");
} finally {
  await db.close();
}
