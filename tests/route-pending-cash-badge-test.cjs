const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const Module = require('node:module');
const compiled = ts.transpileModule(fs.readFileSync('src/routeReviewRules.ts', 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
const rulesModule = new Module('route-review-rules-test');
rulesModule._compile(compiled, 'route-review-rules-test.cjs');
const {countActiveRouteReviewItems, isPendingCashRouteReport} = rulesModule.exports;
const day = '2026-09-05';
const item = {clientId:'c1',publishedAt:'publication',releaseAmount:40};
const payments = [{clientId:'c1',dateApplied:day,appliedToRent:20}];
const cash = {client_id:'c1',published_at:'publication',status:'review',method:'cash',confirmed_cash_amount:0};
assert.equal(countActiveRouteReviewItems([item],payments,day,[cash]),1,'Do not count the same unit twice');
assert.equal(countActiveRouteReviewItems([item],payments,day,[{...cash,client_id:'c2'}]),2);
assert.equal(countActiveRouteReviewItems([],[],day,[cash]),1,'Reported cash remains pending without an active route card');
for (const patch of [{status:'confirmed'},{status:'cancelled'},{method:'bank'},{method:'mixed'},{confirmed_cash_amount:20}]) {
  assert.equal(isPendingCashRouteReport({...cash,...patch}),false);
  assert.equal(countActiveRouteReviewItems([],[],day,[{...cash,...patch}]),0);
}
assert.equal(countActiveRouteReviewItems([{...item,partialDecisionRentAmount:20}],payments,day,[cash]),1);
assert.equal(countActiveRouteReviewItems([{...item,partialDecisionRentAmount:20}],payments,day,[{...cash,status:'confirmed'}]),0);
console.log('OK cash badge: actionable reports, partial decisions, deduplication and clearing after confirmation');

assert.equal(countActiveRouteReviewItems([{...item,inCustody:true}],payments,day,[]),0);
assert.equal(countActiveRouteReviewItems([{...item,inCustody:true}],payments,day,[cash]),1,'Custody must not discard cash awaiting a receipt');

const {getRouteWorkItems,getActiveRouteReviewItems}=rulesModule.exports;
const paid=[{clientId:'b79',dateApplied:day,appliedToRent:34,amountReceived:34.79},{clientId:'b79',dateApplied:day,appliedToRent:34,amountReceived:34.79}];
assert.equal(getRouteWorkItems([{clientId:'b79',publishedAt:'p',releaseAmount:68}],paid,day,[]).length,0);
assert.equal(getRouteWorkItems([{...item,partialDecisionRentAmount:20}],payments,day,[]).length,1);
assert.equal(getActiveRouteReviewItems([item],payments,day,[cash]).length,0,'A pending report takes precedence over a partial decision');
assert.equal(getRouteWorkItems([item],payments,day,[cash]).length,0);
assert.equal(getRouteWorkItems([{...item,inCustody:true}],[],day,[]).length,0);
