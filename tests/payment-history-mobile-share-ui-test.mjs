import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const base = "http://127.0.0.1:4198";
const server = spawn(process.execPath, [
  "node_modules/vite/bin/vite.js",
  "--host", "127.0.0.1",
  "--port", "4198",
  "--strictPort"
], {
  windowsHide: true,
  stdio: "pipe",
  env: {
    ...process.env,
    VITE_SUPABASE_URL: "https://payment-history-share.invalid",
    VITE_SUPABASE_ANON_KEY: "test"
  }
});

let browser;
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Vite startup timeout")), 15000);
    server.stdout.on("data", (data) => {
      if (data.toString().includes("4198")) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.on("error", reject);
  });

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(30000);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: (data) => !location.search.includes("copy-only") && Array.isArray(data?.files) && data.files.length === 1
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data) => {
        if (location.search.includes("cancel-share")) {
          throw new DOMException("Share cancelled", "AbortError");
        }
        window.__sharedReceipt = {
          fields: Object.keys(data).sort(),
          fileName: data.files?.[0]?.name,
          fileType: data.files?.[0]?.type
        };
        if (location.search.includes("reload-during-share")) {
          await new Promise(() => undefined);
        }
      }
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        write: async () => { window.__copiedReceipt = true; }
      }
    });
  });
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== base) return route.abort();
    if (url.pathname === "/payment-history-share-test") {
      return route.fulfill({
        contentType: "text/html",
        body: `<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div><script type="module">
          import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);
          window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
          </script><script type="module" src="/tests/fixtures/payment-history-share.tsx"></script>`
      });
    }
    return route.continue();
  });

  const pendingButton = () => page.getByRole("button", { name: "Compartir el recibo REC-MOBILE" });
  const confirmation = () => page.getByRole("group", { name: "Confirmar envío de REC-MOBILE" });

  await page.goto(`${base}/payment-history-share-test?cancel-share`, { waitUntil: "domcontentloaded" });
  await pendingButton().click();
  await page.getByRole("status").filter({ hasText: /Compartir cancelado.*continúa "Por enviar"/ }).waitFor({ state: "visible" });
  assert.equal(await confirmation().count(), 0);
  assert.equal(await page.locator("#payment-status").textContent(), "pending");

  await page.goto(`${base}/payment-history-share-test`, { waitUntil: "domcontentloaded" });
  await pendingButton().click();
  await page.waitForFunction(() => document.querySelector("#payment-status")?.textContent === "sent");
  assert.deepEqual(await page.evaluate(() => window.__sharedReceipt), {
    fields: ["files"],
    fileName: "A01-REC_MOBILE-18_10_2026.png",
    fileType: "image/png"
  });
  assert.equal(await confirmation().count(), 0);
  assert.match(
    await page.getByRole("button", { name: "Compartir nuevamente el recibo REC-MOBILE" }).innerText(),
    /Enviado/
  );

  await page.goto(`${base}/payment-history-share-test?reload-during-share`, { waitUntil: "domcontentloaded" });
  await pendingButton().click();
  await page.waitForFunction(() => localStorage.getItem("rentautos.payment-history-share-intent.v1") !== null);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector("#payment-status")?.textContent === "sent");
  assert.equal(
    await page.evaluate(() => localStorage.getItem("rentautos.payment-history-share-intent.v1")),
    null,
    "El intento pendiente debe limpiarse después de recuperar el estado Enviado."
  );
  assert.match(
    await page.getByRole("button", { name: "Compartir nuevamente el recibo REC-MOBILE" }).innerText(),
    /Enviado/
  );

  await page.goto(`${base}/payment-history-share-test?copy-only`, { waitUntil: "domcontentloaded" });
  await pendingButton().click();
  await confirmation().waitFor({ state: "visible" });
  assert.equal(await page.locator("#payment-status").textContent(), "pending");
  assert.equal(await page.evaluate(() => window.__copiedReceipt), true);
  const mobileLayout = await page.evaluate(() => ({
    viewportWidth: innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    overflow: Array.from(document.querySelectorAll("*"))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return { tag: element.tagName, className: element.className, left: rect.left, right: rect.right, width: rect.width };
      })
      .filter((entry) => entry.right > innerWidth + 1 || entry.left < -1)
      .slice(0, 12)
  }));
  assert.ok(
    mobileLayout.documentWidth <= mobileLayout.viewportWidth + 1,
    `La confirmación desborda el celular: ${JSON.stringify(mobileLayout)}`
  );
  mkdirSync(".tmp/payment-history-share", { recursive: true });
  await page.screenshot({ path: ".tmp/payment-history-share/mobile-confirmation.png", fullPage: true });

  await confirmation().getByRole("button", { name: "Aún no" }).click();
  assert.equal(await page.locator("#payment-status").textContent(), "pending");
  await pendingButton().click();
  await confirmation().getByRole("button", { name: "Sí, enviado" }).click();
  await page.waitForFunction(() => document.querySelector("#payment-status")?.textContent === "sent");
  assert.match(
    await page.getByRole("button", { name: "Compartir nuevamente el recibo REC-MOBILE" }).innerText(),
    /Enviado/
  );

  await page.screenshot({ path: ".tmp/payment-history-share/mobile-sent.png", fullPage: true });
  console.log("OK historial móvil: compartir marca enviado al volver o recargar; cancelar conserva pendiente; copiar todavía exige confirmación.");
} finally {
  if (browser) await browser.close();
  server.kill();
}
