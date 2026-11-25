import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getBusinessDateKey } from "../../billing";
import type { ReceivableRow } from "../../receivablesV2";
import type { CollectionStatusRecord } from "./receivablesTypes";
import type { OperationalReview } from "./operationalReview";
import "./firstContactSummary.css";

export const FIRST_CONTACT_LABELS = {
  promise: "Promesa", no_answer: "Sin respuesta", reminder_today: "Recordatorio de hoy",
  reminder_tomorrow: "Recordatorio de mañana", paid_up: "Al día",
  closed_today: "Cerrado por hoy", reported_paid: "Pago reportado", escalated: "Seguimiento",
  validation: "Estado revisado", gps: "GPS revisado", pending: "Sin primer contacto"
};
type Category = keyof typeof FIRST_CONTACT_LABELS;
type Entry = { row: ReceivableRow; category: Category; at?: string; note?: string; amount?: number; date?: string; time?: string };
type Props = { rows: ReceivableRow[]; records: Record<string,CollectionStatusRecord>; collector: string; today: string; reviews: Record<string,OperationalReview> };
const onDay=(at:string|undefined,today:string)=>!!at && Number.isFinite(Date.parse(at)) && getBusinessDateKey(new Date(at))===today;
export function firstContactSummary({rows,records,collector,today,reviews}:Props) {
  const entries:Entry[]=rows.map(row=>{
    const record=records[row.id];
    const attempts=record?.contactOutcomes?.filter(x=>x.collector===collector && x.date===today)
      .slice().sort((a,b)=>a.at.localeCompare(b.at)) ?? [];
    const first=attempts[0];
    const review=reviews[row.unitId.toUpperCase()];
    const candidates:Entry[]=[];
    if(first) candidates.push({row,category:first.result,at:first.at,note:first.note,amount:first.promiseAmount,date:first.promiseDate,time:first.promiseTime});
    if(review?.collector===collector && onDay(review.reviewed_at,today)) candidates.push({row,category:'validation',at:review.reviewed_at});
    if(onDay(record?.gpsLocationReviewedAt,today)) candidates.push({row,category:'gps',at:record!.gpsLocationReviewedAt});
    return candidates.sort((a,b)=>Date.parse(a.at!)-Date.parse(b.at!))[0] ?? {row,category:'pending'};
  }).sort((a,b)=>a.row.unitId.localeCompare(b.row.unitId,undefined,{numeric:true}));
  // Route dispatch is independent: a unit can have a first contact AND be sent to route.
  const route=entries.filter(({row})=>onDay(records[row.id]?.routeTaggedAt,today));
  return {entries,route};
}
export function FirstContactSummary(props:Props) {
  const [selected,setSelected]=useState<Category|'route'|null>(null);
  const dialog=useRef<HTMLDialogElement>(null);
  const {entries,route}=firstContactSummary(props);
  const pending=entries.filter(x=>x.category==='pending').length;
  const list=selected==='route'?route:entries.filter(x=>x.category===selected);
  useEffect(()=>{if(selected)dialog.current?.showModal();},[selected]);
  const label=selected==='route'?'Enviadas a ruta':selected?FIRST_CONTACT_LABELS[selected]:'';
  return <section className="cxc-first-summary" aria-label="Resumen del primer contacto">
    <details>
    <summary className="cxc-first-summary-heading"><strong>Primer contacto</strong><span>{entries.length-pending}/{entries.length} gestionadas · {pending ? `${pending} pendientes` : 'Completado'}</span><span className="cxc-first-summary-toggle"><span className="cxc-first-summary-open">Ver resumen</span><span className="cxc-first-summary-close">Ocultar</span><span aria-hidden="true">⌄</span></span></summary>
    <div className="cxc-first-summary-counts">
      {(Object.keys(FIRST_CONTACT_LABELS) as Category[]).map(key=>{
        const count=entries.filter(x=>x.category===key).length;
        if(!count) return null;
        return <button type="button" key={key} onClick={()=>setSelected(key)} aria-haspopup="dialog"><span>{FIRST_CONTACT_LABELS[key]}</span><strong>{count}</strong></button>;
      })}
      {route.length>0 && <button type="button" className="cxc-first-summary-route" onClick={()=>setSelected('route')} aria-haspopup="dialog"><span>En ruta</span><strong>{route.length}</strong></button>}
    </div>
    </details>
    {selected && createPortal(<dialog ref={dialog} className="cxc-promises-dialog" onClose={()=>setSelected(null)} onCancel={()=>setSelected(null)}>
      <header><h2>{label} · {list.length}</h2><button type="button" className="button ghost" onClick={()=>dialog.current?.close()}>Cerrar ×</button></header>
      <p>{selected==='route'?'Envíos de hoy. Pueden coincidir con un resultado de primer contacto.':'Primer resultado registrado hoy; los contactos posteriores no lo reemplazan.'}</p>
      {!list.length && <p>No hay unidades en esta opción.</p>}
      <ul className="cxc-first-summary-units">{list.map(entry=><li key={entry.row.id}><strong>{entry.row.unitId} · {entry.row.name}</strong>
        {entry.at && <span>{new Date(entry.at).toLocaleTimeString('es-PA',{timeZone:'America/Panama',hour:'numeric',minute:'2-digit',hour12:true})}</span>}
        {entry.category==='promise' && <span>Prometió ${entry.amount?.toFixed(2)} · {entry.date?.split('-').reverse().join('/')} · {entry.time && `${Number(entry.time.slice(0,2))%12||12}:${entry.time.slice(3)} ${Number(entry.time.slice(0,2))>=12?'PM':'AM'}`}</span>}
        {entry.note && <small>{entry.note}</small>}
      </li>)}</ul>
    </dialog>,document.body)}
  </section>;
}
