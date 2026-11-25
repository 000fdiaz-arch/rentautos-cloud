import { useState } from "react";
import { DayMonthYearInput } from "./DayMonthYearInput";
import { FixedHourField } from "./FixedHourField";
import { useWorkdayValue } from "./workdayProgress";
import type { PendingPromise } from "./PendingPromises";
import type { PromiseFollowupInput } from "./receivablesTypes";
export function EditPendingPromise({item,today,draftKey,onSave}:{item:PendingPromise;today:string;draftKey:string;onSave:(input:PromiseFollowupInput)=>Promise<void>}) {
 const promise=item.followup.promise;
 const [date,setDate]=useWorkdayValue(draftKey+':date',promise.promiseDate!);
 const [time,setTime]=useWorkdayValue(draftKey+':time',promise.promiseTime!);
 const [amount,setAmount]=useWorkdayValue(draftKey+':amount',String(promise.promiseAmount!));
 const [saving,setSaving]=useState(false),[error,setError]=useState('');
 return <form className="ar-promise-followup-form" onSubmit={async event=>{event.preventDefault();if(saving)return;setSaving(true);setError('');try{await onSave({editPromise:true,promiseAt:promise.at,nextDate:date,nextTime:time,amount:Number(amount),note:'Promesa editada: se conserva el acuerdo anterior y los abonos.'});for(const field of ['date','time','amount'])localStorage.removeItem(draftKey+':'+field);}catch(cause){setError(cause instanceof Error?cause.message:'No se pudo guardar.');}finally{setSaving(false);}}}>
  <h3>Editar promesa</h3>
  <fieldset className="ar-deposit-promise-form" disabled={saving}>
   <label className="ar-deposit-promise-field"><span>Fecha</span><DayMonthYearInput required value={date} min={today} onChange={setDate}/></label>
   <FixedHourField value={time} onChange={setTime}/>
   <label className="ar-deposit-promise-field"><span>Monto total acordado</span><input required type="number" min="0.01" step="0.01" value={amount} onChange={event=>setAmount(event.target.value)}/></label>
   <button className="ar-deposit-promise-save" type="submit">{saving?'Guardando…':'Guardar cambios'}</button>
  </fieldset>
  {error && <p role="alert">{error}</p>}
 </form>;
}
