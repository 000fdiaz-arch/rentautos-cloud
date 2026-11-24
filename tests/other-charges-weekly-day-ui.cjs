const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const filename = path.join(root, "tests", "other-charges-weekly-day-preview.html");
const base = process.env.RENTAUTOS_WEEKDAY_TEST_URL ?? "http://127.0.0.1:5186";

(async () => {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, `<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div>
    <script type="module">
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import Panel from '/src/pages/settings/OtherChargesSettingsPanel.tsx';
      import { loadOtherChargesRetentionByClient, saveOtherChargesRetentionByClient } from '/src/storage/operationalStorage.ts';
      import '/src/styles.css';
      const clients = [{ id: 'test-t22', unitId: 'T22', name: 'Cliente T22', frequency: 'daily', status: 'activo', otherCharges: [{ amount: 100 }] }];
      function App() {
        const [settings, setSettings] = React.useState(() => loadOtherChargesRetentionByClient()['test-t22'] ? loadOtherChargesRetentionByClient() : { 'test-t22': { amount: 25, cycle: 'weekly' } });
        return React.createElement(Panel, { clients, settings, onChange: next => { saveOtherChargesRetentionByClient(next); setSettings(loadOtherChargesRetentionByClient()); } });
      }
      createRoot(document.getElementById('root')).render(React.createElement(App));
    </script></body></html>`);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${base}/tests/other-charges-weekly-day-preview.html`, { waitUntil: "domcontentloaded" });
    const day = page.getByRole("combobox", { name: "Dia de cobro de otros cargos de T22" });
    await day.waitFor();
    assert.equal(await day.inputValue(), "monday");
    assert.equal(await day.locator("option").count(), 7);
    await day.selectOption("sunday");
    await page.reload();
    await day.waitFor();
    assert.equal(await day.inputValue(), "sunday");
    const row = page.locator("tbody tr");
    await row.getByRole("spinbutton").fill("30");
    await row.getByRole("spinbutton").press("Tab");
    assert.equal(await day.inputValue(), "sunday");
    await row.getByRole("combobox").first().selectOption("monthly");
    assert.equal(await day.count(), 0);
    await row.getByRole("combobox").first().selectOption("weekly");
    assert.equal(await day.inputValue(), "sunday");
    await row.getByRole("spinbutton").fill("25");
    await row.getByRole("spinbutton").press("Tab");
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("cobrapp.settings.other_charges_retention.v1")));
    assert.deepEqual(saved['test-t22'], { amount: 25, cycle: "weekly", weeklyChargeDay: "sunday" });
    assert.deepEqual(errors, []);
    const screenshot = path.join(root, "artifacts", "other-charges-weekly-day.png");
    fs.mkdirSync(path.dirname(screenshot), { recursive: true });
    await page.screenshot({ path: screenshot, fullPage: true });
    console.log("OK UI: domingo guardado tras recargar, editar importe y cambiar de ciclo.");
    console.log(screenshot);
  } finally {
    await browser.close();
    fs.unlinkSync(filename);
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
