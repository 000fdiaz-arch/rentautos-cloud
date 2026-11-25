import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
const base = process.env.ROUTE_TEST_BASE ?? 'http://127.0.0.1:5174';
const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  const fixture = base + '/tests/fixtures/outside-route-cash.html';
  const dialog = page.getByRole('dialog', { name: 'Declarar efectivo', exact: true });
  async function open(unit) {
    await page.getByRole('button', { name: 'Declarar efectivo · EN RUTA Y FUERA DE RUTA', exact: true }).click();
    await dialog.getByLabel('Buscar unidad o cliente').fill(unit);
    await dialog.getByRole('button', { name: new RegExp(unit) }).click();
  }
  for (const mode of ['', '&legacy', '&version=v2']) {
    await page.goto(fixture + '?operator=delta1' + mode);
    await page.evaluate(() => sessionStorage.clear());
    await page.reload();
    await page.getByRole('button', { name: 'Trabajo (1)', exact: true }).waitFor();
    await open('X01');
    assert.equal(await dialog.getByLabel('Delta que recibió el efectivo').count(), 0);
    await dialog.getByLabel('Efectivo recibido ($)').fill('40');
    await page.evaluate(() => { window.__failOutside = true; });
    await dialog.getByRole('button', { name: 'Confirmar y generar recibo' }).click();
    await dialog.getByRole('alert').filter({ hasText: 'No se pudo guardar' }).waitFor();
    assert.equal(await dialog.getByLabel('Efectivo recibido ($)').inputValue(), '40');
    await page.evaluate(() => { window.__failOutside = false; window.__outsideCalls = 0; });
    // Two submit events in the same task exercise the synchronous ref lock.
    await dialog.evaluate(form => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    await page.getByRole('button', { name: 'Cerrar vista previa' }).click();
    assert.equal(await page.evaluate(() => window.__outsideCalls), 1);
    assert.deepEqual(await page.evaluate(() => window.__outsideInput), { clientId: 'outside', amount: 40, method: 'cash', team: 'PTY', delta: 'delta1', outsideRoute: true });
    await page.getByRole('button', { name: 'Gestionados hoy (1)', exact: true }).waitFor();
    const row = page.locator('.route-managed-compact-row');
    assert.match(await row.innerText(), /X01/);
    assert.match(await row.innerText(), /Fuera de ruta/);
    assert.match(await row.innerText(), /\$40\.00/);
    await row.locator('summary').click();
    await page.getByRole('button', { name: 'Ver recibo', exact: true }).click();
    await page.getByRole('button', { name: 'Cerrar vista previa' }).click();
    await page.locator('.route-pending-cash-disclosure > summary').click();
    await page.getByRole('region', { name: 'Efectivo pendiente de entrega', exact: true }).getByRole('listitem').filter({ hasText: 'X01' }).waitFor();
    await page.reload();
    await page.getByRole('button', { name: 'Gestionados hoy (1)', exact: true }).click();
    assert.match(await page.locator('.route-managed-compact-row').innerText(), /Fuera de ruta/);
    await page.getByRole('button', { name: 'Trabajo (1)', exact: true }).click();
    await open('A10');
    await dialog.getByLabel('Cuánto pagó ($)').waitFor();
    await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
    // A unit published after selection must open its route instead of charging outside.
    await open('X02');

    await dialog.getByLabel('Efectivo recibido ($)').fill('10');
    await page.evaluate(() => {
      window.__outsideRouteRows.push({ client_id: 'outside2', data: { ...window.__outsideRouteRows[0].data, clientId: 'outside2', unitId: 'X02', clientName: 'María Castillo' } });
      window.__outsideCalls = 0;
    });
    await dialog.getByRole('button', { name: 'Confirmar y generar recibo' }).click();
    await dialog.getByLabel('Cuánto pagó ($)').waitFor();
    assert.equal(await page.evaluate(() => window.__outsideCalls), 0);
    await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  }
  await page.goto(fixture + '?operator=delta1');
  await page.evaluate(() => sessionStorage.clear()); await page.reload();
  await open('B20');
  await dialog.getByRole('alert').filter({ hasText: 'otro Delta' }).waitFor();
  await dialog.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await open('X01');
  assert.equal(await dialog.getByLabel('Delta que recibió el efectivo').count(), 0);
  await page.setViewportSize({ width: 390, height: 844 });
  mkdirSync('.tmp/outside-route-cash', { recursive: true });
  await page.screenshot({ path: '.tmp/outside-route-cash/mobile-form.png', fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await dialog.getByLabel('Efectivo recibido ($)').fill('0');
  await dialog.getByRole('button', { name: 'Confirmar y generar recibo' }).click();
  assert.equal(await page.evaluate(() => window.__outsideCalls ?? 0), 0);
  await dialog.getByLabel('Efectivo recibido ($)').fill('12');
  await dialog.getByRole('button', { name: 'Confirmar y generar recibo' }).click();
  await page.getByRole('button', { name: 'Cerrar vista previa' }).click();
  assert.deepEqual(await page.evaluate(() => window.__outsideInput), { clientId: 'outside', amount: 12, method: 'cash', team: 'PTY', delta: 'delta1', outsideRoute: true });
  await page.getByRole('button', { name: 'Declarar efectivo · EN RUTA Y FUERA DE RUTA', exact: true }).click();
  await dialog.getByLabel('Buscar unidad o cliente').fill('Z99');
  await dialog.getByText('No hay clientes activos con esa búsqueda.').waitFor();
  await page.goto(fixture + '?readonly');
  await page.getByRole('button', { name: /Trabajo/ }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Declarar efectivo · EN RUTA Y FUERA DE RUTA', exact: true }).count(), 0);
  assert.deepEqual(errors, []);
  console.log('outside-route-cash UI: all three pages, receipt, reload, cash custody, failure, double submit, publication race, Delta permissions and mobile OK');
} finally { await browser.close(); }
