import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { chromium } from "playwright";

// Real React/App lifecycle, synthetic auth and intercepted cloud reads only.
const base = "http://127.0.0.1:4196";
const userId = "11111111-1111-4111-8111-111111111111";
const ownerId = "22222222-2222-4222-8222-222222222222";
const profile = { role: "admin", is_active: true, data_owner_user_id: ownerId, permissions: null };
const fleet = [{ fleet_id: "fleet-one", unit_id: "A01", brand_model: "Auto de prueba", operational_status: "libre", user_id: ownerId }];
const snapshotMappings = JSON.parse(readFileSync("tests/fixtures/cloud-mirror-snapshot-map.json", "utf8"));
const server = spawn(process.execPath, ["--input-type=module", "-e", `
  import { createServer } from 'vite';
  const server = await createServer({ cacheDir: 'node_modules/.vite-local-loading-regression', server: { host: '127.0.0.1', port: 4196, strictPort: true } });
  await server.listen(); server.printUrls();
`], {
  stdio: "pipe", windowsHide: true,
  env: { ...process.env, VITE_SUPABASE_URL: "https://local-loading-tests.invalid", VITE_SUPABASE_ANON_KEY: "synthetic-public-key",
    VITE_PERSISTENCE_MODE: "SUPABASE_ONLY", VITE_RENTAUTOS_TEST_BYPASS_AUTH: "0", VITE_RENTAUTOS_TEST_LEGACY_LOCAL_STORAGE: "0" }
});
let browser;
let output = "";
server.stdout.on("data", chunk => { output += chunk; });
server.stderr.on("data", chunk => { output += chunk; });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

