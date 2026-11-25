const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const tick = () => new Promise(resolve => setImmediate(resolve));
const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const source = ts.transpileModule(fs.readFileSync("src/cloud/clientCloudData.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;

function fixture(rows, options = {}) {
  const calls = [], normalized = [], inflight = new Map();
  const client = {
    from(table) {
      assert.equal(table, "clients_cloud");
      const query = { filters: [], order: null, limit: 0,
        select(columns) { assert.equal(columns, "id,data"); return this; },
        eq(column, value) { this.filters.push(["eq", column, value]); return this; },
        lt(column, value) { this.filters.push(["lt", column, value]); return this; },
        gte(column, value) { this.filters.push(["gte", column, value]); return this; },
        gt(column, value) { this.filters.push(["gt", column, value]); return this; },
        order(column, options) { this.order = [column, options.ascending]; return this; },
        limit(value) { this.limit = value; return this; },
        async then(resolve, reject) {
          try {
            calls.push({ filters: this.filters, order: this.order, limit: this.limit });
            if (options.gate) await options.gate.promise;
            if (options.failUpper && this.filters.some(([op]) => op === "gte")) return resolve({ data: null, error: Error("one range unavailable") });
            const data = rows.filter(row => this.filters.every(([op, column, value]) => {
              const actual = row[column];
              return op === "eq" ? actual === value : op === "lt" ? actual < value : op === "gte" ? actual >= value : actual > value;
            })).sort((a, b) => compare(a.id, b.id)).slice(0, this.limit).map(({ id, data }) => ({ id, data }));
            resolve({ data, error: null });
          } catch (error) { reject(error); }
        }
      };
      return query;
    }
  };
  const loaded = { exports: {} };
  vm.runInNewContext(source, {
    exports: loaded.exports, Date,
    require(name) {
      if (name.endsWith("validatedClientsSnapshot")) return { loadValidatedClientsSnapshot: async () => null };
      if (name.endsWith("billing")) return { withResolvedInstallmentIssuance(value) { normalized.push(value.id); return value; } };
      if (name.endsWith("cloudClient")) return {
        PAGE_SIZE: 1000, getCloudClient: () => client,
        dedupeLoad(key, load) { if (inflight.has(key)) return inflight.get(key); const promise = load().finally(() => inflight.delete(key)); inflight.set(key, promise); return promise; }
      };
      throw Error(name);
    }
  });
  return { load: loaded.exports.loadCloudClients, calls, normalized };
}

function row(id, owner = "owner-a") {
  return { id, user_id: owner, data: { id, name: `Name ${id}`, unitId: "A01", status: "activo", balance: 123.45, fines: [{ id: "fine", amount: 7 }], customHistory: { preserve: true } } };
}

(async () => {
  const ids = ["", "0000", "7ffff", "8", "80000", "client-legacy", "Z-legacy", "ñ-legacy"];
  for (let i = 0; i < 2105; i++) ids.push(`1-${String(i).padStart(5, "0")}`);
  for (let i = 0; i < 2010; i++) ids.push(`f-${String(i).padStart(5, "0")}`);
  const rows = ids.map(id => row(id));
  rows.push(row("0000", "owner-b"), row("8", "owner-b"));
  const held = gate();
  const test = fixture(rows, { gate: held });
  let settled = false;
  const reading = test.load("owner-a").then(data => { settled = true; return data; });
  const deduped = test.load("owner-a");
  await tick();
  assert.equal(test.calls.length, 2, "Both ranges start before either finishes, and concurrent consumers reuse the load");
  assert.equal(settled, false);
  held.resolve();
  const result = await reading;
  assert.equal(await deduped, result);
  assert.deepEqual(Array.from(result, item => item.id), [...ids].sort(compare), "All pages, the boundary ID, empty and legacy IDs appear exactly once in the original order");
  assert.equal(test.calls.length, 6, "Each range independently paginates beyond 2000 records");
  assert.equal(test.normalized.length, ids.length);
  assert.ok(test.calls.every(call => call.filters.some(([op, column, value]) => op === "eq" && column === "user_id" && value === "owner-a")));
  assert.ok(test.calls.every(call => call.order[0] === "id" && call.order[1] === true && call.limit === 1000));
  for (const item of result) {
    assert.equal(item.balance, 123.45); assert.equal(item.fines[0].amount, 7); assert.equal(item.customHistory.preserve, true);
  }

  const failed = fixture(rows, { failUpper: true });
  await assert.rejects(failed.load("owner-a"), /one range unavailable/);
  assert.equal(failed.normalized.length, 0, "An incomplete range cannot expose a partial client snapshot");
  const empty = fixture([]);
  assert.equal((await empty.load("owner-a")).length, 0);
  const otherOwner = fixture(rows);
  assert.deepEqual(Array.from(await otherOwner.load("owner-b"), item => item.id), ["0000", "8"]);
  console.log("PASS parallel client reads: disjoint ranges start together, retain all 4123 records and fields, paginate, preserve order and owner isolation, dedupe concurrent readers, and reject partial failures.");
})().catch(error => { console.error(error); process.exitCode = 1; });
