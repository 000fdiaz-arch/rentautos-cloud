import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "../.tmp/lead-portal-tests/node_modules/@electric-sql/pglite/dist/index.js";

// Local, in-memory PostgreSQL only. Never reads credentials or contacts production.
const db = new PGlite();
const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
let cases = 0;
const check = (name) => { cases++; console.log("OK", name); };
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key);
    insert into auth.users values ('${owner}'), ('${other}');
    create function auth.uid() returns uuid language sql as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function public.can_access_owner_data(target_user_id uuid) returns boolean language sql as
    $$ select auth.uid() = target_user_id $$;
    create function public.can_view_owner_screen(target_user_id uuid, screen text) returns boolean language sql as
    $$ select auth.uid() = target_user_id $$;
    create function public.can_edit_owner_screen(target_user_id uuid, screen text) returns boolean language sql as
    $$ select auth.uid() = target_user_id and coalesce(current_setting('test.edit', true), 'yes') <> 'no' $$;
    grant usage on schema auth to anon, authenticated;
    create table public.lead_evaluations_cloud(user_id uuid, id text, data jsonb, updated_at timestamptz default now(), primary key(user_id,id));
  `);
  await db.exec(readFileSync("supabase/59-seller-lead-requests.sql", "utf8"));
  const migration = readFileSync("supabase/66-shared-seller-lead-portal.sql", "utf8");
  assert.equal(migration, readFileSync("supabase/migrations/20260901000200_shared_seller_lead_portal.sql", "utf8"));
  await db.exec(migration);
  await db.exec(migration);
  check("migration compiles and is repeatable");

  await db.exec(`set role authenticated; set request.jwt.claim.sub = '${owner}';`);
  const portal = (await db.query("select get_or_create_seller_lead_portal($1) as id", [owner])).rows[0].id;
  assert.equal((await db.query("select get_or_create_seller_lead_portal($1) as id", [owner])).rows[0].id, portal);
  await assert.rejects(db.query("select get_or_create_seller_lead_portal($1)", [other]), /No autorizado/);
  check("stable shared link and cross-owner denial");

  await db.exec("set test.edit = 'no'");
  await assert.rejects(db.query("select get_or_create_seller_lead_portal($1)", [owner]), /No autorizado/);
  await db.exec("reset test.edit; reset role; reset request.jwt.claim.sub; set role anon");
  await assert.rejects(db.query("select * from seller_lead_requests"), /permission denied/);
  await assert.rejects(db.query("select * from seller_lead_portals"), /permission denied/);
  await assert.rejects(db.query("select seller_lead_public_result($1, '888888')", [owner]), /permission denied/);
  await assert.rejects(db.query("select get_or_create_seller_lead_portal($1)", [owner]), /permission denied/);
  check("anonymous cannot read private tables or bypass guarded functions");

  const lookup = async (cedula, p = portal) => (await db.query("select lookup_seller_lead($1, $2) as result", [p, cedula])).rows[0].result;
  const submit = async (cedula, date = "1990-01-01", doc = "data:image/png;base64,iVBORw0KGgo=") =>
    (await db.query("select submit_shared_seller_lead($1,$2,$3,$4,$5) as result", [portal, cedula, date, "test.png", doc])).rows[0].result;
  assert.deepEqual(await lookup("8-888-888"), { status: "not_found" });
  await assert.rejects(lookup("8-888-888", other), /PORTAL_UNAVAILABLE/);
  await assert.rejects(lookup("*"), /Cedula no valida/);
  await db.exec("reset role");
  assert.equal(Number((await db.query("select count(*) as n from seller_lead_requests")).rows[0].n), 0);
  await db.exec("set role anon");
  check("lookup creates no request and rejects bad input / unknown portal");

  assert.deepEqual(await submit("8-888-888"), { status: "pending_review" });
  assert.deepEqual(await lookup("8 888 888"), { status: "pending_review" });
  assert.deepEqual(await submit("8888888"), { status: "pending_review" });
  await db.exec("reset role");
  assert.equal(Number((await db.query("select count(*) as n from seller_lead_requests")).rows[0].n), 1);
  const row = (await db.query("select * from seller_lead_requests")).rows[0];
  check("anonymous submission and normalized duplicate prevention");

  await db.query("update seller_lead_requests set status='incomplete', correction_note='PRIVATE NOTE' where id=$1", [row.id]);
  await db.exec("set role anon");
  assert.deepEqual(await lookup("8888888"), { status: "incomplete" });
  assert.deepEqual(await submit("8 888 888"), { status: "pending_review" });
  await db.exec("reset role");
  assert.equal(Number((await db.query("select count(*) as n from seller_lead_requests")).rows[0].n), 1);
  check("correction updates existing request without leaking note");

  for (const [decision, amount] of [["aplica",0],["aplica_con_abono",150],["no_aplica",999]]) {
    await db.query(`insert into lead_evaluations_cloud values($1,'test-verdict',$2,now())
      on conflict(user_id,id) do update set data=excluded.data`, [owner, JSON.stringify({
      cedula:"8-888-888", decision, extraDeposit:amount, birthDate:"1990-01-01",
      blockers:["SECRET"], attachmentDataUrl:"SECRET", hasLegalCases:true
    })]);
    await db.query("update seller_lead_requests set status='reviewed', evaluation_id='test-verdict' where id=$1", [row.id]);
    await db.exec("set role anon");
    assert.deepEqual(await lookup("8888888"), { status:"reviewed", decision, extraDeposit:decision === "no_aplica" ? 0 : amount });
    await db.exec("reset role");
  }
  check("all decisions expose only allowlisted fields, including historical evaluations");

  await db.query("insert into lead_evaluations_cloud values($1,'historical',$2,now())", [owner, JSON.stringify({cedula:"PE-1234",decision:"aplica_con_abono",extraDeposit:200})]);
  await db.exec("set role anon");
  assert.deepEqual(await lookup("pe 1234"), {status:"reviewed",decision:"aplica_con_abono",extraDeposit:200});
  assert.deepEqual(await submit("pe1234"), {status:"reviewed",decision:"aplica_con_abono",extraDeposit:200});
  await db.exec("reset role");
  assert.equal(Number((await db.query("select count(*) as n from seller_lead_requests")).rows[0].n), 1);
  await db.exec(`set role authenticated; set request.jwt.claim.sub = '${owner}'; set test.edit = 'no'`);
  assert.equal((await db.query("select id from seller_lead_requests")).rows.length, 1);
  assert.equal((await db.query("update seller_lead_requests set status='incomplete' returning id")).rows.length, 0);
  await db.exec("reset role; reset request.jwt.claim.sub; reset test.edit");
  check("historical verdict requires no invitation, and read-only staff cannot change requests");

  await db.query("insert into lead_evaluations_cloud values($1,'other-person',$2,now())", [other, JSON.stringify({cedula:"9-999-999",decision:"aplica"})]);
  await db.exec("set role anon");
  assert.deepEqual(await lookup("9-999-999"), {status:"not_found"});
  await assert.rejects(submit("9-999-999", "2999-01-01"), /Fecha de nacimiento no valida/);
  await assert.rejects(submit("9-999-999", "1990-01-01", "data:image/svg+xml;base64,AA=="), /Documento no valido/);
  await assert.rejects(submit("9-999-999", "1990-01-01", null), /Documento no valido/);
  await assert.rejects(submit("9-999-999", "1990-01-01", "data:image/png;base64," + Buffer.alloc(4194305).toString("base64")), /Documento demasiado grande/);
  check("tenant isolation, dates and unsafe document types");

  await db.exec("reset role");
  await db.query(`update seller_lead_portal_limits set minute_start=date_trunc('minute',now()), minute_count=60 where portal_id=$1 and operation='lookup'`, [portal]);
  await db.exec("set role anon");
  await assert.rejects(lookup("8-888-888"), /PORTAL_RATE_LIMIT/);
  await db.exec("reset role");
  await db.query("update seller_lead_portals set enabled=false where id=$1", [portal]);
  await db.exec("set role anon");
  await assert.rejects(lookup("8-888-888"), /PORTAL_UNAVAILABLE/);
  check("database-enforced rate limit and disabled portal");
  console.log(`PASS: ${cases} local database scenarios.`);
} finally {
  await db.close();
}
