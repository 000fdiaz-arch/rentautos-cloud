import { ManagementComment } from "./ManagementComment";
import { hasActiveOperationalClient } from "./receivablesPageRules";
import { UnansweredActionForm } from "./UnansweredActionForm";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ReceivableRow } from "../../receivablesV2";
import type { CollectionStatusRecord, ContactOutcomeResult, PromiseFollowupInput, PaymentPromiseDraft } from "./receivablesTypes";
import { latestContact } from "./workdayProgress";
import "./pendingPromises.css";
export function unansweredUnits(rows:ReceivableRow[],records:Record<string,CollectionStatusRecord>,collector:string,today:string) {
 return rows.flatMap(row=>{
  const record=records[row.id],last=latestContact(record,collector,today);
  if(last?.result!=="no_answer")return [];
  const attempts=record.contactOutcomes?.filter(item=>item.collector===collector && item.date===today && item.result==="no_answer").length ?? 0;
  return [{row,last,attempts}];
 }).sort((a,b)=>a.row.unitId.localeCompare(b.row.unitId,undefined,{numeric:true}));
}
export function UnansweredUnits({rows,records,collector,today,scope,disabled,onSave,onSendToRoute,activeRouteClientIds,onOpenRoute}:{activeRouteClientIds?:Set<string>;onOpenRoute?:()=>void;onSendToRoute?:(id:string)=>void;scope:string;disabled:boolean;onSave:(id:string,result:ContactOutcomeResult,followup?:PromiseFollowupInput,promise?:PaymentPromiseDraft)=>Promise<void>;rows:ReceivableRow[];records:Record<string,CollectionStatusRecord>;collector:string;today:string}) {
 const [open,setOpen]=useState(false);
 const [selected,setSelected]=useState<string|null>(null),[saving,setSaving]=useState(false);
 const dialog=useRef<HTMLDialogElement>(null);
 const items=unansweredUnits(rows,records,collector,today);
 const active=items.find(item=>item.row.id===selected);
 useEffect(()=>{if(open)dialog.current?.showModal();},[open]);
 return <>
  <button type="button" className={`cxc-unanswered-tab ${items.length?'has-pending':''} ${open?'is-active':''}`} aria-haspopup="dialog" onClick={()=>setOpen(true)}>Sin respuesta <strong>{items.length}</strong></button>
  {open && createPortal(<dialog ref={dialog} className="cxc-promises-dialog" onCancel={event=>{if(saving)event.preventDefault();else setOpen(false);}} onClose={()=>{setOpen(false);setSelected(null);}}>
   <header><h2>Sin respuesta · {items.length}</h2><button type="button" className="button ghost" disabled={saving} onClick={()=>dialog.current?.close()}>Cerrar ×</button></header>
   {active ? <><button type="button" className="button ghost" disabled={saving} onClick={()=>setSelected(null)}>← Sin respuesta</button><h3>{active.row.unitId} · {active.row.name}</h3><ManagementComment key={active.row.id} scope={scope} clientId={active.row.id} disabled={disabled || saving}/><UnansweredActionForm key={active.row.id+active.last.at} draftKey={scope+":unanswered:"+active.row.id+":"+active.last.at} today={today} disabled={disabled} onSave={async(result,promise)=>{setSaving(true);try{if(active.last.followupOf)await onSave(active.row.id,result,{promiseAt:active.last.followupOf,...(promise?{nextDate:promise.date,nextTime:promise.time,amount:promise.amount}:{})});else await onSave(active.row.id,result,undefined,promise);setSelected(null);}finally{setSaving(false);}}}/></> : <>
   <p>No contestó, se dejó mensaje.</p>
   {!items.length ? <p>No hay unidades pendientes sin respuesta hoy.</p> : <div className="cxc-promises-list"><table><thead><tr><th>Unidad / cliente</th><th>Último intento</th><th>Intentos hoy</th></tr></thead><tbody>
    {items.map(({row,last,attempts})=><tr key={row.id}><td><strong>{row.unitId}</strong><small>{row.name}</small><div className="cxc-promises-actions"><button type="button" className="button ghost small" disabled={disabled} onClick={()=>setSelected(row.id)}>Gestionar</button>{activeRouteClientIds?.has(row.id) ? <button type="button" className="button cxc-send-route is-in-route" onClick={()=>{dialog.current?.close();onOpenRoute?.();}}><span>✓ En ruta en calle</span><span>Ver ruta ↗</span></button> : onSendToRoute && <button type="button" className="button cxc-send-route" disabled={disabled || !hasActiveOperationalClient(row)} onClick={()=>{dialog.current?.close();onSendToRoute?.(row.id);}}>Enviar a ruta en calle <span aria-hidden="true">↗</span></button>}</div></td><td data-label="Último intento">{new Date(last.at).toLocaleTimeString('es-PA',{timeZone:'America/Panama',hour:'numeric',minute:'2-digit',hour12:true})}</td><td data-label="Intentos hoy">{attempts}</td></tr>)}
   </tbody></table></div>}
   </>}
  </dialog>,document.body)}
 </>;
}
