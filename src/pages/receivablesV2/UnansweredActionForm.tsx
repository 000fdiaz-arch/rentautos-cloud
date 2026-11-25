import { useState } from "react";
import { useWorkdayValue } from "./workdayProgress";
import { usePromiseSchedule } from "./usePromiseSchedule";
import { DayMonthYearInput } from "./DayMonthYearInput";
import { FixedHourField } from "./FixedHourField";
import type { PaymentPromiseDraft } from "./receivablesTypes";
export function UnansweredActionForm({draftKey,today,disabled,onSave}:{draftKey:string;today:string;disabled:boolean;onSave:(result:'promise'|'no_answer',promise?:PaymentPromiseDraft)=>Promise<void>}) {
 const [result,setResult]=useWorkdayValue<''|'promise'|'no_answer'>(draftKey+':result','');
 const {date,setDate,time,setTime}=usePromiseSchedule(draftKey,today);
 const [amount,setAmount]=useWorkdayValue(draftKey+':amount','');
 const [saving,setSaving]=useState(false),[error,setError]=useState('');
 return <form className="ar-promise-followup-form" onSubmit={async event=>{
  event.preventDefault();if(!result||saving||disabled)return;
  setSaving(true);setError('');
  try{await onSave(result,result==='promise'?{date,time,amount:Number(amount)}:undefined);
   for(const field of ['result','date','time','amount'])localStorage.removeItem(draftKey+':'+field);
  }catch(cause){setError(cause instanceof Error?cause.message:'No se pudo guardar. Intenta nuevamente.');}finally{setSaving(false);}
 }}>
  <fieldset className="ar-deposit-promise-form" disabled={disabled||saving}>
   <label className="ar-deposit-promise-field ar-followup-outcome"><span>Resultado del contacto</span><select required value={result} onChange={event=>setResult(event.target.value as typeof result)}><option value="">Selecciona una respuesta</option><option value="promise">Prometió pagar</option><option value="no_answer">Sigue sin contestar, se dejó mensaje</option></select></label>
   {result==='promise' && <>
    <label className="ar-deposit-promise-field"><span>Fecha</span><DayMonthYearInput required min={today} value={date} onChange={setDate}/></label>
    <FixedHourField value={time} onChange={setTime}/>
    <label className="ar-deposit-promise-field"><span>Monto acordado</span><input type="number" required min="0.01" step="0.01" value={amount} onChange={event=>setAmount(event.target.value)}/></label>
   </>}
   <button type="submit" className="ar-deposit-promise-save" disabled={!result}>{saving?'Guardando…':'Guardar gestión'}</button>
  </fieldset>
  {error && <p role="alert">{error}</p>}
 </form>;
}
