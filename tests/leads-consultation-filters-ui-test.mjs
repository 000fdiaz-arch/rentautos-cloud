import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const base = "http://127.0.0.1:4195";
const owner = "11111111-1111-4111-8111-111111111111";
const consultations = [
  { id: "attention-1", user_id: owner, cedula: "8-783-2400", seller_name: "Fernando Díaz", consultation_kind: "original", consulted_at: "2026-11-04T18:00:00.000Z" },
  { id: "attention-2", user_id: owner, cedula: "8-783-2400", seller_name: "MIXSY P.", consultation_kind: "follow_up", consulted_at: "2026-11-04T18:30:00.000Z" },
  { id: "attention-3", user_id: owner, cedula: "4-833-1524", seller_name: "Carlos Méndez", consultation_kind: "original", consulted_at: "2026-11-03T17:00:00.000Z" }
];
const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "4195", "--strictPort"], {
  stdio: "pipe",
  windowsHide: true,
  env: { ...process.env, VITE_SUPABASE_URL: "https://attention-tests.invalid", VITE_SUPABASE_ANON_KEY: "synthetic-test-key" }
});
let browser;

try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Server startup timeout")), 15000);
    server.stdout.on("data", chunk => {
      if (chunk.toString().includes("4195")) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.on("error", reject);
  });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === base) {
      if (url.pathname === "/attention-test") return route.fulfill({ contentType: "text/html", body: `<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div><script type="module">
        import RefreshRuntime from '/@react-refresh';
        RefreshRuntime.injectIntoGlobalHook(window);
        window.$RefreshReg$ = () => {};
        window.$RefreshSig$ = () => type => type;
        window.__vite_plugin_react_preamble_installed__ = true;
        </script><script type="module" src="/tests/fixtures/leads-performance.tsx"></script>` });
      return route.continue();
    }
    if (url.hostname !== "attention-tests.invalid") return route.abort();
    if (url.pathname.endsWith("/rpc/read_lead_evaluations_page")) return route.fulfill({ json: [] });
    if (url.pathname.endsWith("/seller_lead_requests")) return route.fulfill({ json: [] });
    if (url.pathname.endsWith("/seller_lead_consultations")) {
      assert.equal(Number(url.searchParams.get("limit")), 500);
      return route.fulfill({ json: consultations });
    }
    return route.abort();
  });

  await page.goto(base + "/attention-test", { waitUntil: "domcontentloaded", timeout: 60000 });
  const sellersTab = page.getByRole("tab", { name: "Zona de vendedores", exact: true });
  const attentionsTab = page.getByRole("tab", { name: "Atenciones registradas", exact: true });
  const recentTab = page.getByRole("tab", { name: "Dictámenes recientes", exact: true });
  await sellersTab.waitFor();
  await sellersTab.press("ArrowRight");
  assert.equal(await attentionsTab.getAttribute("aria-selected"), "true");
  await page.getByLabel("Nombre del vendedor", { exact: true }).fill("mixsy");
  assert.equal(await page.locator(".lead-consultation-history__list article").count(), 1);
  assert.match(await page.locator(".lead-consultation-history__list article").innerText(), /MIXSY P\./);
  await page.getByRole("combobox", { name: /Tipo de atención/ }).selectOption("original");
  await page.getByText("No encontramos atenciones con estos filtros.").waitFor();
  await page.getByRole("button", { name: "Limpiar filtros", exact: true }).click();
  assert.equal(await page.locator(".lead-consultation-history__list article").count(), 3);
  await page.getByLabel("Cédula", { exact: true }).fill("48331524");
  assert.equal(await page.locator(".lead-consultation-history__list article").count(), 1);
  assert.match(await page.locator(".lead-consultation-history__list article").innerText(), /4-833-1524/);
  await page.getByRole("button", { name: "Limpiar filtros", exact: true }).click();
  await page.getByLabel("Nombre del vendedor", { exact: true }).fill("mendez");
  assert.equal(await page.locator(".lead-consultation-history__list article").count(), 1);
  assert.match(await page.locator(".lead-consultation-history__list article").innerText(), /Carlos Méndez/);
  await page.getByRole("button", { name: "Limpiar filtros", exact: true }).click();
  await page.getByLabel("Fecha", { exact: true }).fill("2026-11-03");
  assert.equal(await page.locator(".lead-consultation-history__list article").count(), 1);
  await page.getByRole("button", { name: "Limpiar filtros", exact: true }).click();
  await attentionsTab.press("ArrowRight");
  assert.equal(await recentTab.getAttribute("aria-selected"), "true");
  assert.deepEqual(errors, []);
  console.log("PASS: attention tab is separate; cedula, seller, type and date filters work with keyboard navigation.");
} finally {
  if (browser) await browser.close();
  server.kill();
}
