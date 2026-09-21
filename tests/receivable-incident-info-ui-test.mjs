import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const base = 'http://127.0.0.1:4199';
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4199', '--strictPort'], {
  windowsHide: true, stdio: 'pipe', env: { ...process.env, VITE_SUPABASE_URL: 'https://tests.invalid', VITE_SUPABASE_ANON_KEY: 'synthetic' }
});
let browser, page, cases = 0;
const errors = [];
const check = name => { cases++; console.log('OK', name); };
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Vite startup timeout')), 15000);
    server.stdout.on('data', data => { if (data.toString().includes('4199')) { clearTimeout(timer); resolve(); } });
    server.on('error', reject);
  });
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(8000);
  page.setDefaultNavigationTimeout(30000);
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== base) return route.abort();
    if (url.pathname === '/incident-test') return route.fulfill({ contentType: 'text/html', body: `<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div><script type="module">
      import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
      </script><script type="module" src="/tests/fixtures/receivable-incident-info.tsx"></script>` });
    return route.continue();
  });
  const state = async () => JSON.parse(await page.locator('#test-status').textContent());
  await page.goto(base + '/incident-test');
  const notice = page.locator('.ar-insurance-action');
  assert.match(await notice.innerText(), /Agregar número de reclamo/);
  assert.match(await notice.innerText(), /2026-09-01/);
  assert.match(await notice.innerText(), /Puedes continuar con la gestión de cobro/);
  assert.equal(await notice.getAttribute('role'), 'alert');
  const management = page.getByRole('combobox', { name: 'Gestión de T99' });
  assert.equal(await management.isEnabled(), true);
  await management.selectOption('contacted');
  assert.equal((await state()).status, 'contacted');
  await page.getByPlaceholder('Escribe una nota...').fill('Cobro coordinado');
  assert.equal((await state()).supportNote, 'Cobro coordinado');
  check('siniestro urgente conserva información y fecha mientras permite clasificar y escribir notas');
  await page.getByRole('button', { name: 'Abrir expediente', exact: true }).click();
  assert.ok(page.url().endsWith('/control-de-siniestros?insuranceClaim=case-test'));
  await page.getByRole('button', { name: 'Alternar expediente' }).click();
  assert.match(await notice.innerText(), /Asignar fecha de juicio/);
  await page.getByRole('button', { name: 'Abrir expediente', exact: true }).click();
  assert.ok(page.url().endsWith('/control-de-siniestros?judicialCase=case-test'));
  check('enlaces a seguro y expediente judicial siguen disponibles y abren el registro correcto');
  await page.getByRole('button', { name: 'Alternar cierre' }).click();
  assert.equal(await management.isDisabled(), true);
  assert.equal(await page.getByPlaceholder('Escribe una nota...').isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: 'Enviar a ruta', exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: 'Abrir expediente', exact: true }).isEnabled(), true);
  await page.getByRole('button', { name: 'Alternar cierre' }).click();
  await page.getByRole('button', { name: 'Alternar urgencia' }).click();
  assert.equal(await notice.getAttribute('role'), 'status');
  assert.equal(await management.isEnabled(), true);
  check('cierre de cobranza conserva sus restricciones; aviso no urgente sigue siendo informativo');
  mkdirSync('.tmp/incident-info', { recursive: true });
  await page.screenshot({ path: '.tmp/incident-info/desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await notice.isVisible(), true);
  assert.equal(await management.isEnabled(), true);
  await page.screenshot({ path: '.tmp/incident-info/mobile.png', fullPage: true });
  assert.deepEqual(errors, []);
  check('aviso y gestión disponibles en móvil, sin errores del navegador');
  console.log(`PASS ${cases} escenarios con datos sintéticos; sin acceso a producción.`);
} catch (error) {
  console.error("Browser errors:", errors);
  console.error((await page?.locator('body').innerText().catch(() => ""))?.slice(0, 3500));
  throw error;
} finally { await browser?.close(); server.kill(); }
