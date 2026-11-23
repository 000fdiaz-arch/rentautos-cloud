import assert from 'node:assert/strict';
import { build } from 'esbuild';

async function bundled(entry) {
  const result = await build({ entryPoints: [entry], bundle: true, write: false, platform: 'node', format: 'esm',
    define: { 'import.meta.env': JSON.stringify({ VITE_RENTAUTOS_TEST_LEGACY_LOCAL_STORAGE: '1' }) } });
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
}
const { buildManualPaymentTransaction } = await bundled('src/pages/payments/manualPaymentWorkflow.ts');
const { buildRouteManagedActions } = await bundled('src/routeDeltaTracking.ts');
const { buildPendingCashRowsByTeam } = await bundled('src/pages/payments/dailyIncomeRules.ts');
const storage = await bundled('src/storage/coreStorage.ts');
const client = { id: 'outside', unitId: 'X01', name: 'Cliente fuera', status: 'activo', rentAmount: 30,
  frequency: 'daily', balance: 120, advanceBalance: 0, savings: 0, otherCharges: [],
  installmentsAgreed: 100, installmentsRemaining: 96, installmentsPaid: 4, createdAt: '2026-11-01T12:00:00Z' };
const transaction = buildManualPaymentTransaction({ clients: [client], payments: [], selectedClient: client,
  form: { clientId: client.id, dateApplied: '2026-11-23', paymentMethod: 'Efectivo', cashDeliveryStatus: 'pending',
    collectionTeam: 'WC', collectionDelta: 'delta2', reference: '', amountReceived: '40' },
  manualOtherChargesInput: {}, retentionByClient: {}, operationalDateKey: '2026-11-23',
  overrideForcedOtherCharges: false, receiptNumber: 'R-0001', currentActor: 'delta2@auth.rentautos.local' });
const payment = { ...transaction.payment, source: 'route', createdAt: '2026-11-23T15:00:00Z', outsideRouteCollection: {
  version: 'legacy', delta: 'delta2', team: 'WC', collectedBy: 'delta2-id', collectedAt: '2026-11-23T15:00:00Z' } };
assert.equal(transaction.updatedClients[0].balance, 80);
assert.equal(transaction.updatedClients[0].status, 'activo');
assert.equal(payment.moneyDelivered, false);
assert.equal(payment.collectionDelta, 'delta2');
assert.equal(buildPendingCashRowsByTeam([payment], '2026-11-23').WC[0].id, payment.id);
const local = new Map();
globalThis.localStorage = { getItem: key => local.get(key) ?? null, setItem: (key, value) => local.set(key, value) };
storage.savePayments([payment]);
const reloaded = storage.loadPayments();
assert.deepEqual(reloaded[0].outsideRouteCollection, payment.outsideRouteCollection, 'Reload must retain collection audit');
assert.equal(reloaded[0].source, 'route');
const base = { items: [], reports: [], captures: [], runs: [], businessDateKey: '2026-11-23' };
let actions = buildRouteManagedActions({ ...base, payments: reloaded });
assert.equal(actions.length, 1);
assert.equal(actions[0].outsideRoute, true);
assert.equal(actions[0].delta, 'delta2');
assert.equal(actions[0].cashAmount, 40);
assert.equal(actions[0].payment.receiptNumber, 'R-0001');
const followup = { ...payment, id: 'followup', amountReceived: 10 };
actions = buildRouteManagedActions({ ...base, payments: [payment, followup] });
assert.equal(actions.length, 1, 'Same team and car consolidate');
assert.equal(actions[0].cashAmount, 50);
assert.equal(actions[0].actionCount, 2);
const otherTeam = { ...followup, id: 'other', outsideRouteCollection: { ...payment.outsideRouteCollection, delta: 'delta1', team: 'PTY' } };
assert.equal(buildRouteManagedActions({ ...base, payments: [payment, otherTeam] }).length, 2, 'Preserve both team attributions');
assert.equal(buildRouteManagedActions({ ...base, payments: [payment], managementVersion: 'v2' }).length, 0, 'Keep V2 isolated');
assert.equal(buildRouteManagedActions({ ...base, payments: [{ ...payment, outsideRouteCollection: { ...payment.outsideRouteCollection, version: 'v2' } }], managementVersion: 'v2' }).length, 1);
assert.equal(buildRouteManagedActions({ ...base, businessDateKey: '2026-11-24', payments: [payment] }).length, 0);
assert.equal(buildRouteManagedActions({ ...base, payments: [{ ...payment, outsideRouteCollection: { ...payment.outsideRouteCollection, collectedAt: '2026-11-24T04:59:00Z' } }] }).length, 1, 'Use Panama date');
assert.equal(buildRouteManagedActions({ ...base, payments: [] }).length, 0, 'Deleted payments disappear');
assert.equal(buildRouteManagedActions({ ...base, payments: [{ ...payment, routeReportId: 'linked' }] }).length, 0, 'Do not double count linked receipts');
console.log('outside-route-cash: allocation, cash custody, audit reload, team attribution, consolidation, deletion and V2 isolation OK');
