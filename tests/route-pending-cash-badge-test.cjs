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
assert.equal(countActiveRouteReviewItems([item],payments,day,[]),1,'An unresolved partial payment must be counted');
assert.equal(countActiveRouteReviewItems([item],payments,day,[cash]),0,'A cash report on hold must not count as an actionable partial payment');
assert.equal(countActiveRouteReviewItems([item],payments,day,[{...cash,method:'bank'}]),0,'A bank report on hold must not count as an actionable partial payment');
assert.equal(countActiveRouteReviewItems([item],payments,day,[{...cash,method:'mixed'}]),0,'A mixed report on hold must not count as an actionable partial payment');
assert.equal(countActiveRouteReviewItems([item],payments,day,[{...cash,client_id:'c2'}]),1,'A hold report for another client must not change the partial count');
assert.equal(countActiveRouteReviewItems([],[],day,[cash]),0,'Reported cash remains on hold without affecting the badge');
for (const patch of [{status:'confirmed'},{status:'cancelled'},{method:'bank'},{method:'mixed'},{confirmed_cash_amount:20}]) {
  assert.equal(isPendingCashRouteReport({...cash,...patch}),false);
  assert.equal(countActiveRouteReviewItems([],[],day,[{...cash,...patch}]),0);
}
assert.equal(countActiveRouteReviewItems([{...item,partialDecisionRentAmount:20}],payments,day,[cash]),0);
assert.equal(countActiveRouteReviewItems([{...item,partialDecisionRentAmount:20}],payments,day,[{...cash,status:'confirmed'}]),0);
console.log('OK route badge: only unresolved partial decisions are counted; hold reports are excluded');

assert.equal(countActiveRouteReviewItems([{...item,inCustody:true}],payments,day,[]),0);
assert.equal(countActiveRouteReviewItems([{...item,inCustody:true}],payments,day,[cash]),0,'Hold reports never affect the partial-review badge');

const {getRouteWorkItems,getActiveRouteReviewItems}=rulesModule.exports;
const paid=[{clientId:'b79',dateApplied:day,appliedToRent:34,amountReceived:34.79},{clientId:'b79',dateApplied:day,appliedToRent:34,amountReceived:34.79}];
assert.equal(getRouteWorkItems([{clientId:'b79',publishedAt:'p',releaseAmount:68}],paid,day,[]).length,0);
assert.equal(getRouteWorkItems([{...item,partialDecisionRentAmount:20}],payments,day,[]).length,1);
assert.equal(getActiveRouteReviewItems([item],payments,day,[cash]).length,0,'A pending report takes precedence over a partial decision');
assert.equal(getRouteWorkItems([item],payments,day,[cash]).length,0);
assert.equal(getRouteWorkItems([{...item,inCustody:true}],[],day,[]).length,0);
const confirmedToday = {...cash,status:'confirmed',confirmed_at:'2026-09-05T15:00:00Z'};
const confirmedPreviousDay = {...confirmedToday,confirmed_at:'2026-09-04T15:00:00Z'};
assert.equal(getRouteWorkItems([item],[],day,[confirmedToday]).length,0,'A confirmation from today remains outside Work while payments synchronize');
assert.equal(getRouteWorkItems([item],[],day,[confirmedPreviousDay]).length,1,'A prior-day confirmation must not hide a unit that is still active in route');
const sameDayBeforeRoute = {clientId:'c1',dateApplied:day,appliedToRent:40,createdAt:'2026-09-05T14:00:00Z'};
const sameDayAfterRoute = {...sameDayBeforeRoute,createdAt:'2026-09-05T16:00:00Z'};
const restartedItem = {...item,routeStartedAt:'2026-09-05T15:00:00Z'};
assert.equal(getRouteWorkItems([restartedItem],[sameDayBeforeRoute],day,[]).length,1,'A payment made before restarting route must not release the new route');
assert.equal(getRouteWorkItems([restartedItem],[sameDayAfterRoute],day,[]).length,0,'A payment made after restarting route still releases the unit');
