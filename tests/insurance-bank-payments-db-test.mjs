import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "../.tmp/lead-portal-tests/node_modules/@electric-sql/pglite/dist/index.js";

const sql = readFileSync("supabase/110-insurance-bank-payments.sql", "utf8");
const forwardingFixSql = readFileSync("supabase/118-insurance-bank-payments-forwarding-fix.sql", "utf8");
assert.equal(
  sql,
  readFileSync("supabase/migrations/20261024000100_insurance_bank_payments.sql", "utf8"),
  "the numbered SQL and migration must remain identical"
);
assert.equal(
  forwardingFixSql,
  readFileSync("supabase/migrations/20261024000150_insurance_bank_payments_forwarding_fix.sql", "utf8"),
  "the forwarding fix SQL and migration must remain identical"
);

const db = new PGlite();
const owner = "11111111-1111-4111-8111-111111111111";

try {
  await db.exec(`
    create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key);
    insert into auth.users values ('${owner}');
    create function auth.uid() returns uuid language sql stable as $$ select '${owner}'::uuid $$;
    create function public.can_edit_owner_screen(uuid,text) returns boolean language sql stable as $$ select true $$;
    create function public.can_view_owner_screen(uuid,text) returns boolean language sql stable as $$ select true $$;
    create function public.can_access_owner_data(uuid) returns boolean language sql stable as $$ select true $$;
    create function public.extract_payment_folio(text) returns text language sql immutable as $$ select upper(coalesce($1,'')) $$;
    create table public.pending_bank_items_cloud(
      user_id uuid not null references auth.users(id), id text not null, data jsonb not null,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
      primary key(user_id,id)
    );
    create table public.insurance_claims_cloud(
      user_id uuid not null references auth.users(id), id text not null, data jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
      primary key(user_id,id)
    );
    create table public.payments_cloud(
      user_id uuid not null references auth.users(id), id text not null, data jsonb not null,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
      primary key(user_id,id)
    );
  `);
  await db.exec(sql);
  await db.exec(sql);
  await db.exec(forwardingFixSql);

  const bankItem = (folio, amount) => ({
    folio, dateApplied: "2026-10-24", amountReceived: amount, capitalPart: amount,
    centsPart: 0, referenceId: "", extractedName: "ASEGURADORA", description: "RECLAMO",
    importedAt: "2026-10-24T12:00:00.000Z"
  });
  await db.query("insert into pending_bank_items_cloud(user_id,id,data) values($1,$2,$3),($1,$4,$5)", [
    owner, "FOLIO-1", bankItem("FOLIO-1", 1000), "FOLIO-2", bankItem("FOLIO-2", 2000)
  ]);
  await db.query("insert into insurance_claims_cloud(user_id,id,data) values($1,$2,$3)", [owner, "CLAIM-1", { id: "CLAIM-1" }]);

  const forwarded = await db.query(
    "select * from forward_bank_items_to_insurance($1,$2::jsonb,$3)",
    [owner, [bankItem("FOLIO-1", 1000), bankItem("FOLIO-2", 2000)], "Administración"]
  );
  assert.equal(forwarded.rows.length, 2, "debe trasladar todos los folios seleccionados");
  assert.equal((await db.query("select count(*)::int as count from pending_bank_items_cloud")).rows[0].count, 0);
  assert.equal((await db.query("select count(*)::int as count from insurance_bank_payments_cloud")).rows[0].count, 2);

  const processed = await db.query("select find_existing_processed_payment_folios($1,$2::text[]) as folios", [owner, ["FOLIO-1", "NUEVO"]]);
  assert.deepEqual(processed.rows[0].folios, ["FOLIO-1"], "un folio en Seguros no debe reimportarse");

  const linked = await db.query("select set_insurance_bank_payment_claim($1,$2,$3) as data", [owner, "folio-FOLIO-1", "CLAIM-1"]);
  assert.equal(linked.rows[0].data.status, "linked");
  assert.equal(linked.rows[0].data.claimId, "CLAIM-1");

  await db.query("select set_insurance_bank_payment_claim($1,$2,null) as data", [owner, "folio-FOLIO-1"]);
  const returned = await db.query("select return_insurance_bank_payment_to_payments($1,$2) as data", [owner, "folio-FOLIO-1"]);
  assert.equal(returned.rows[0].data.folio, "FOLIO-1");
  assert.equal((await db.query("select count(*)::int as count from pending_bank_items_cloud where id='folio-FOLIO-1'")).rows[0].count, 1);
  assert.equal((await db.query("select count(*)::int as count from insurance_bank_payments_cloud where id='folio-FOLIO-1'")).rows[0].count, 0);

  console.log("OK DB seguros: traslado atómico, deduplicación, vínculo, desvínculo y devolución.");
} finally {
  await db.close();
}
