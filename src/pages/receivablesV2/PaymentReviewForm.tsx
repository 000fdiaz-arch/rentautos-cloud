import { collectionAction } from "./collectionAction";
import { ReminderForm } from "./ReminderForm";
import { DayMonthYearInput } from "./DayMonthYearInput";
import { FixedHourField } from "./FixedHourField";
import { usePromiseSchedule } from "./usePromiseSchedule";
import { useState } from "react";
import { useWorkdayValue } from "./workdayProgress";
import { formatCurrency } from "../../format";
import type { ReceivableRow } from "../../receivablesV2";
import type { paymentReview } from "./paymentReview";
import type { PromiseFollowupInput } from "./receivablesTypes";
export type PaymentReviewFormProps={tenureDays?:number|null;draftKey:string;unit:string;name:string;row:ReceivableRow;today:string;review:NonNullable<ReturnType<typeof paymentReview>>;onSave:(result:'promise'|'closed_today'|'no_answer'|'reminder_today'|'reminder_tomorrow',input:PromiseFollowupInput)=>Promise<void>};
export function PaymentReviewForm({tenureDays,draftKey,unit,name,row,today,review,onSave}:PaymentReviewFormProps){
  const [decision,setDecision]=useWorkdayValue<''|'promise'|'closed_today'|'no_answer'>(draftKey+':decision','');
  const {date,setDate,time,setTime}=usePromiseSchedule(draftKey,today);
  const [amount,setAmount]=useWorkdayValue(draftKey+':amount',review.agreement ? String(review.agreement.remaining) : "");
  const [saving,setSaving]=useState(false);const [error,setError]=useState('');
  const action = collectionAction(row, today, tenureDays);
  const reminder = (action === 'reminder_today' || action === 'reminder_tomorrow')
    && !(review.agreement && review.agreement.remaining > 0 && !review.agreement.overdue);
  return <section className="ar-followup-summary" style={{width:'100%',boxSizing:'border-box',maxWidth:900,alignSelf:'center'}}>
    <h3>Pago recibido · {unit}</h3><p>{name}</p>
    <div className="cxc-summary-totals cxc-payment-review-totals"><div><span>Pagos nuevos por revisar</span><strong>{formatCurrency(review.total)}</strong><small>{review.received.length} recibo(s)</small></div><div><span>Falta de la promesa</span><strong>{review.agreement?formatCurrency(review.agreement.remaining):'Sin promesa'}</strong><small>{review.agreement?`Prometió ${formatCurrency(review.agreement.promise.promiseAmount!)} · abonó ${formatCurrency(review.agreement.paid)}`:'No hay una promesa anterior registrada.'}</small></div></div>
    <div className="cxc-payment-balances" aria-label="Saldos por concepto">
      {[
        ["Renta corriente", Math.max(0,row.totalPending-row.overdueBalance), "balance"],
        ["Renta vencida", row.overdueBalance, "rent"],
        ["Renta total", Math.max(0,row.totalPending-row.overdueBalance)+row.overdueBalance, "total"],
        ["Multas", row.outstandingFineAmount ?? 0, "fine"],
        ["Recargos", row.outstandingLateFeeAmount ?? 0, "late-fee"],
        ["Boletas", row.outstandingTicketAmount ?? 0, "ticket"],
        ["Otros cargos", row.outstandingOtherChargeAmount ?? 0, "other-charge"]
      ].map(([label,value,tone])=><div key={label} className={`ar-essential-value ar-essential-value--${tone} ${Number(value)>0?'has-balance':''}`}>
        <span>{label}</span><strong>{formatCurrency(Number(value))}</strong>
      </div>)}
    </div>
    {action === 'call' && <strong className="cxc-call-required">Llamar al cliente · Renta vencida</strong>}
    {reminder && <>
      <ReminderForm tomorrow={action === 'reminder_tomorrow'} disabled={saving} confirmed={false}
        onSave={async () => {
          await onSave(action as 'reminder_today'|'reminder_tomorrow', {promiseAt:review.agreement?.promise.at??'',paymentReviewKey:review.key});
          for(const field of ['decision','date','time','amount'])localStorage.removeItem(draftKey+':'+field);
        }} />
    </>}
    {!reminder && <form className="ar-promise-followup-form" onSubmit={async event=>{event.preventDefault();if(!decision||saving)return;setSaving(true);setError('');try{
      await onSave(decision,{promiseAt:review.agreement?.promise.at??'',paymentReviewKey:review.key,...(decision==='promise'?{nextDate:date,nextTime:time,amount:Number(amount)}:{})});
      for(const field of ['decision','date','time','amount'])localStorage.removeItem(draftKey+':'+field);
    }catch(e){setError(e instanceof Error?e.message:'No se pudo confirmar el guardado.');}finally{setSaving(false);}}}>
      <fieldset className="ar-deposit-promise-form" disabled={saving}>
        <label className="ar-deposit-promise-field ar-followup-outcome"><span>¿Cómo continúa la gestión?</span><select required value={decision} onChange={e=>setDecision(e.target.value as typeof decision)}><option value="">Selecciona una decisión</option><option value="closed_today">Cerrar gestión por hoy</option><option value="promise">Continuar con una nueva promesa</option><option value="no_answer">No contestó, se dejó mensaje</option></select></label>
        {decision==='closed_today' && <p>No volverá a aparecer en las vueltas ni alertas de hoy. Mañana vuelve a su cartera; el saldo se conserva.</p>}
        {decision==='no_answer' && <p>El pago queda revisado. El cliente volverá a aparecer en la segunda vuelta.</p>}
        {decision==='promise' && <><label className="ar-deposit-promise-field"><span>Fecha del pago</span><DayMonthYearInput required min={today} value={date} onChange={setDate}/></label><FixedHourField value={time} onChange={setTime}/>{decision==='promise' && <label className="ar-deposit-promise-field"><span>Monto acordado (editable)</span><input type="number" min="0.01" step="0.01" required value={amount} onChange={e=>setAmount(e.target.value)}/></label>}</>}
        <button className="ar-deposit-promise-save" disabled={!decision} type="submit">{saving?'Guardando en la base de datos…':'Guardar decisión y continuar'}</button>
      </fieldset>
      {error && <p role="alert">{error}</p>}
    </form>}
  </section>;
}