async function createCase(options = {}) {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const state = { profileReads: 0, operationalReads: [], mirrorSnapshots: [], fleetReads: [], retiredReads: 0, coreReads: 0, mirrorReads: 0, detailReads: 0, auditReads: [], auditSaves: [], bankRuleSaves: [], signingReads: 0, badgeReads: [], modules: new Set(), writes: [], errors: [], ...options };
  page.on("pageerror", error => state.errors.push(error.message));
  await page.addInitScript(({ userId }) => {
    localStorage.setItem("sb-local-loading-tests-auth-token", JSON.stringify({
      access_token: "synthetic-access-token", refresh_token: "synthetic-refresh-token", token_type: "bearer",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: userId, email: "admin@example.test", user_metadata: {}, app_metadata: {}, aud: "authenticated", created_at: "2026-01-01T00:00:00Z" }
    }));
  }, { userId });
  await page.routeWebSocket("**", ws => ws.close());
  await page.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === base) { state.modules.add(url.pathname); return route.continue(); }
    if (url.hostname !== "local-loading-tests.invalid") return route.abort();
    if (url.pathname.startsWith("/rest/v1/") && !url.pathname.endsWith("/user_profiles")) state.operationalReads.push(url.pathname);
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method()) && !/\/rpc\/(get_|read_|load_|list_|count_|resolve_|has_|can_)/.test(url.pathname)) state.writes.push(url.pathname);
    if (url.pathname.endsWith("/rpc/read_initial_payments_snapshot")) {
      const args = request.postDataJSON();
      (state.paymentSnapshots ??= []).push(args);
      if (!state.initialPayments) return route.fulfill({ status: 404, json: { code: "PGRST202" } });
      if (state.paymentsValidationGate) await state.paymentsValidationGate.promise;
      const payload = JSON.stringify(state.initialPayments);
      const fingerprint = createHash("sha256").update(payload).digest("hex");
      const unchanged = args.p_fingerprint === fingerprint;
      return route.fulfill({ json: { version: 1, owner: ownerId, through_date: args.p_through_date, limit: args.p_limit, recent_count: state.initialPayments.recent.length, pending_count: state.initialPayments.pending.length, fingerprint, not_modified: unchanged, payload: unchanged ? null : payload } });
    }
    if (url.pathname.endsWith("/rpc/read_control_units_snapshot")) {
      (state.fleetSnapshots ??= []).push(request.postDataJSON());
      if (!state.batchedFleet) return route.fulfill({ status: 404, json: { code: "PGRST202" } });
      if (state.activeGate) await state.activeGate.promise;
      return route.fulfill({ json: { version: 1, owner: ownerId, rows: [{ ...fleet[0], key_coded: true, catalog_daily_rate: 25, catalog_photo_path: `${ownerId}/fleet-photo.jpg` }] } });
    }
    if (url.pathname.endsWith("/rpc/read_clients_snapshot_if_changed")) {
      const args = request.postDataJSON();
      (state.clientSnapshots ??= []).push(args);
      if (state.clientValidationGate) await state.clientValidationGate.promise;
      if (!state.clientSnapshotRows) return route.fulfill({ status: 404, json: { code: "PGRST202" } });
      const payload = JSON.stringify(state.clientSnapshotRows);
      const fingerprint = createHash("sha256").update(payload).digest("hex");
      const unchanged = args.p_fingerprint === fingerprint;
      return route.fulfill({ json: { version: 1, owner: ownerId, fingerprint, count: state.clientSnapshotRows.length, not_modified: unchanged, payload: unchanged ? null : payload } });
    }
    if (url.pathname.endsWith("/rpc/read_cloud_mirror_snapshot")) {
      const args = request.postDataJSON();
      state.mirrorSnapshots.push(args);
      if (!state.batchedMirror) return route.fulfill({ status: 404, json: { code: "PGRST202", message: "Snapshot function is not installed" } });
      if (state.snapshotForbidden) return route.fulfill({ status: 403, json: { code: "42501", message: "Snapshot access denied" } });
      const values = Object.fromEntries(args.p_keys.map(key => {
        const mapping = snapshotMappings.find(m => m.key === key);
        if (!mapping) throw new Error(`Unknown snapshot key: ${key}`);
        if (mapping.table === "bank_rules_cloud") return [key, state.bankRules ?? []];
        if (mapping.table === "pending_bank_items_cloud") return [key, Array.from({ length: state.pendingBankCount ?? 0 }, (_, i) => ({ id: `pending-${i}`, amount: i + 1 }))];
        if (mapping.table === "late_fee_settings_cloud") return [key, state.lateFeeSettings ? { user_id: ownerId, data: state.lateFeeSettings } : null];
        if (mapping.table === "other_charges_retention_cloud") return [key, state.retentionSettings ? { user_id: ownerId, data: state.retentionSettings } : null];
        return [key, mapping.array ? [] : null];
      }));
      if (state.snapshotIncomplete) delete values[args.p_keys.at(-1)];
      return route.fulfill({ json: { version: 1, values } });
    }
    if (url.pathname.endsWith("/user_profiles")) {
      state.profileReads++;
      if (state.profileGate) await state.profileGate.promise;
      if (state.profileError) return route.fulfill({ status: 403, json: { code: "42501", message: "profile unavailable" } });
      if (state.transientProfile && state.profileReads === 1) return route.fulfill({ status: 503, json: { code: "08006", message: "network timeout" } });
      return route.fulfill({ json: state.missingProfile ? null : profile });
    }
    if (/\/(collision_cases_cloud|insurance_claims_cloud|pending_incidents_cloud)$/.test(url.pathname)) {
      state.badgeReads.push(url.pathname);
      return route.fulfill({ json: [] });
    }
    if (url.pathname.endsWith("/clients_cloud")) {
      state.coreReads++;
      if (state.coreGate) await state.coreGate.promise;
      return route.fulfill({ json: [] });
    }
    if (url.pathname.endsWith("/pending_bank_items_cloud")) {
      state.mirrorReads++;
      if (state.mirrorGate) await state.mirrorGate.promise;
      return route.fulfill({ json: [] });
    }
    if (url.pathname.endsWith("/bank_rules_cloud")) {
      if (request.method() === "POST") {
        state.bankRuleSaves.push(request.postDataJSON());
        return route.fulfill({ status: 201, json: [] });
      }
      return route.fulfill({ json: (state.bankRules ?? []).map(rule => ({ user_id: ownerId, id: rule.id, data: rule })) });
    }
    if (url.pathname.endsWith("/late_fee_settings_cloud")) return route.fulfill({ json: state.lateFeeSettings ? { data: state.lateFeeSettings } : null });
    if (url.pathname.endsWith("/other_charges_retention_cloud")) return route.fulfill({ json: state.retentionSettings ? { data: state.retentionSettings } : null });
    if (url.pathname.endsWith("/storage/v1/object/sign/fleet-catalog-photos")) {
      state.signingReads++;
      return route.fulfill({ json: [] });
    }
    if (url.pathname.endsWith("/manual_assignment_audit_cloud")) {
      if (request.method() === "POST") {
        state.auditSaves.push(request.postDataJSON());
        return route.fulfill({ status: 201, json: [] });
      }
      state.auditReads.push({ after: url.searchParams.get("id"), owner: url.searchParams.get("user_id") });
      if (state.auditGate) await state.auditGate.promise;
      if (state.auditError) return route.fulfill({ status: 403, json: { code: "42501", message: "audit unavailable" } });
      const after = (url.searchParams.get("id") ?? "gt.").slice(3);
      const audit = Array.from({ length: state.auditCount ?? 0 }, (_, i) => ({
        id: String(i).padStart(5, "0"), data: { id: String(i).padStart(5, "0"), folio: `test-${i}`, createdAt: "2026-11-24T12:00:00Z" }
      })).filter(row => row.id > after);
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const pageRows = audit.slice(offset, offset + Number(url.searchParams.get("limit") ?? 1000));
      return route.fulfill({ json: pageRows });
    }
    if (url.pathname.endsWith("/vw_control_unidades")) {
      state.fleetReads.push(url.searchParams.get("user_id"));
      if (state.activeGate) await state.activeGate.promise;
      if (state.activeError) return route.fulfill({ status: 403, json: { code: "42501", message: "active fleet unavailable" } });
      return route.fulfill({ json: fleet });
    }
    if (url.pathname.endsWith("/fleet_units_cloud") && url.searchParams.get("retired_at") === "not.is.null") {
      state.retiredReads++;
      if (state.retiredGate) await state.retiredGate.promise;
      if (state.retiredError) return route.fulfill({ status: 403, json: { code: "42501", message: "retired fleet unavailable" } });
      return route.fulfill({ json: [] });
    }
    if (url.pathname.endsWith("/fleet_units_cloud") && /catalog_daily_rate|key_coded/.test(url.searchParams.get("select") ?? "")) {
      state.detailReads++;
      return route.fulfill({ json: [{ ...fleet[0], key_coded: true, catalog_daily_rate: 25, catalog_photo_path: state.publicPhoto ? `${ownerId}/fleet-photo.jpg` : null }] });
    }
    return route.fulfill({ json: [] });
  });
  return { context, page, state };
}

