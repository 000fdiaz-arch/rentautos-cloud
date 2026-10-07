import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "../.tmp/lead-portal-tests/node_modules/@electric-sql/pglite/dist/index.js";

const db = new PGlite();
const owner = "11111111-1111-4111-8111-111111111111";
const legacyData = {
  status: "pending",
  comment: "Se conserva",
  updatedAt: "2026-10-06T13:00:00.000Z",
  dailyContactAttemptsByDate: {
    "2026-10-06": {
      morning: { result: "contacted", updatedAt: "2026-10-06T08:15:00.000Z" },
      afternoon: { result: "contacted", updatedAt: "2026-10-06T14:10:00.000Z" }
    },
    "2026-10-07": {
      morning: { result: "contacted", updatedAt: "2026-10-07T08:05:00.000Z" },
      night: { result: "pending", updatedAt: "2026-10-07T18:00:00.000Z" }
    }
  }
};

try {
  const rootSql = readFileSync("supabase/101-daily-contact-attempts-cloud.sql", "utf8");
  const migrationSql = readFileSync("supabase/migrations/20261007000200_daily_contact_attempts_cloud.sql", "utf8");
  assert.equal(rootSql, migrationSql, "La migracion y su copia numerada deben permanecer identicas.");

  await db.exec(`
    create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key);
    insert into auth.users(id) values ('${owner}');
    create function public.can_view_owner_screen(target uuid, screen text)
    returns boolean language sql stable as $$select target = '${owner}'::uuid and screen = 'receivables'$$;
    create function public.can_edit_owner_screen(target uuid, screen text)
    returns boolean language sql stable as $$select target = '${owner}'::uuid and screen = 'receivables'$$;
    create table public.street_management_items_cloud(
      user_id uuid not null references auth.users(id),
      client_id text not null,
      data jsonb not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      primary key(user_id, client_id)
    );
  `);
  await db.query(
    "insert into public.street_management_items_cloud(user_id,client_id,data) values ($1,'client-a12',$2::jsonb)",
    [owner, JSON.stringify(legacyData)]
  );

  const publicationBlockStart = rootSql.lastIndexOf("\ndo $$");
  assert.ok(publicationBlockStart > 0, "La migracion debe terminar con el alta segura de Realtime.");
  const pgliteSql = rootSql.slice(0, publicationBlockStart);
  await db.exec(pgliteSql);
  await db.exec(pgliteSql);

  const legacy = await db.query(
    "select data from public.street_management_items_cloud where user_id=$1 and client_id='client-a12'",
    [owner]
  );
  assert.deepEqual(legacy.rows[0].data, legacyData, "El backfill no debe alterar ni borrar el JSON anterior.");

  const migrated = await db.query(`
    select contact_date::text as contact_date, shift, result
    from public.daily_contact_attempts_cloud
    where user_id='${owner}'::uuid and client_id='client-a12'
    order by contact_date, shift
  `);
  assert.deepEqual(migrated.rows, [
    { contact_date: "2026-10-06", shift: "afternoon", result: "contacted" },
    { contact_date: "2026-10-06", shift: "morning", result: "contacted" },
    { contact_date: "2026-10-07", shift: "morning", result: "contacted" }
  ]);

  await db.exec(`
    insert into public.daily_contact_attempts_cloud(user_id,client_id,contact_date,shift,result)
    values ('${owner}'::uuid,'client-a12','2026-10-07','morning','pending')
    on conflict (user_id,client_id,contact_date,shift)
    do update set result=excluded.result;
  `);
  const atomicRows = await db.query(`
    select count(*)::int as count, min(result) as result
    from public.daily_contact_attempts_cloud
    where user_id='${owner}'::uuid
      and client_id='client-a12'
      and contact_date='2026-10-07'
      and shift='morning'
  `);
  assert.deepEqual(atomicRows.rows[0], { count: 1, result: "pending" }, "Cada turno debe conservar una sola fila atomica.");

  const cloudSource = readFileSync("src/cloud/operationsCloudData.ts", "utf8");
  const pageSource = readFileSync("src/pages/ReceivablesPage.tsx", "utf8");
  const saveStart = cloudSource.indexOf("export async function saveCloudDailyContactAttempt");
  const saveEnd = cloudSource.indexOf("export async function loadCloudStreetManagement", saveStart);
  const saveSource = cloudSource.slice(saveStart, saveEnd);
  assert.match(saveSource, /daily_contact_attempts_cloud/);
  assert.match(saveSource, /\.upsert\(/);
  assert.match(saveSource, /\.single\(\)/);
  assert.doesNotMatch(saveSource, /localStorage|sessionStorage/);
  assert.match(pageSource, /const saved = await saveCloudDailyContactAttempt/);
  assert.ok(
    pageSource.indexOf("applyDailyContactCloudAttempt(saved)") > pageSource.indexOf("const saved = await saveCloudDailyContactAttempt"),
    "El gancho visible solo debe cambiar despues de la confirmacion de Supabase."
  );

  console.log("OK checklist nube: backfill no destructivo, fila atomica y UI posterior a confirmacion.");
} finally {
  await db.close();
}

