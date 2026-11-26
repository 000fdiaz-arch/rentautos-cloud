import { ManagementComment } from "./ManagementComment";
import { hasActiveOperationalClient } from "./receivablesPageRules";
import { EditPendingPromise } from "./EditPendingPromise";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatCurrency } from "../../format";
import type { ReceivableRow } from "../../receivablesV2";
import type { promiseFollowup } from "./promiseFollowup";
import type { ContactOutcomeResult, PromiseFollowupInput } from "./receivablesTypes";
import { PromiseFollowupForm } from "./PromiseFollowupForm";
import "./pendingPromises.css";
export type PendingPromise = { row: ReceivableRow; followup: NonNullable<ReturnType<typeof promiseFollowup>> };
export function pendingPromiseOverdue(item: PendingPromise, now: Date) {
  return item.followup.overdue;
}
export function orderedPendingPromises(items: Array<{row:ReceivableRow;followup:ReturnType<typeof promiseFollowup>}>, now:Date): PendingPromise[] {
  return items.filter((item): item is PendingPromise=>!!item.followup && item.followup.remaining>0 && !item.followup.waitingForRetry).sort((a,b)=>Number(pendingPromiseOverdue(b,now))-Number(pendingPromiseOverdue(a,now)) || a.row.unitId.localeCompare(b.row.unitId,undefined,{numeric:true}) || a.row.id.localeCompare(b.row.id));
}
export function PendingPromises({required=false,items,now,today,scope,onSave,disabled,onSendToRoute,activeRouteClientIds,onOpenRoute}:{required?:boolean;activeRouteClientIds?:Set<string>;onOpenRoute?:()=>void;onSendToRoute?:(id:string)=>void;items:PendingPromise[];now:Date;today:string;scope:string;disabled:boolean;onSave:(id:string,result:ContactOutcomeResult,input:PromiseFollowupInput)=>Promise<void>}) {
  const [open,setOpen]=useState(false),[selected,setSelected]=useState<string|null>(null),[saving,setSaving]=useState(false);
  const [editing,setEditing]=useState(false);
  const dialog=useRef<HTMLDialogElement>(null);
  const overdue=(item:PendingPromise)=>pendingPromiseOverdue(item,now);
  const sorted=orderedPendingPromises(items,now);
  useEffect(()=>{if(open)dialog.current?.showModal();},[open]);
  useEffect(()=>{
    const element=dialog.current;
    if(!open || !required || !element) return;
    const preventCancel=(event:Event)=>event.preventDefault();
    const keepOpen=()=>{if(!element.open)element.showModal();};
    element.addEventListener("cancel",preventCancel);
    element.addEventListener("close",keepOpen);
    return ()=>{element.removeEventListener("cancel",preventCancel);element.removeEventListener("close",keepOpen);};
  },[open,required]);
  const wasRequired=useRef(false);
  useEffect(()=>{
    if(required){setOpen(true);setEditing(false);}
    else if(wasRequired.current){dialog.current?.close();setOpen(false);setSelected(null);}
    wasRequired.current=required;
  },[required]);
  const available=required ? sorted.filter(item=>item.followup.overdue) : sorted;
  const active=available.find(item=>item.row.id===selected);
  return <>
    <button type="button" className={`cxc-promises-tab ${items.some(overdue) ? "has-overdue" : items.length ? "has-pending" : ""} ${open ? "is-active" : ""}`} aria-haspopup="dialog" disabled={disabled} onClick={()=>setOpen(true)}>Promesas <strong>{items.length}</strong>{items.some(overdue) && <span className="cxc-promises-dot" role="img" aria-label={`${items.filter(overdue).length} vencidas`}/>}</button>
    {open && createPortal(<dialog ref={dialog} className="cxc-promises-dialog" onCancel={event=>{if(saving || required)event.preventDefault();else setOpen(false);}} onClose={()=>{if(required){dialog.current?.showModal();return;}setOpen(false);setSelected(null);}} onKeyDown={event=>{if(required && event.key==="Escape"){event.preventDefault();event.stopPropagation();}}}>
      <header><h2>{required ? "Atiende las promesas vencidas" : "Promesas pendientes"}</h2><button type="button" className="button ghost" disabled={saving || required} onClick={()=>dialog.current?.close()}>Cerrar ×</button></header>
      {required && <p role="alert">Hay promesas vencidas pendientes. Atiéndelas primero para continuar con la cartera en orden de unidad.</p>}
      {active ? <><button type="button" className="button ghost" disabled={saving} onClick={()=>setSelected(null)}>← Todas las promesas</button><h3>{active.row.unitId} · {active.row.name}</h3><ManagementComment key={active.row.id} scope={scope} clientId={active.row.id} disabled={disabled || saving}/>
        {editing ? <EditPendingPromise key={active.row.id+active.followup.promise.at} item={active} today={today} draftKey={scope+":edit-promise:"+active.row.id+":"+active.followup.promise.at} onSave={async input=>{setSaving(true);try{await onSave(active.row.id,"promise",input);setSelected(null);}finally{setSaving(false);}}}/> : <PromiseFollowupForm key={active.row.id+active.followup.alertKey} draftKey={scope+':followup:'+active.row.id+':'+active.followup.alertKey} today={today} followup={active.followup} onSave={async(result,input)=>{setSaving(true);try{await onSave(active.row.id,result,input);setSelected(null);}finally{setSaving(false);}}}/>}</> : <>
        {!sorted.length && <p>No hay promesas pendientes.</p>}
        {sorted.length > 0 && <div className="cxc-promises-list"><table><thead><tr><th>Unidad / cliente</th><th>Fecha y hora</th><th>Prometió</th><th>Falta</th></tr></thead><tbody>
        {available.map(item=>{const promise=item.followup.promise,hour=Number(promise.promiseTime!.slice(0,2));return <tr key={item.row.id}>
          <td><strong>{item.row.unitId}</strong><small>{item.row.name}</small><div className="cxc-promises-actions"><button type="button" className="button ghost small" disabled={disabled} onClick={()=>{setEditing(false);setSelected(item.row.id);}}>Ver</button><button type="button" className="button ghost small" disabled={disabled} onClick={()=>{setEditing(true);setSelected(item.row.id);}}>Editar</button>{!required && (activeRouteClientIds?.has(item.row.id) ? <button type="button" className="button cxc-send-route is-in-route" onClick={()=>{dialog.current?.close();onOpenRoute?.();}}><span>✓ En ruta en calle</span><span>Ver ruta ↗</span></button> : onSendToRoute && <button type="button" className="button cxc-send-route" disabled={disabled || !hasActiveOperationalClient(item.row)} onClick={()=>{dialog.current?.close();onSendToRoute?.(item.row.id);}}>Enviar a ruta en calle <span aria-hidden="true">↗</span></button>)}</div></td>
          <td data-label="Fecha y hora">{promise.promiseDate!.split('-').reverse().join('/')}<small>{hour%12||12}:{promise.promiseTime!.slice(3)} {hour>=12?'PM':'AM'}{overdue(item) && <b className="cxc-promise-overdue"> · Vencida</b>}</small></td>
          <td data-label="Prometió">{formatCurrency(promise.promiseAmount!)}</td><td data-label="Falta"><strong>{formatCurrency(item.followup.remaining)}</strong></td>
        </tr>;})}</tbody></table></div>}
      </>}
    </dialog>,document.body)}
  </>;
}
