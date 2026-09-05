import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "../.tmp/lead-portal-tests/node_modules/@electric-sql/pglite/dist/index.js";

const db = new PGlite();
const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
let cases = 0;
const check = name => { cases++; console.log("OK", name); };
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls; create schema auth;
    create table auth.users(id uuid primary key);
    insert into auth.users values ('${owner}'), ('${other}');
    create function auth.uid() returns uuid language sql as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function public.can_access_owner_data(target_user_id uuid) returns boolean language sql as
    $$ select auth.uid() = target_user_id $$;
    create function public.can_view_owner_screen(target_user_id uuid, screen text) returns boolean language sql as
    $$ select auth.uid() = target_user_id and coalesce(current_setting('test.view',true),'yes') <> 'no' $$;
    create function public.can_edit_owner_screen(target_user_id uuid, screen text) returns boolean language sql as
    $$ select auth.uid() = target_user_id and coalesce(current_setting('test.edit',true),'yes') <> 'no' $$;
    grant usage on schema auth to anon, authenticated;
  `);
  for (const path of ["16-lead-evaluations-cloud.sql", "59-seller-lead-requests.sql", "66-shared-seller-lead-portal.sql", "67-seller-cedula-digits-only.sql"]) {
    await db.exec(readFileSync("supabase/" + path, "utf8"));
  }
  // A heavy document in every row exercises the real storage problem.
  const doc = "data:image/png;base64," + "aB1cD2".repeat(100_000);
  for (let index = 0; index < 65; index++) {
    await db.query("insert into lead_evaluations_cloud(user_id,id,data,updated_at) values($1,$2,$3,$4)", [owner, String(index).padStart(4,"0"), JSON.stringify({
      id:String(index).padStart(4,"0"),cedula:`8-100-${index + 100}`,birthDate:"1990-01-01",age:36,
      decision:"aplica",extraDeposit:0,attachmentName:"synthetic.png",attachmentDataUrl:doc,
      updatedAt:"2026-09-02T12:00:00.000Z",createdAt:"2026-09-01T12:00:00.000Z",blockers:[],extraDepositReasons:[]
    }), "2026-09-02T12:00:00.000Z"]);
  }
  await db.query("insert into lead_evaluations_cloud(user_id,id,data) values($1,'private',$2)", [other,JSON.stringify({cedula:"8-100-100",decision:"no_aplica",attachmentDataUrl:"PRIVATE"})]);
  const before = (await db.query("select id,md5(data::text) as hash from lead_evaluations_cloud order by id")).rows;
  const migration = readFileSync("supabase/68-leads-fast-read.sql", "utf8");
  assert.equal(migration, readFileSync("supabase/migrations/20260902000100_leads_fast_read.sql", "utf8"));
  await db.exec(migration);
  await db.exec(migration);
  assert.deepEqual((await db.query("select id,md5(data::text) as hash from lead_evaluations_cloud order by id")).rows, before);
  assert.equal((await db.query("select count(*)::int as n from lead_evaluations_cloud where summary ? 'attachmentDataUrl'")).rows[0].n,0);
  check("repeatable migration populates all historical summaries without changing a byte of source data");

  const read = async (id=owner, cedula=null, time=null, cursor=null) => (await db.query("select * from read_lead_evaluations_page($1,$2,$3,$4)",[id,cedula,time,cursor])).rows;
  await db.exec(`set role authenticated; set request.jwt.claim.sub = '${owner}';`);
  const first = await read();
  assert.equal(first.length,21);
  assert.equal(first[0].id,"0064");
  const seen = [];
  let batch = first;
  while (true) {
    seen.push(...batch.slice(0,20).map(row=>row.id));
    if (batch.length < 21) break;
    const last = batch[19];
    batch = await read(owner,null,last.updated_at,last.id);
  }
  assert.equal(seen.length,65);
  assert.equal(new Set(seen).size,65);
  check("bounded keyset pages visit every record exactly once, including identical timestamps");
  assert.equal((await read(owner,"8100100"))[0].id,"0000");
  assert.equal((await read(owner,"8-100-100"))[0].id,"0000");
  assert.equal((await read(owner,"9999999")).length,0);
  await assert.rejects(read(owner,null,"2026-09-02T12:00:00Z",null),/Cursor incompleto/);
  check("normalized cedula lookup finds a historical Lead outside the first page");
  await assert.rejects(read(other),/No autorizado/);
  await db.exec("set test.view = 'no'");
  await assert.rejects(read(),/No autorizado/);
  await db.exec("reset test.view; set test.edit = 'no'");
  assert.equal((await read()).length,21);
  await db.exec("reset test.edit; reset role; reset request.jwt.claim.sub; set role anon");
  await assert.rejects(read(),/permission denied/);
  await assert.rejects(db.query("select seller_lead_public_result($1,'8100100')",[owner]),/permission denied/);
  await db.exec("reset role");
  check("anonymous, other datasets and denied screens cannot read; read-only users can read");

  const source = (await db.query("select data from lead_evaluations_cloud where user_id=$1 and id='0000'",[owner])).rows[0].data;
  await db.query("update lead_evaluations_cloud set data = jsonb_set(data,'{decision}','\"aplica_con_abono\"') where user_id=$1 and id='0000'",[owner]);
  const updated = (await db.query("select data,summary from lead_evaluations_cloud where user_id=$1 and id='0000'",[owner])).rows[0];
  assert.equal(updated.summary.decision,"aplica_con_abono");
  assert.equal(updated.data.attachmentDataUrl,source.attachmentDataUrl);
  await assert.rejects(db.query("update lead_evaluations_cloud set summary='{}' where user_id=$1",[owner]),/generated column|DEFAULT/);
  const result = (await db.query("select seller_lead_public_result($1,'8100100') as result",[owner])).rows[0].result;
  assert.deepEqual(result,{status:"reviewed",decision:"aplica_con_abono",extraDeposit:0});
  check("normal writes automatically maintain summaries, keep attachments and preserve the public allowlist");

  await db.exec("set enable_seqscan = off");
  const recentPlan = (await db.query("explain (format json) select id,summary,updated_at from lead_evaluations_cloud where user_id=$1 order by updated_at desc,id desc limit 21",[owner])).rows;
  const searchPlan = (await db.query("explain (format json) select id,summary from lead_evaluations_cloud where user_id=$1 and seller_lead_cedula_key(summary->>'cedula')='8100100' order by updated_at desc,id desc limit 1",[owner])).rows;
  assert.match(JSON.stringify(recentPlan),/lead_evaluations_recent_idx/);
  assert.match(JSON.stringify(searchPlan),/lead_evaluations_summary_cedula_idx/);
  check("recent and cedula queries have matching usable indexes");
  console.log(JSON.stringify({syntheticRows:65, fullDocumentBytes:doc.length,firstPageBytes:Buffer.byteLength(JSON.stringify(first)),pageRows:20}));
  console.log(`PASS: ${cases} database scenarios.`);
} catch (error) { console.error(error.message); process.exitCode = 1; } finally { await db.close(); }