async function waitFor(check, message) {
  const until = Date.now() + 15000;
  while (!check()) {
    if (Date.now() > until) throw Error(message);
    await delay(30);
  }
}

try {
  await waitFor(() => output.includes("4196") || server.exitCode !== null, "Vite startup timeout");
  assert.equal(server.exitCode, null, output);
  browser = await chromium.launch({ headless: true });

  for (const publicRoute of [
    { path: "/portal-cliente", heading: "Bienvenido", module: "/src/pages/ClientPortalPage.tsx" },
    { path: `/catalogo/${ownerId}`, heading: "Catálogo", module: "/src/pages/PublicFleetCatalogPage.tsx" }
  ]) {
    const { context, page, state } = await createCase();
    await page.goto(base + publicRoute.path, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.getByRole("heading", { name: publicRoute.heading, exact: true }).waitFor();
    assert.ok(state.modules.has(publicRoute.module));
    assert.ok(!state.modules.has("/src/AppShell.tsx"), "Public portals do not download the operational shell");
    assert.equal(state.profileReads, 0);
    assert.equal(state.fleetReads.length, 0);
    assert.equal(state.writes.length, 0);
    assert.deepEqual(state.errors, []);
    await context.close();
    console.log(`PASS public route ${publicRoute.path} loads independently without operational session or data reads.`);
  }

  for (const [path, module] of [
    ["/clientes", "ClientsPage"], ["/leads", "LeadsPage"], ["/pagos", "PaymentsPage"],
    ["/cuentas-por-cobrar", "ReceivablesPage"], ["/cuentas-por-cobrar-2", "ReceivablesV2Page"],
    ["/ruta-en-calle", "RouteSearchPage"], ["/control-de-siniestros", "IncidentsControlPage"],
    ["/configuraciones", "SettingsPage"]
  ]) {
    const gate = deferred();
    const { context, page, state } = await createCase({ profileGate: gate });
    try {
      await page.goto(base + path, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.getByText("Cargando perfil...").waitFor();
      const modulePath = `/src/pages/${module}.tsx`;
      await waitFor(() => state.modules.has(modulePath), `${module} did not preload during profile validation`);
      // Complete module evaluation to catch imports with premature data side effects.
      await page.evaluate(async modulePath => { await import(modulePath); }, modulePath);
      assert.deepEqual(state.operationalReads, [], `${module} fetched data before access validation`);
      assert.deepEqual(state.writes, []);
      assert.equal(await page.getByRole("navigation").count(), 0);
      assert.deepEqual(state.errors, []);
    } finally {
      gate.resolve();
      await context.close();
    }
    console.log(`PASS ${module} preloads code while profile is pending without operational reads, writes or provisional access.`);
  }

  for (const batchedMirror of [false, true]) {
    const bankRule = { id: "bank-one", accountNumber: "12345", accountName: "Banco de prueba", groupCode: "A", active: true, createdAt: "2026-11-24T12:00:00Z", updatedAt: "2026-11-24T12:00:00Z" };
    const lateFeeSettings = { active: true, dailyAmount: 7, chargeLabel: "Cargo de prueba", selectedUnits: ["A01"] };
    const { context, page, state } = await createCase({ bankRules: [bankRule], lateFeeSettings, retentionSettings: {}, publicPhoto: true, batchedMirror, pendingBankCount: batchedMirror ? 2501 : 0 });
    await page.goto(base + "/autos", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.getByRole("heading", { name: "Auto de prueba", exact: true }).waitFor();
    const photo = page.getByRole("img", { name: "Auto de prueba en catálogo", exact: true });
    assert.equal(await photo.getAttribute("src"), `https://local-loading-tests.invalid/storage/v1/object/public/fleet-catalog-photos/${ownerId}/fleet-photo.jpg`);
    assert.equal(state.signingReads, 0, "Already public photos must not block fleet loading on signed URLs");
    assert.deepEqual(await page.evaluate(async () => {
      const { loadBankRules, loadLateFeeSettings } = await import("/src/storage.ts");
      return { bankRules: loadBankRules(), lateFeeSettings: loadLateFeeSettings() };
    }), { bankRules: [bankRule], lateFeeSettings });
    // Let the normal 1s mirror debounce expire to catch hydration echo writes.
    await delay(1600);
    for (const table of ["bank_rules_cloud", "late_fee_settings_cloud", "other_charges_retention_cloud", "other_charges_retention_checkpoints_cloud"]) {
      assert.equal(state.operationalReads.filter(path => path.endsWith(`/${table}`)).length, batchedMirror && table !== "other_charges_retention_checkpoints_cloud" ? 0 : 1, `${table} should not have duplicate reads`);
    }
    assert.equal(state.mirrorSnapshots.length, 1);
    assert.equal(state.mirrorSnapshots[0].p_user_id, ownerId);
    assert.ok(!state.mirrorSnapshots[0].p_keys.includes("cobrapp.module2.manual_assignment_audit.v1"));
    if (batchedMirror) {
      assert.equal(await page.evaluate(async () => {
        const { readIndexedDb } = await import("/src/storage/indexedDbStorage.ts");
        return (await readIndexedDb("pending_bank.v1")).length;
      }), 2501, "The snapshot must commit every record, beyond REST page limits");
    }
    assert.deepEqual(state.writes, [], "Downloading settings must not write them back to the server");
    await page.evaluate(async () => {
      const { loadBankRules, saveBankRules } = await import("/src/storage.ts");
      saveBankRules([...loadBankRules(), { id: "bank-two", accountNumber: "67890", accountName: "Otro banco", groupCode: "B", active: true }]);
      const { flushCloudMirror } = await import("/src/cloudMirror.ts");
      await flushCloudMirror();
    });
    assert.equal(state.bankRuleSaves.length, 1, "Real settings edits must still synchronize");
    assert.equal(state.bankRuleSaves[0].length, 2, "An edit must preserve the settings loaded from cloud");
    assert.ok(state.bankRuleSaves[0].every(row => row.user_id === ownerId));
    assert.deepEqual(state.errors, []);
    await context.close();
    console.log(`PASS ${batchedMirror ? "batched" : "legacy"} settings hydrate completely without duplicate reads or echo writes; real edits still sync all records; public photos need no signing request.`);
  }

  for (const snapshotForbidden of [false, true]) {
    const { context, page, state } = await createCase({ batchedMirror: true, snapshotIncomplete: !snapshotForbidden, snapshotForbidden, bankRules: [{ id: "must-not-commit" }] });
    await page.goto(base + "/autos", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.getByText(/Fallo la sincronizacion inicial con nube/).waitFor();
    assert.equal(state.mirrorSnapshots.length, 1);
    assert.equal(state.mirrorReads, 0, "Invalid or unauthorized snapshots must not silently fall back");
    assert.equal(await page.evaluate(() => localStorage.getItem("cobrapp.settings.bank_rules.v1")), null, "An invalid snapshot must not commit even its valid keys");
    assert.deepEqual(state.writes, []);
    await context.close();
    console.log(`PASS ${snapshotForbidden ? "unauthorized" : "incomplete"} snapshot reports an error without partial commits, fallback or writes.`);
  }

  {
    const auditGate = deferred();
    const { context, page, state } = await createCase({ auditGate, auditCount: 2501 });
    await page.goto(base + "/autos", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.getByRole("heading", { name: "Auto de prueba", exact: true }).waitFor();
    await waitFor(() => state.auditReads.length > 0, "Audit did not start in the background");
    await page.getByRole("link", { name: "Pagos", exact: true }).click();
    await page.getByText("Cargando auditoria de pagos...", { exact: true }).waitFor();
    assert.equal(await page.getByRole("heading", { name: "Registrar pago", exact: true }).count(), 0);
    auditGate.resolve();
    await page.getByRole("heading", { name: "Registrar pago", exact: true }).waitFor();
    const snapshot = await page.evaluate(async () => {
      const { loadManualBankAssignmentAuditFromIndexedDb } = await import("/src/storage.ts");
      const rows = await loadManualBankAssignmentAuditFromIndexedDb();
      return { count: rows.length, first: rows[0]?.id, last: rows.at(-1)?.id, marker: localStorage.getItem("cobrapp.module2.manual_assignment_audit.v1") };
    });
    assert.deepEqual(snapshot, { count: 2501, first: "00000", last: "02500", marker: "__indexeddb__" });
    assert.equal(state.auditReads.length, 3, "Entire audit is loaded without truncating history");
    assert.ok(state.auditReads.every(read => read.owner === `eq.${ownerId}`));
    assert.equal(state.writes.length, 0, JSON.stringify(state.writes));
    assert.deepEqual(state.errors, []);
    await page.evaluate(async () => {
      const { loadManualBankAssignmentAuditFromIndexedDb, saveManualBankAssignmentAudit } = await import("/src/storage.ts");
      const rows = await loadManualBankAssignmentAuditFromIndexedDb();
      saveManualBankAssignmentAudit([...rows, { id: "new-audit", folio: "new-folio", createdAt: "2026-11-24T13:00:00Z" }]);
      const { flushCloudMirror } = await import("/src/cloudMirror.ts");
      // Wait for the IndexedDB commit used by the normal debounced mirror.
      await new Promise(resolve => setTimeout(resolve, 50));
      await flushCloudMirror();
    });
    assert.equal(state.auditSaves.length, 1, "Normal mirror synchronization stays enabled after background hydration");
    assert.equal(state.auditSaves[0].length, 2502, "A new event preserves every hydrated row");
    assert.ok(state.auditSaves[0].every(row => row.user_id === ownerId));
    assert.equal(state.auditSaves[0].filter(row => row.id === "new-audit").length, 1);
    await context.close();
    console.log("PASS slow audit does not block Autos; Payments waits for 2501 rows; hydration has no echo and later edits sync all 2502 rows.");
  }

  {
    const { context, page, state } = await createCase({ auditError: true, auditCount: 2 });
    await page.goto(base + "/autos", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.getByRole("heading", { name: "Auto de prueba", exact: true }).waitFor();
    await page.getByRole("link", { name: "Pagos", exact: true }).click();
    await page.getByText("No se pudo cargar la auditoria de pagos. Vuelve a intentar.").waitFor();
    assert.equal(await page.getByRole("heading", { name: "Registrar pago", exact: true }).count(), 0);
    state.auditError = false;
    await page.getByRole("button", { name: "Volver a intentar", exact: true }).click();
    await page.getByRole("heading", { name: "Registrar pago", exact: true }).waitFor();
    assert.deepEqual(state.errors, []);
    await context.close();
    console.log("PASS audit failure leaves other modules available, blocks partial Payments state, and retry recovers.");
  }

  {
    const coreGate = deferred(), mirrorGate = deferred(), activeGate = deferred();
    const { context, page, state } = await createCase({ coreGate, mirrorGate, activeGate });
    await page.goto(base + "/autos", { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitFor(() => state.coreReads > 0 && state.mirrorReads > 0, "Core and mirror reads must start together");
    await waitFor(() => state.fleetReads.length > 0 && state.detailReads >= 2, "Visible fleet must start alongside core and mirror reads");
    await waitFor(() => state.modules.has("/src/pages/ControlUnitsPage.tsx"), "Autos code must preload while core data is still pending");
    assert.equal(state.badgeReads.length, 0, "Menu badges do not compete with the critical startup queries");
    activeGate.resolve();
    assert.equal(await page.getByRole("heading", { name: "Auto de prueba", exact: true }).count(), 0, "Fleet preload must not bypass core hydration");
    assert.equal(await page.getByRole("button", { name: "Nuevo auto", exact: true }).count(), 0);
    coreGate.resolve();
    await page.getByText("Cargando data de nube...", { exact: true }).waitFor();
    assert.equal(await page.getByRole("heading", { name: "Auto de prueba", exact: true }).count(), 0, "Operational screen stays gated until mirror settings are loaded");
    mirrorGate.resolve();
    await page.getByRole("heading", { name: "Auto de prueba", exact: true }).waitFor();
    assert.equal(state.fleetReads.length, 1, "The screen consumes the live fleet hook without starting a second fetch");
    assert.ok(![...state.modules].some(path => /\/pages\/(ClientPortalPage|SellerLeadPortalPage|PublicFleetCatalogPage|CatalogWorkflowDemoPage)\.tsx$/.test(path)), "Operational startup must not download unrelated public portals");
    assert.ok(!state.modules.has("/src/components/ForcePasswordChangePanel.tsx"));
    await waitFor(() => state.badgeReads.length > 0, "Deferred menu badges must still load after startup");
    assert.deepEqual(state.errors, []);
    assert.equal(state.writes.length, 0, JSON.stringify(state.writes));
    await context.close();
    console.log("PASS core, mirror and fleet load concurrently with one fleet fetch; operational screen still waits for complete settings.");
  }

  {
    const gate = deferred();
    const { context, page, state } = await createCase({ profileGate: gate });
    await page.clock.install();
    await page.goto(base + "/autos", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.getByText("Cargando perfil...").waitFor();
    await waitFor(() => state.profileReads > 0, "Profile query never started");
    await waitFor(() => state.modules.has("/src/AppShell.tsx"), "Shell code must download during profile validation");
    await waitFor(() => state.modules.has("/src/pages/ControlUnitsPage.tsx"), "Requested page code must download during profile validation");
    assert.equal(state.coreReads, 0, "Preloading code must not start core reads before access is validated");
    assert.equal(state.mirrorReads, 0, "Preloading code must not hydrate another owner's settings");
    assert.ok(!state.modules.has("/src/pages/PaymentsPage.tsx"), "Only the requested page should preload");
    await page.clock.fastForward(2600);
    assert.equal(await page.getByText("Cargando perfil...").count(), 1, "Slow profile must not open the application with a provisional role");
    assert.equal(state.fleetReads.length, 0, "No data reads with a provisional owner");
    gate.resolve();
    await page.getByRole("link", { name: "Clientes", exact: true }).waitFor();
    await page.getByRole("heading", { name: "Auto de prueba", exact: true }).waitFor();
    assert.ok(state.fleetReads.every(value => value === `eq.${ownerId}`));
    assert.equal(state.writes.length, 0, JSON.stringify(state.writes));
    assert.deepEqual(state.errors, []);
    await context.close();
    console.log("PASS slow profile keeps loading past 2.5s, then opens the complete admin menu and correct owner fleet.");
  }

  for (const missingProfile of [false, true]) {
    const { context, page, state } = await createCase({ profileError: !missingProfile, missingProfile });
    await page.goto(base + "/autos", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.getByText("No se pudo cargar tu perfil de acceso. Revisa tu conexion y vuelve a intentar.").waitFor();
    assert.equal(state.fleetReads.length, 0);
    assert.equal(await page.getByRole("navigation").count(), 0);
    state.profileError = false;
    state.missingProfile = false;
    await page.getByRole("button", { name: "Volver a intentar", exact: true }).click();
    await page.getByRole("link", { name: "Clientes", exact: true }).waitFor();
    assert.deepEqual(state.errors, []);
    await context.close();
    console.log(`PASS ${missingProfile ? "missing" : "failed"} profile reports a recoverable error without silently downgrading permissions.`);
  }

  {
    const { context, page, state } = await createCase({ transientProfile: true });
    await page.goto(base + "/autos", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.getByRole("link", { name: "Clientes", exact: true }).waitFor();
    assert.ok(state.profileReads >= 2);
    assert.deepEqual(state.errors, []);
    await context.close();
    console.log("PASS transient profile network failure retries and restores the admin menu.");
  }

  {
    const gate = deferred();
    const { context, page, state } = await createCase({ profileGate: gate });
    await page.clock.install();
    await page.goto(base + "/autos", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.getByText("Cargando perfil...").waitFor();
    await waitFor(() => state.profileReads > 0, "Profile query never started");
    await page.clock.fastForward(12001);
    await page.getByText("La carga del perfil tardo demasiado. Revisa tu conexion y vuelve a intentar.").waitFor();
    gate.resolve();
    assert.equal(state.fleetReads.length, 0);
    assert.equal(await page.getByRole("navigation").count(), 0);
    await context.close();
    console.log("PASS profile deadline shows retry instead of infinite loading or provisional access.");
  }

  {
    const gate = deferred();
    const { context, page, state } = await createCase({ retiredGate: gate, retiredError: true });
    await page.goto(base + "/autos", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.getByRole("heading", { name: "Auto de prueba", exact: true }).waitFor();
    assert.equal(await page.getByText("Cargando flota...", { exact: true }).count(), 0, "Retired fleet must not block active fleet");
    gate.resolve();
    await page.getByRole("button", { name: /^Dados de baja/ }).click();
    await page.getByText("No se pudieron cargar los autos dados de baja. Vuelve a intentar.").waitFor();
    state.retiredError = false;
    await page.getByRole("button", { name: "Volver a intentar", exact: true }).click();
    await page.getByRole("alert").waitFor({ state: "detached" });
    await page.getByRole("button", { name: /^Catálogo \(/ }).click();
    await page.getByRole("heading", { name: "Auto de prueba", exact: true }).waitFor();
    assert.deepEqual(state.errors, []);
    await context.close();
    console.log("PASS slow/failed retired reads leave active autos usable; retry clears the separate error.");
  }

  {
    const { context, page, state } = await createCase({ activeError: true });
    await page.goto(base + "/autos", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.getByText("No se pudieron cargar los autos activos. Vuelve a intentar.").waitFor();
    state.activeError = false;
    await page.getByRole("button", { name: "Volver a intentar", exact: true }).click();
    await page.getByRole("heading", { name: "Auto de prueba", exact: true }).waitFor();
    assert.equal(await page.getByRole("alert").count(), 0);
    assert.deepEqual(state.errors, []);
    await context.close();
    console.log("PASS active fleet retry restores autos and clears the error without a full page reload.");
  }
  {
    const rows = Array.from({ length: 2501 }, (_, i) => ({ id: `client-${i}`, data: { id: `client-${i}`, name: `Cliente ${i}`, unitId: `C${i}`, status: "activo", balance: i + 0.25, rentAmount: 10, frequency: "weekly", installmentsPaid: 3, installmentsAgreed: 80, installmentsIssued: 9, customHistory: ["ñ", i] } }));
    const payment = { id: "payment-current", clientId: "client-0", amount: 12.5, dateApplied: "2026-11-24", createdAt: "2026-11-24T12:00:00Z", paymentMethod: "Efectivo", moneyDelivered: false, customHistory: ["preservar", 23] };
    const initialPayments = { recent: [payment], pending: [{ ...payment, id: "payment-old-pending", dateApplied: "2025-01-01" }] };
    const { context, page, state } = await createCase({ clientSnapshotRows: rows, initialPayments, batchedMirror: true, batchedFleet: true });
    const ready = async () => {
      try { await page.getByRole("heading", { name: "Auto de prueba", exact: true }).waitFor(); }
      catch (error) {
        console.error(JSON.stringify({ phase: "snapshot-case", clients: state.clientSnapshots, fleet: state.fleetSnapshots, errors: state.errors, body: (await page.locator("body").innerText()).slice(0, 1600) }));
        throw error;
      }
    };
    const cacheKey = `cloud-clients-snapshot.v1:https://local-loading-tests.invalid:${ownerId}`;
    const paymentsCacheKey = `cloud-initial-payments-snapshot.v1:https://local-loading-tests.invalid:${ownerId}`;
    const readCache = () => page.evaluate(async key => (await import("/src/storage/indexedDbStorage.ts")).readIndexedDb(key), cacheKey);
    const readPaymentsCache = () => page.evaluate(async key => (await import("/src/storage/indexedDbStorage.ts")).readIndexedDb(key), paymentsCacheKey);
    await page.goto(base + "/autos", { waitUntil: "domcontentloaded", timeout: 60000 });
    await ready();
    assert.equal(state.clientSnapshots.length, 1);
    assert.equal(state.clientSnapshots[0].p_fingerprint, null);
    assert.deepEqual(JSON.parse((await readCache()).payload), rows);
    assert.deepEqual(JSON.parse((await readPaymentsCache()).payload), initialPayments);
    assert.equal(state.paymentSnapshots[0].p_fingerprint, null);
    state.clientValidationGate = deferred();
    state.paymentsValidationGate = deferred();
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitFor(() => state.clientSnapshots.length === 2, "Warm cache validation never started");
    await page.getByText("Cargando data de nube...", { exact: true }).waitFor();
    assert.equal(await page.getByRole("heading", { name: "Auto de prueba", exact: true }).count(), 0, "Cached data cannot open the app before server validation");
    state.clientValidationGate.resolve();
    state.clientValidationGate = null;
    await waitFor(() => state.paymentSnapshots.length === 2, "Warm payments validation never started");
    assert.equal(await page.getByRole("heading", { name: "Auto de prueba", exact: true }).count(), 0, "Cached payments still require a fresh server response");
    state.paymentsValidationGate.resolve();
    state.paymentsValidationGate = null;
    await ready();
    assert.equal(state.clientSnapshots[1].p_fingerprint, (await readCache()).fingerprint);
    assert.equal(state.paymentSnapshots[1].p_fingerprint, (await readPaymentsCache()).fingerprint);
    state.clientSnapshotRows = [{ ...rows[0], data: { ...rows[0].data, balance: 987.65 } }, ...rows.slice(2)];
    state.initialPayments = { recent: [{ ...payment, amount: 25.25, moneyDelivered: true }], pending: [] };
    await page.reload({ waitUntil: "domcontentloaded" });
    await ready();
    assert.deepEqual(JSON.parse((await readCache()).payload), state.clientSnapshotRows, "Cloud updates/deletions must replace the full cache");
    assert.deepEqual(JSON.parse((await readPaymentsCache()).payload), state.initialPayments, "New payments and delivered cash must replace the full payment cache");
    await page.evaluate(async key => {
      const storage = await import("/src/storage/indexedDbStorage.ts");
      const cached = await storage.readIndexedDb(key);
      cached.payload = "[]";
      await storage.writeIndexedDb(key, cached);
    }, cacheKey);
    await page.evaluate(async key => {
      const storage = await import("/src/storage/indexedDbStorage.ts");
      const cached = await storage.readIndexedDb(key);
      cached.payload = "{}";
      await storage.writeIndexedDb(key, cached);
    }, paymentsCacheKey);
    await page.reload({ waitUntil: "domcontentloaded" });
    await ready();
    assert.equal(state.clientSnapshots.at(-1).p_fingerprint, null, "Corrupt cache must be rejected before server validation");
    assert.deepEqual(JSON.parse((await readCache()).payload), state.clientSnapshotRows);
    assert.equal(state.paymentSnapshots.at(-1).p_fingerprint, null);
    assert.deepEqual(JSON.parse((await readPaymentsCache()).payload), state.initialPayments);
    assert.equal(state.paymentSnapshots.length, 4);
    assert.equal(state.operationalReads.filter(path => path.endsWith("/payments_cloud") || path.endsWith("/rpc/read_pending_cash_payments")).length, 0, "Payment snapshot replaces both previous startup reads");
    assert.equal(state.coreReads, 0, "Installed snapshot RPC replaces the two full range transfers");
    assert.equal(state.fleetReads.length, 0, "Installed fleet snapshot replaces the view read");
    assert.equal(state.detailReads, 0, "Catalog and key details arrive in the same complete snapshot");
    assert.equal(state.fleetSnapshots.length, 4);
    assert.deepEqual(state.writes, [], "Cache hydration must never echo writes to the cloud");
    assert.deepEqual(state.errors, []);
    await context.close();
    console.log("PASS validated startup snapshots: 2501 clients, recent and older pending payments, fresh server validation, remote updates/deletions, corruption recovery, grouped fleet and no echo writes.");
  }
  console.log("PASS local loading regression suite. No production sessions or database writes.");
} catch (error) {
  console.error(output);
  throw error;
} finally {
  await browser?.close();
  server.kill();
}
