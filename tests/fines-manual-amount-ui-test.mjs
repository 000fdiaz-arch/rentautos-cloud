import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const base = "http://127.0.0.1:4197";
const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "4197", "--strictPort"], {
  windowsHide: true, stdio: "pipe", env: { ...process.env, VITE_SUPABASE_URL: "https://fines-tests.invalid", VITE_SUPABASE_ANON_KEY: "test" }
});
let browser, cases = 0;
const check = label => { cases++; console.log("OK", label); };
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Vite startup timeout")), 15000);
    server.stdout.on("data", data => { if (data.toString().includes("4197")) { clearTimeout(timer); resolve(); } });
    server.on("error", reject);
  });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin !== base) return route.abort();
    if (url.pathname === "/fines-test") return route.fulfill({ contentType: "text/html", body: `<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div><script type="module">
      import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
      </script><script type="module" src="/tests/fixtures/fines-settings.tsx"></script>` });
    return route.continue();
  });
  const clients = async () => JSON.parse(await page.locator("#fines-clients").textContent());
  const fines = async () => (await clients()).find(row => row.id === "fine-client").fines;
  const amountChoice = () => page.getByLabel("Monto de la multa");
  const type = () => page.getByLabel("Tipo de multa");
  const manual = () => page.getByLabel("Monto manual sin centavos ($)", { exact: true });
  const unit = () => page.getByLabel("Numero de unidad", { exact: true });
  const save = () => page.getByRole("button", { name: "Agregar multa", exact: true }).click();
  await page.goto(base + "/fines-test");
  const otherClient = (await clients()).find(row => row.id === "other-client");
  assert.equal(await amountChoice().inputValue(), "5");
  await unit().fill("t99");
  await save();
  assert.equal((await fines()).at(-1).amount, 5);
  check("Panapass conserva montos predefinidos y registra en la unidad indicada");

  await unit().fill("T99");
  await amountChoice().selectOption("custom");
  assert.equal(await manual().getAttribute("min"), "1");
  assert.equal(await manual().getAttribute("step"), "1");
  assert.equal(await manual().getAttribute("inputmode"), "numeric");
  for (const invalid of ["", "0", "-1", "0.01", "0.50", "0.001", "1.234", "12.50", "10000000000000000"]) {
    const before = await clients();
    await manual().fill(invalid);
    await save();
    assert.equal(await page.locator(".error-list").isVisible(), true);
    assert.match(await page.locator(".error-list").innerText(), /número entero.*sin centavos/);
    assert.deepEqual(await clients(), before);
  }
  check("rechaza monto vacío, cero, negativo, centavos y números fuera de precisión segura");
  await manual().fill("12"); await save();
  assert.equal((await fines()).at(-1).amount, 12);
  assert.equal((await fines()).at(-1).status, "pending");
  assert.equal((await fines()).at(-1).amountPaid, 0);
  assert.equal(await manual().inputValue(), "");
  await unit().fill("T99"); await manual().fill("47"); await save();
  assert.equal((await fines()).at(-1).amount, 47);
  check("Panapass acepta monto manual inferior y superior a 30 con saldo pendiente correcto");

  for (const [fineType, custom] of [["NO_ACH_XPRESS", "3"], ["MISSING_UNIT_CENTS", "1"]]) {
    await type().selectOption(fineType);
    assert.equal(await amountChoice().inputValue(), "1");
    assert.equal(await manual().count(), 0);
    await unit().fill("T99"); await save();
    assert.equal((await fines()).at(-1).amount, 1);
    await unit().fill("T99"); await amountChoice().selectOption("custom");
    const beforeDecimal = await clients();
    await manual().fill("3.50"); await save();
    assert.deepEqual(await clients(), beforeDecimal);
    assert.match(await page.locator(".error-list").innerText(), /sin centavos/);
    await manual().fill(custom); await save();
    assert.equal((await fines()).at(-1).amount, Number(custom));
    assert.equal((await fines()).at(-1).type, fineType);
  }
  check("ACH Xpress y centavos conservan $1 predeterminado y permiten monto manual, desde $1");
  await manual().fill("80"); await type().selectOption("NEGATIVE_PANAPASS_BALANCE");
  assert.equal(await amountChoice().inputValue(), "5");
  await amountChoice().selectOption("custom"); assert.equal(await manual().inputValue(), "");
  await manual().fill("99"); await amountChoice().selectOption("10");
  await unit().fill("T99"); await save(); assert.equal((await fines()).at(-1).amount, 10);
  check("cambiar tipo restablece el monto y elegir un predefinido ignora el manual anterior");
  for (const invalidUnit of ["", "NO-EXISTE", "T97"]) {
    const before = await clients(); await unit().fill(invalidUnit); await save();
    assert.deepEqual(await clients(), before);
    assert.match(await page.locator(".error-list").innerText(), /cliente activo/);
  }
  assert.deepEqual((await clients()).find(row => row.id === "other-client"), otherClient);
  check("rechaza unidad inexistente o archivada y conserva las multas de otras unidades");
  const savedFines = await fines();
  await page.reload();
  assert.deepEqual(await fines(), savedFines);
  check("montos manuales se conservan al recargar desde IndexedDB y normalizar clientes");
  await page.evaluate(async () => {
    const { getPendingFinesTotal, distributeAcrossFines, applyFinePayments } = await import("/src/pages/payments/paymentRules.ts");
    const clients = JSON.parse(document.querySelector("#fines-clients").textContent);
    const target = clients.find(row => row.id === "fine-client");
    const manualFine = target.fines.find(fine => fine.amount === 12);
    const scoped = { ...target, fines: [manualFine] };
    if (getPendingFinesTotal(scoped) !== 12) throw new Error("Saldo manual incorrecto");
    const partial = applyFinePayments(scoped.fines, distributeAcrossFines(scoped, 2), new Date().toISOString());
    if (partial[0].status !== "partial" || partial[0].amountPaid !== 2) throw new Error("Aplicación parcial incorrecta");
    const partialClient = { ...scoped, fines: partial };
    if (getPendingFinesTotal(partialClient) !== 10) throw new Error("Saldo parcial incorrecto");
    const paid = applyFinePayments(partial, distributeAcrossFines(partialClient, 20), new Date().toISOString());
    if (paid[0].amountPaid !== 12 || paid[0].status !== "paid") throw new Error("No respeta monto manual al saldar");
  });
  check("cobro de multa manual respeta monto entero, abono parcial y pago total sin cobrar de más");
  await page.evaluate(async () => {
    const { loadClients } = await import("/src/storage/coreStorage.ts");
    const { normalizeCloudClient } = await import("/src/cloud/clientCloudData.ts");
    const target = JSON.parse(document.querySelector("#fines-clients").textContent).find(row => row.id === "fine-client");
    const fine = { ...target.fines.find(row => row.amount === 12), amount: 12.5 };
    const valid = [
      { ...fine, id: "partial", amountPaid: 2, status: "partial" },
      { ...fine, id: "paid", amountPaid: 12.5, status: "paid", paidAt: "2026-09-02T12:00:00Z" }
    ];
    const key = "cobrapp.module1.clients.v1", previous = localStorage.getItem(key);
    try {
      localStorage.setItem(key, JSON.stringify([{ ...target, fines: [...valid, null, {}, { ...fine, amount: "invalid" }] }]));
      if (JSON.stringify(loadClients()[0].fines) !== JSON.stringify(valid)) throw new Error("Lectura local altera el pago o acepta registros inválidos");
      if (JSON.stringify(normalizeCloudClient({ ...target, fines: valid }).fines) !== JSON.stringify(valid)) throw new Error("Lectura de nube altera multas");
    } finally {
      if (previous === null) localStorage.removeItem(key); else localStorage.setItem(key, previous);
    }
  });
  check("lectura local y de nube conserva pagos parciales, pagados y fecha; omite registros locales inválidos");
  await unit().fill("T99"); await amountChoice().selectOption("custom"); await manual().fill("12");
  mkdirSync(".tmp/fines-manual", { recursive: true });
  await page.screenshot({ path: ".tmp/fines-manual/desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: ".tmp/fines-manual/mobile.png", fullPage: true });
  check("campo manual accesible y diseño móvil sin desbordamiento");
  assert.deepEqual(errors, []);
  console.log(`PASS ${cases} escenarios; datos sintéticos y sin acceso a producción.`);
} finally { await browser?.close(); server.kill(); }
