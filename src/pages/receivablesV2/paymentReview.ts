import { getBusinessDateKey } from "../../billing";
import type { CollectionStatusRecord } from "./receivablesTypes";
import { promiseFollowup } from "./promiseFollowup";
import type { ReceivableRow } from "../../receivablesV2";
import { requiresCollectionPayment } from "./collectionAmountDue";
type ReceivedPayment = {id:string;createdAt?:string;amountReceived:number;centavosAhorro?:number};
export function alreadyManagedToday(record: CollectionStatusRecord | undefined, collector: string, now: Date) {
  const today = getBusinessDateKey(now);
  return !!record?.contactOutcomes?.some(item => item.collector === collector && item.date === today)
    || !!record?.gpsLocationReviewedAt && getBusinessDateKey(new Date(record.gpsLocationReviewedAt)) === today;
}
// A receipt is not itself a reason to ask for another collection decision.
// Future installments and the full balance of financed charges are not due today.
export function collectionPaymentReview(row: ReceivableRow, record: CollectionStatusRecord | undefined,
  collector: string, payments: ReceivedPayment[], now: Date) {
  return requiresCollectionPayment(row) ? paymentReview(record, collector, payments, now) : null;
}
// Any confirmed promise completes this client's normal turn for today, including
// renewals from follow-up (which do not carry a paymentReviewKey). Follow-up
// alerts still use the complete portfolio and check time and remaining payment.
export function hasReviewedPaymentPromise(record:CollectionStatusRecord|undefined,collector:string,date:string) {
  const latest=record?.contactOutcomes?.filter(item=>item.collector===collector && item.date<=date)
    .sort((a,b)=>a.at.localeCompare(b.at)).slice(-1)[0];
  return latest?.result==='promise' && !latest.promiseCancelledAt && (latest.date===date || (latest.promiseDate ?? '')>=date);
}
export function closedForToday(record:CollectionStatusRecord|undefined,collector:string,date:string) {
  return !!record?.contactOutcomes?.some(item=>item.collector===collector && item.date===date && item.result==='closed_today');
}
export function paymentReview(record:CollectionStatusRecord|undefined,collector:string,payments:ReceivedPayment[],now:Date) {
  const date=getBusinessDateKey(now);
  if(closedForToday(record,collector,date))return null;
  const received=[...new Map(payments.map(payment=>[payment.id,payment])).values()]
    .filter(payment=>payment.amountReceived>0 && payment.createdAt && Number.isFinite(Date.parse(payment.createdAt)) && Date.parse(payment.createdAt)<=now.getTime() && getBusinessDateKey(new Date(payment.createdAt))===date)
    .sort((a,b)=>a.id.localeCompare(b.id));
  if(!received.length)return null;
  // The snapshot changes for a new receipt or a corrected payment amount.
  const key=JSON.stringify(received.map(payment=>[payment.id,payment.amountReceived,payment.createdAt]));
  if(record?.contactOutcomes?.some(item=>item.collector===collector && item.date===date && item.paymentReviewKey===key))return null;
  const acknowledged=new Set<string>();
  for(const item of record?.contactOutcomes??[]){
    if(item.collector!==collector || item.date!==date || !item.paymentReviewKey)continue;
    try {const snapshot=JSON.parse(item.paymentReviewKey);if(Array.isArray(snapshot))for(const receipt of snapshot)acknowledged.add(JSON.stringify(receipt));}catch{/* Ignore malformed legacy snapshots. */}
  }
  const unreviewed=received.filter(payment=>!acknowledged.has(JSON.stringify([payment.id,payment.amountReceived,payment.createdAt])));
  if(!unreviewed.length)return null;
  const agreement=promiseFollowup(record,collector,payments,now);
  return {key,received:unreviewed,total:unreviewed.reduce((sum,p)=>sum+p.amountReceived,0),agreement};
}
