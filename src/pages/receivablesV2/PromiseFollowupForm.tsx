import { DayMonthYearInput } from "./DayMonthYearInput";
import { FixedHourField } from "./FixedHourField";
import { usePromiseSchedule } from "./usePromiseSchedule";
import { useWorkdayValue } from "./workdayProgress";
import { useState } from "react";
import { formatCurrency } from "../../format";
import type { ContactOutcomeResult, PromiseFollowupInput } from "./receivablesTypes";
import type { promiseFollowup } from "./promiseFollowup";

type Props = { draftKey?: string; followup: NonNullable<ReturnType<typeof promiseFollowup>>; today: string; onSave: (result: ContactOutcomeResult, input: PromiseFollowupInput) => Promise<void> };
export function PromiseFollowupForm({ draftKey = "cxc.v2.preview.followup", followup, today, onSave }: Props) {
  const [result, setResult] = useWorkdayValue<ContactOutcomeResult>(draftKey + ":result", "promise");
  const {date,setDate,time,setTime}=usePromiseSchedule(draftKey,today);
  const [amount, setAmount] = useWorkdayValue(draftKey + ":amount", String(followup.remaining));
  const [note, setNote] = useWorkdayValue(draftKey + ":note", "");
  const [route, setRoute] = useWorkdayValue(draftKey + ":route", false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const agreedHour = Number(followup.promise.promiseTime!.slice(0, 2));
  const agreedTime = `${agreedHour % 12 || 12}:${followup.promise.promiseTime!.slice(3, 5)} ${agreedHour >= 12 ? "PM" : "AM"}`;
  return <form className="ar-promise-followup-form" data-outcome={result} onSubmit={async event => {
    event.preventDefault(); if (saving) return;
    setSaving(true); setError("");
    try { await onSave(result, { promiseAt: followup.promise.at, nextDate: date, nextTime: time, amount: Number(amount), note: note.trim(), sendToRoute: result === "escalated" && route });
      for (const field of ["result", "date", "time", "amount", "note", "route"]) localStorage.removeItem(draftKey + ":" + field);
    }
    catch (e) { setError(e instanceof Error ? e.message : "No se pudo guardar. Intenta nuevamente."); }
    finally { setSaving(false); }
  }}>
    <div className="ar-followup-agreement">
      <div className="cxc-promise-highlight">
        <span>PROMETIÓ</span>
        <strong>{formatCurrency(followup.promise.promiseAmount!)}</strong>
        <b>{followup.promise.promiseDate!.split("-").reverse().join("/")} · {agreedTime}</b>
      </div>
      <div className="cxc-promise-progress"><span className="cxc-promise-paid">Pagó <b>{formatCurrency(followup.paid)}</b></span><span className="cxc-promise-remaining">Falta <b>{formatCurrency(followup.remaining)}</b></span></div>
    </div>
    <fieldset className="ar-deposit-promise-form" disabled={saving}>
      <label className="ar-deposit-promise-field ar-followup-outcome"><span>¿Cómo continúa el seguimiento?</span><select value={result} onChange={e => setResult(e.target.value as ContactOutcomeResult)}>
        <option value="promise">Nueva promesa</option>
        <option value="no_answer">No contestó, se dejó mensaje</option>
        <option value="reported_paid">Indica que ya pagó — verificar</option>
        <option value="escalated">No pagará / seguimiento en calle</option>
      </select></label>
      {result === "reported_paid" && <p>Queda pendiente de verificación. Solo los pagos registrados completan la promesa.</p>}
      {result !== "escalated" && result !== "no_answer" && <><label className="ar-deposit-promise-field"><span>{result === "promise" ? "Fecha del nuevo pago" : "Volver a contactar / verificar el"}</span><DayMonthYearInput required min={today} value={date} onChange={setDate}/></label>
      <FixedHourField value={time} onChange={setTime}/></>}
      {result === "promise" && <label className="ar-deposit-promise-field"><span>Monto acordado</span><input required type="number" min="0.01" step="0.01" value={amount} onChange={e => setAmount(e.target.value)}/></label>}
      {result === "escalated" && <label className="ar-deposit-promise-field ar-followup-note"><span>Motivo (obligatorio)</span><textarea required value={note} onChange={e => setNote(e.target.value)}/></label>}
      {result === "escalated" && <label className="ar-followup-route"><input type="checkbox" checked={route} onChange={e => setRoute(e.target.checked)}/>Enviar a ruta</label>}
      <button type="submit" className="ar-deposit-promise-save">{saving ? "Guardando en la base de datos…" : "Guardar seguimiento y continuar"}</button>
    </fieldset>
    {error && <p role="alert">{error}</p>}
  </form>;
}
