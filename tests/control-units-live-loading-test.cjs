const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const { randomUUID } = require("node:crypto");

const slots = [];
let index = 0, dirty = false, args, result;
const effects = [], activeReads = [], retiredReads = [], channels = [], timers = new Map();
let nextTimer = 0;
const sameDeps = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
const react = {
  useState(initial) {
    const slot = index++;
    if (!(slot in slots)) slots[slot] = typeof initial === "function" ? initial() : initial;
    return [slots[slot], value => { slots[slot] = typeof value === "function" ? value(slots[slot]) : value; dirty = true; }];
  },
  useRef(initial) { const slot = index++; return slots[slot] ??= { current: initial }; },
  useCallback(fn, deps) {
    const slot = index++;
    if (!sameDeps(slots[slot]?.deps, deps)) slots[slot] = { deps, value: fn };
    return slots[slot].value;
  },
  useEffect(fn, deps) {
    const slot = index++;
    if (sameDeps(slots[slot]?.deps, deps)) return;
    const previous = slots[slot];
    slots[slot] = { deps };
    effects.push(() => { previous?.cleanup?.(); slots[slot].cleanup = fn(); });
  }
};
function read(queue, owner) {
  return new Promise((resolve, reject) => queue.push({ owner, resolve, reject }));
}
const client = {
  channel(name) {
    const channel = { name, removed: false, on(_event, filter, callback) { this.filter = filter; this.emit = callback; return this; }, subscribe() { channels.push(this); return this; } };
    return channel;
  },
  removeChannel(channel) { channel.removed = true; }
};
const loaded = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/pages/controlUnits/useControlUnitsRows.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText, {
  exports: loaded.exports,
  require(name) {
    if (name === "react") return react;
    if (name.endsWith("cloudData")) return { loadControlUnits: owner => read(activeReads, owner), loadRetiredControlUnits: owner => read(retiredReads, owner) };
    if (name.endsWith("lib/supabase")) return { supabase: client };
    throw Error(name);
  },
  crypto: { randomUUID }, console,
  window: { setTimeout(fn) { const id = ++nextTimer; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); } }
});
function render(owner, enabled) {
  args = [owner, enabled]; index = 0; dirty = false;
  result = loaded.exports.useControlUnitsRows(...args);
  while (effects.length) effects.shift()();
}
async function settle() {
  for (let i = 0; i < 4; i++) {
    await new Promise(resolve => setImmediate(resolve));
    if (dirty) render(...args);
  }
}
function flushTimers() { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); }

(async () => {
  render("owner-a", false); await settle();
  assert.equal(activeReads.length, 0); assert.equal(channels.length, 0);
  render("owner-a", true); await settle();
  assert.equal(activeReads.length, 1); assert.equal(channels.length, 1);
  assert.equal(channels[0].filter.filter, "user_id=eq.owner-a");
  assert.equal(result.loading, true, "Realtime subscription starts while the initial fleet read is still pending");
  channels[0].emit(); flushTimers();
  assert.equal(activeReads.length, 1, "A change during startup queues a refresh instead of reusing an in-flight snapshot");
  activeReads[0].resolve([{ unit_id: "A01", operational_status: "libre" }]); await settle();
  assert.equal(activeReads.length, 2);
  assert.equal(retiredReads.length, 1, "Retired history is still downloading");
  activeReads[1].resolve([{ unit_id: "A01", operational_status: "taller" }]); await settle();
  assert.equal(result.loading, false); assert.equal(result.rows[0].operational_status, "taller");
  assert.equal(result.retiredLoading, true, "Slow retired history does not block realtime updates of active autos");
  retiredReads[0].resolve([]); await settle();
  retiredReads[1].resolve([]); await settle();

  channels[0].emit(); flushTimers();
  assert.equal(activeReads.length, 3, "Realtime performs a fresh read, not a cached startup snapshot");
  render("owner-a", false); await settle();
  assert.ok(channels[0].removed); assert.equal(result.rows.length, 0);
  channels[0].emit(); flushTimers();
  assert.equal(activeReads.length, 3, "An unsubscribed channel cannot schedule more reads");

  render("owner-a", true); await settle();
  assert.equal(activeReads.length, 4, "Returning to Autos requests current data");
  activeReads[3].resolve([{ unit_id: "A01", operational_status: "activo" }]); retiredReads[3].resolve([]); await settle();
  activeReads[2].resolve([{ unit_id: "A01", operational_status: "stale" }]); retiredReads[2].resolve([]); await settle();
  assert.equal(result.rows[0].operational_status, "activo", "A late response from the previous visit cannot overwrite current data");

  render("owner-b", true); await settle();
  assert.equal(result.rows.length, 0); assert.equal(activeReads[4].owner, "owner-b");
  assert.ok(channels[1].removed); assert.equal(channels[2].filter.filter, "user_id=eq.owner-b");
  activeReads[4].resolve([{ unit_id: "B01", operational_status: "libre" }]); retiredReads[4].resolve([]); await settle();
  assert.equal(result.rows[0].unit_id, "B01");
  render("owner-b", false); await settle();
  assert.equal(timers.size, 0); assert.ok(channels.every(channel => channel.removed));
  console.log("PASS fleet loading: disabled consumers do not fetch; realtime starts with the first read; fresh navigation, stale-response guards, owner isolation and subscription cleanup remain intact.");
})().catch(error => { console.error(error); process.exitCode = 1; });
