import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.ROUTE_TEST_BASE ?? 'http://127.0.0.1:5174';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  const titles = { cash: 'Declarar efectivo', bank: 'Declarar transferencia', mixed: 'Declarar pago mixto (Efectivo+transferencia)' };
  async function start(version, method) {
    await page.goto(`${base}/tests/fixtures/outside-route-cash.html?operator=delta1${version}`);
    await page.evaluate(() => sessionStorage.clear());
    await page.reload();
    await page.getByRole('button', { name: 'Trabajo (1)', exact: true }).waitFor();
    assert.equal(await page.locator('.route-collection-card').getByRole('button', { name: 'Notificar pago', exact: true }).count(), 0);
    await page.getByRole('button', { name: `${titles[method]} · ${method === 'cash' ? 'EN RUTA Y FUERA DE RUTA' : 'SOLO UNIDADES EN RUTA'}`, exact: true }).click();
    return page.getByRole('dialog', { name: titles[method], exact: true });
  }
  async function choose(dialog, unit = 'A10') {
    await dialog.getByLabel('Buscar unidad o cliente').fill(unit);
    await dialog.getByRole('button', { name: new RegExp(unit) }).click();
    await dialog.getByRole('button', { name: 'Confirmar declaración', exact: true }).waitFor();
  }
  for (const version of ['', '&legacy', '&version=v2']) {
    for (const method of ['bank', 'mixed', 'cash']) {
      const dialog = await start(version, method);
      if (method !== 'cash') {
        await dialog.getByText('SOLO UNIDADES EN RUTA', { exact: true }).waitFor();
        for (const unit of ['X01', 'B20']) {
          await dialog.getByLabel('Buscar unidad o cliente').fill(unit);
          await dialog.getByText('No hay unidades en ruta con esa búsqueda.', { exact: true }).waitFor();
          assert.equal(await dialog.getByRole('button', { name: new RegExp(unit) }).count(), 0);
        }
      }
      await choose(dialog);
      await dialog.getByText('SOLO UNIDADES EN RUTA', { exact: true }).waitFor();
      assert.equal(await dialog.getByLabel('Cómo pagó').count(), 0);
      assert.equal(await dialog.getByLabel('Equipo que recibió el efectivo').count(), 0);
      if (method === 'mixed') {
        await dialog.getByLabel('Cuánto en efectivo ($)').fill('12.75');
        await dialog.getByLabel('Cuánto por transferencia ($)').fill('0');
        await dialog.evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
        await dialog.getByRole('alert').waitFor();
        assert.equal(await page.evaluate(() => window.__declarationRequests.length), 0);
        await dialog.getByLabel('Cuánto por transferencia ($)').fill('14.25');
        await dialog.getByText('Total reportado: $27.00', { exact: true }).waitFor();
      } else await dialog.getByLabel('Cuánto pagó ($)').fill(method === 'cash' ? '11.50' : '17.25');
      await page.evaluate(() => { window.__failDeclaration = true; });
      await dialog.getByRole('button', { name: 'Confirmar declaración', exact: true }).click();
      await dialog.getByRole('alert').filter({ hasText: 'No se pudo declarar' }).waitFor();
      assert.equal(await page.evaluate(() => window.__declarationReports.length), 0);
      assert.equal(await page.evaluate(() => window.__outsideCalls ?? 0), 0);
      await page.evaluate(() => { window.__failDeclaration = false; });
      await dialog.evaluate(form => {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });
      await dialog.waitFor({ state: 'hidden' });
      const result = await page.evaluate(() => ({ reports: window.__declarationReports, requests: window.__declarationRequests, cash: window.__outsideInput, cashCalls: window.__outsideCalls ?? 0 }));
      assert.equal(result.requests.length, 2, 'One failed request and one successful request; no duplicate submission.');
      assert.equal(result.reports.length, 1);
      assert.equal(result.reports[0].method, method);
      assert.equal(result.reports[0].cash_amount, method === 'bank' ? 0 : method === 'mixed' ? 12.75 : 11.5);
      assert.equal(result.reports[0].bank_amount, method === 'cash' ? 0 : method === 'mixed' ? 14.25 : 17.25);
      assert.equal(result.reports[0].confirmed_bank_amount, 0, 'Bank funds require confirmation.');
      assert.equal(result.cashCalls, method === 'bank' ? 0 : 1);
      if (method !== 'bank') {
        assert.equal(result.cash.delta, 'delta1');
        assert.equal(result.cash.reportId, result.reports[0].id);
        assert.equal(result.cash.outsideRoute, undefined);
      }
      if (method === 'mixed') {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.locator('.route-pending-cash-disclosure > summary').click();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        const panel = await page.getByRole('region', { name: 'Efectivo pendiente de entrega', exact: true }).boundingBox();
        const mixed = await page.locator('.route-payment-declaration-button--mixed').boundingBox();
        assert.ok(panel.y >= mixed.y + mixed.height, 'The cash breakdown must appear below the declaration buttons.');
        await page.setViewportSize({ width: 1280, height: 900 });
      }
    }
    // A unit can leave the route or change responsibility after the picker closes.
    for (const change of ['removed', 'reassigned']) {
      const dialog = await start(version, 'bank');
      await choose(dialog);
      await dialog.getByLabel('Cuánto pagó ($)').fill('10');
      await page.evaluate(change => {
        const item = window.__outsideRouteRows.find(row => row.client_id === 'active').data;
        if (change === 'removed') item.removedAt = new Date().toISOString();
        else item.assignedDelta = 'delta3';
      }, change);
      await dialog.getByRole('button', { name: 'Confirmar declaración', exact: true }).click();
      await dialog.getByRole('alert').waitFor();
      assert.equal(await page.evaluate(() => window.__declarationRequests.length), 0);
    }
  }
  assert.deepEqual(errors, []);
  console.log('Payment declarations: all three route pages, fixed methods, route-only search, scope, stale route checks, validation, retry, duplicate protection, mixed split, cash receipts and mobile layout OK');
} finally { await browser.close(); }
