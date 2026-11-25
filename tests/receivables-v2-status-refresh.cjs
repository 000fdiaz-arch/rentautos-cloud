const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const source = ts.createSourceFile('page.tsx', fs.readFileSync('src/pages/ReceivablesV2Page.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let handler;
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'handleValidateUnitStatus') handler = node;
  ts.forEachChild(node, visit);
}
visit(source);
const code = ts.transpile(handler.getText(source), { target: ts.ScriptTarget.ES2022 });
(async () => {
  for (const scenario of ['same', 'changed', 'read-error', 'mismatch', 'save-error']) {
    const status = scenario === 'changed' ? 'activo' : 'taller';
    let fleet = [{ fleet_id: 'one', unit_id: 'A11', operational_status: 'taller', catalog_photo_url: 'keep' }, { fleet_id: 'two', unit_id: 'A12', operational_status: 'activo' }];
    const before = JSON.stringify(fleet);
    const filters = [];
    let saved = false, synced = false, confirmed = false;
    const ctx = {
      isCollectionLocked: false, dataOwnerUserId: 'owner', activeCollector: 'collector-1',
      async saveOperationalReview() {
        if (scenario === 'save-error') throw Error('write failed');
        saved = true;
        return { review: { unit_id: 'A11', reviewed_at: 'now' }, archivedIds: [], updatedIds: [] };
      },
      loadControlUnits() { throw Error('Must not reload the full fleet'); },
      supabase: { from(table) {
        assert.equal(saved, true); assert.equal(table, 'vw_control_unidades');
        return { select() { return this; }, eq(k,v) { filters.push([k,v]); return this; }, async single() {
          return { data: { fleet_id: 'one', unit_id: 'A11', operational_status: scenario === 'mismatch' ? 'custodia' : status, updated_at: 'fresh' }, error: scenario === 'read-error' ? Error('read failed') : null };
        } };
      } },
      onFleetClientStatusSync() { synced = true; },
      setFleetUnits(fn) { fleet = fn(fleet); },
      setOperationalReviews(fn) { confirmed = !!fn({}).A11; },
      setOperationalReviewError() {},
    };
    vm.runInNewContext(code, ctx);
    const run = ctx.handleValidateUnitStatus({ unitId: 'A11', operationalStatus: 'taller' }, status);
    if (scenario.endsWith('error') || scenario === 'mismatch') {
      await assert.rejects(run); assert.equal(JSON.stringify(fleet), before);
      assert.equal(synced, false); assert.equal(confirmed, false);
    } else {
      await run;
      assert.deepEqual(filters, [['user_id','owner'],['unit_id','A11']]);
      assert.equal(fleet[0].operational_status, status); assert.equal(fleet[0].catalog_photo_url, 'keep');
      assert.equal(fleet[1].unit_id, 'A12'); assert.equal(fleet[1].operational_status, 'activo');
      assert.equal(synced, true); assert.equal(confirmed, true);
    }
  }
  console.log('PASS targeted status readback, unchanged/changed state, preserved fleet details, failure blocks completion. No real database writes.');
})().catch(error => { console.error(error); process.exitCode = 1; });
