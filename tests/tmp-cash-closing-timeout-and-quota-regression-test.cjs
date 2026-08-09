const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const esbuild = require("esbuild");

const root = path.resolve(__dirname, "..");
const outDir = path.join(root, ".tmp", "tests");
const pendingBundle = path.join(outDir, "pendingCoreSyncStorage.bundle.cjs");
const rulesBundle = path.join(outDir, "appShellRules.bundle.cjs");
fs.mkdirSync(outDir, { recursive: true });

// Replace IndexedDB with a deterministic in-memory adapter while executing the
// real pending-sync storage module.
global.__pendingSyncDb = new Map();
const localRows = new Map();
let localStorageSetCalls = 0;
global.localStorage = {
  getItem: (key) => localRows.get(key) ?? null,
  setItem: () => {
    localStorageSetCalls += 1;
    const error = new Error("Setting the value exceeded the quota.");
    error.name = "QuotaExceededError";
    throw error;
  },
  removeItem: (key) => localRows.delete(key)
};

async function run() {
  await esbuild.build({
    entryPoints: [path.join(root, "src", "app", "pendingCoreSyncStorage.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: pendingBundle,
    plugins: [{
      name: "indexed-db-memory-adapter",
      setup(build) {
        build.onResolve({ filter: /indexedDbStorage$/ }, () => ({ path: "indexed-db-memory", namespace: "test" }));
        build.onLoad({ filter: /.*/, namespace: "test" }, () => ({
          loader: "js",
          contents: `
            exports.writeIndexedDb = async (key, value) => global.__pendingSyncDb.set(key, value);
            exports.readIndexedDb = async (key) => global.__pendingSyncDb.get(key);
            exports.deleteIndexedDb = async (key) => global.__pendingSyncDb.delete(key);
          `
        }));
      }
    }]
  });

  await esbuild.build({
    entryPoints: [path.join(root, "src", "app", "appShellRules.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: rulesBundle
  });

  const pendingStorage = require(pendingBundle);
  const rules = require(rulesBundle);

  const largeText = "x".repeat(6 * 1024 * 1024);
  const snapshot = {
    userId: "owner-1",
    token: 1,
    clients: [{ id: "client-1", name: largeText }],
    payments: [],
    paymentsComplete: false
  };

  await pendingStorage.persistPendingCoreSync(snapshot);
  assert.equal(localStorageSetCalls, 0, "La cola pendiente nunca debe escribir el snapshot en localStorage.");
  const loaded = await pendingStorage.loadPendingCoreSync("owner-1");
  assert.equal(loaded.clients[0].name.length, largeText.length, "IndexedDB debe conservar snapshots mayores a la cuota de localStorage.");

  await pendingStorage.clearPendingCoreSync();
  assert.equal(await pendingStorage.loadPendingCoreSync("owner-1"), null, "La cola debe limpiarse despues de sincronizar.");

  assert.match(
    rules.getCloudSaveErrorMessage({ code: "57014", message: "canceling statement due to statement timeout" }),
    /excedio el tiempo permitido/i,
    "El timeout 57014 debe producir un mensaje comprensible."
  );

  const migration51 = fs.readFileSync(path.join(root, "supabase", "51-receivables-latest-payment-active-client.sql"), "utf8");
  const migration54 = fs.readFileSync(path.join(root, "supabase", "54-cash-closing-client-sync-timeout.sql"), "utf8");
  const persistenceMode = fs.readFileSync(path.join(root, "src", "persistenceMode.ts"), "utf8");

  for (const [name, sql] of [["51", migration51], ["54", migration54]]) {
    const guardPosition = sql.indexOf("if tg_op = 'UPDATE'");
    const rebuildPosition = sql.lastIndexOf("perform public.rebuild_latest_payment_for_client(new.user_id, new.id)");
    assert.ok(guardPosition >= 0 && guardPosition < rebuildPosition, `La migracion ${name} debe omitir actualizaciones financieras antes de reconstruir pagos.`);
    assert.match(sql, /old\.data->>'unitId'[\s\S]*old\.data->>'cedula'[\s\S]*old\.data->>'name'[\s\S]*old\.data->>'status'[\s\S]*old\.data->>'archivedAt'/);
    assert.match(sql, /union all/i, `La migracion ${name} debe separar las rutas indexadas por cliente y unidad.`);
  }

  assert.match(persistenceMode, /import\.meta\.env\.DEV \|\| productionLocalOnlyExplicitlyAllowed/);
  assert.match(persistenceMode, /configuredMode === "LOCAL_ONLY" && localOnlyAllowed/);

  console.log("OK cierre de caja: sin trigger financiero costoso, sin snapshot en localStorage y con timeout 57014 legible.");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
