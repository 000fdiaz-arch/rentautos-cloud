const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const source = ts.createSourceFile(
  "operationsCloudData.ts",
  fs.readFileSync("src/cloud/operationsCloudData.ts", "utf8"),
  ts.ScriptTarget.Latest,
  true
);
const lookup = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "isCloudCashClosingDateClosed");
assert.ok(lookup);
const code = ts.transpile(lookup.getText(source).replace(/^export\s+/, ""), { target: ts.ScriptTarget.ES2022 });

async function check(rows, owner, date, expected, error = null) {
  const before = JSON.stringify(rows);
  const filters = [];
  let reads = 0;
  const context = {
    getCloudClient() {
      return {
        from(table) {
          assert.equal(table, "cash_closings_cloud");
          const query = {
            select(columns) { assert.equal(columns, "id"); return query; },
            eq(column, value) { filters.push([column, value]); return query; },
            limit(count) { assert.equal(count, 1); return query; },
            async maybeSingle() {
              reads++;
              const data = rows.find(row => filters.every(([column, value]) => (
                column === "data->>date" ? row.data?.date : row[column]
              ) === value));
              return { data: data ? { id: data.id } : null, error };
            }
          };
          // The adapter exposes only reads. Any mutation or RPC fails the test.
          return query;
        }
      };
    }
  };
  vm.runInNewContext(code, context);
  if (error) {
    await assert.rejects(context.isCloudCashClosingDateClosed(owner, date), caught => caught === error);
  } else {
    assert.equal(await context.isCloudCashClosingDateClosed(owner, date), expected);
  }
  assert.equal(reads, 1);
  assert.ok(filters.some(([column, value]) => column === "user_id" && value === owner), "Queries must stay scoped to the business owner");
  assert.equal(JSON.stringify(rows), before, "Recognizing a closing must not rewrite its record or balances");
}

(async () => {
  const date = "2026-11-23";
  const closing = { date, closedAt: "2026-11-24T11:18:03.879Z" };
  const legacy = { user_id: "owner", id: `${date}__${closing.closedAt}`, data: closing };
  const canonical = { user_id: "owner", id: date, data: closing };
  await check([legacy], "owner", date, true);
  await check([canonical], "owner", date, true);
  await check([legacy, canonical], "owner", date, true);
  await check([legacy], "another-owner", date, false);
  await check([legacy], "owner", "2026-11-22", false);
  await check([], "owner", date, false);
  await check([{ ...canonical, data: { ...closing, date: "2026-11-22" } }], "owner", date, false);
  await check([legacy], "owner", date, null, { code: "57014", message: "statement timeout" });
  console.log("PASS closing lookup: both stored ID formats, duplicate records, owner/date isolation, missing closings and read errors; no writes or RPCs.");
})().catch(error => { console.error(error); process.exitCode = 1; });
