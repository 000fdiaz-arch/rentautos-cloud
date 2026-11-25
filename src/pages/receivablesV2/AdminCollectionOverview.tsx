import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReceivableRow } from '../../receivablesV2';
import type { Payment } from '../../types';
import type { CollectionStatusRecord } from './receivablesTypes';
import type { OperationalReview } from './operationalReview';
import { FIRST_CONTACT_LABELS, firstContactSummary } from './FirstContactSummary';
import { promiseFollowup } from './promiseFollowup';
import { unansweredUnits } from './UnansweredUnits';
import { RECEIVABLES_COLLECTORS, receivablesCollectorForUnit } from '../../receivablesV2CollectorAccess';
import { supabase } from '../../lib/supabase';
import './adminCollectionOverview.css';
type Props={owner?:string|null;rows:ReceivableRow[];records:Record<string,CollectionStatusRecord>;payments:Payment[];routeIds:Set<string>;today:string;now:Date;onRefresh:()=>Promise<void>};
type Metric='managed'|'pending'|'promise'|'overdue'|'unanswered'|'route';
export function adminCollectorSummary(props:Props,collector:string,reviews:Record<string,OperationalReview>){
 const rows=props.rows.filter(row=>receivablesCollectorForUnit(row.unitId)===collector);
 const first=firstContactSummary({...props,rows,collector,reviews}).entries;
 const promises=rows.map(row=>({row,followup:promiseFollowup(props.records[row.id],collector,props.payments.filter(p=>p.clientId===row.id),props.now)})).filter(x=>x.followup && x.followup.remaining>0);
 const groups:Record<Metric,ReceivableRow[]>={managed:first.filter(x=>x.category!=='pending').map(x=>x.row),pending:first.filter(x=>x.category==='pending').map(x=>x.row),promise:promises.map(x=>x.row),overdue:promises.filter(x=>Date.parse(x.followup!.promise.promiseDate+'T'+x.followup!.promise.promiseTime+':00-05:00')<=props.now.getTime()).map(x=>x.row),unanswered:unansweredUnits(rows,props.records,collector,props.today).map(x=>x.row),route:rows.filter(x=>props.routeIds.has(x.id))};
 return {rows,first,groups};
}
const labels:Record<Metric,string>={managed:'Gestionadas',pending:'Pendientes',promise:'Promesas',overdue:'Vencidas',unanswered:'Sin respuesta',route:'En ruta'};
export function AdminCollectionOverview(props:Props){
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [reviews,setReviews]=useState<Record<string,OperationalReview>>({});
 const [updated,setUpdated]=useState('');
 const [selection,setSelection]=useState<{collector:'collector-1'|'collector-2';metric:Metric}|null>(null);
 const [historyId,setHistoryId]=useState<string|null>(null);
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{if(!open)return;dialog.current?.showModal();let cancelled=false,running=false;
 async function refresh(){if(running)return;running=true;setBusy(true);try{
  if(!supabase||!props.owner)throw Error('No hay conexión disponible.');
  const [,response]=await Promise.all([props.onRefresh(),supabase.from('cxc_v2_receivables_operational_reviews').select('*').eq('user_id',props.owner).gte('reviewed_at',props.today+'T00:00:00-05:00').order('reviewed_at',{ascending:true})]);
  if(response.error)throw response.error;
  if(!cancelled){setReviews(Object.fromEntries((response.data??[]).map(r=>[r.unit_id,r as OperationalReview])));setUpdated(new Date().toLocaleTimeString('es-PA',{timeZone:'America/Panama',hour:'2-digit',minute:'2-digit'}));setError('');}
 }catch{if(!cancelled)setError('No se pudo actualizar. Los datos pueden estar desactualizados.');}finally{running=false;if(!cancelled)setBusy(false);}}
 void refresh();const timer=window.setInterval(()=>{if(document.visibilityState==='visible')void refresh();},30000);
 return()=>{cancelled=true;window.clearInterval(timer);};
 },[open,props.owner,props.today]);
 const selected=selection?adminCollectorSummary(props,selection.collector,reviews):null;
 return <><button type="button" className="button cxc-admin-entry" onClick={()=>setOpen(true)}>Vista de administrador</button>
 {open && createPortal(<dialog ref={dialog} className="cxc-promises-dialog cxc-admin-dialog" onClose={()=>setOpen(false)} onCancel={()=>setOpen(false)}>
 <header><div><h2>Avance de cobranza</h2><small>{props.today.split('-').reverse().join('/')} · {busy?'Actualizando…':updated?`Actualizado ${updated}`:'Cargando…'}</small></div><button type="button" className="button ghost" onClick={()=>dialog.current?.close()}>Cerrar ×</button></header>
 {error && <p role="alert">{error}</p>}
 <div className="cxc-admin-cards">{(['collector-1','collector-2'] as const).map(collector=>{const data=adminCollectorSummary(props,collector,reviews),done=data.groups.managed.length,total=data.rows.length;return <section key={collector}><h3>{RECEIVABLES_COLLECTORS[collector].label} <small>Grupo {RECEIVABLES_COLLECTORS[collector].groups.join(', ')}</small></h3><strong className="cxc-admin-progress">{done} / {total} <small>primer contacto</small></strong><progress aria-label={`Avance de ${RECEIVABLES_COLLECTORS[collector].label}`} value={done} max={total||1}/><div className="cxc-admin-metrics">{(Object.keys(labels) as Metric[]).map(metric=><button key={metric} type="button" className={metric==='overdue'&&data.groups[metric].length?'is-overdue':''} aria-pressed={selection?.collector===collector&&selection.metric===metric} onClick={()=>setSelection({collector,metric})}><span>{labels[metric]}</span><strong>{data.groups[metric].length}</strong></button>)}</div></section>;})}</div>
 <small>Gestionadas y pendientes corresponden al primer contacto. Las demás categorías pueden coincidir.</small>
 {selection && selected && <section className="cxc-admin-details"><h3>{RECEIVABLES_COLLECTORS[selection.collector].label} · {labels[selection.metric]} ({selected.groups[selection.metric].length})</h3><div className="cxc-promises-list"><table><thead><tr><th>Unidad / cliente</th><th>Primer contacto</th><th>Última gestión de hoy</th></tr></thead><tbody>{selected.groups[selection.metric].map(row=>{const first=selected.first.find(x=>x.row.id===row.id);const last=props.records[row.id]?.contactOutcomes?.filter(x=>x.collector===selection.collector&&x.date===props.today).slice().sort((a,b)=>b.at.localeCompare(a.at))[0];return <tr key={row.id}><td><strong>{row.unitId}</strong><small>{row.name}</small><button type="button" className="button ghost small" onClick={()=>setHistoryId(row.id)}>Historial y comentarios</button></td><td>{first?FIRST_CONTACT_LABELS[first.category]:'Pendiente'}</td><td>{last?<>{FIRST_CONTACT_LABELS[last.result]}<small>{new Date(last.at).toLocaleTimeString('es-PA',{timeZone:'America/Panama',hour:'2-digit',minute:'2-digit'})}</small></>:'—'}</td></tr>;})}</tbody></table></div>{!selected.groups[selection.metric].length&&<p>No hay unidades en esta categoría.</p>}</section>}
 {historyId && <section className="cxc-admin-details" aria-label="Historial de la unidad"><h3>Historial · {props.rows.find(row=>row.id===historyId)?.unitId}</h3><button type="button" className="button ghost small" onClick={()=>setHistoryId(null)}>Cerrar historial</button>{(props.records[historyId]?.contactOutcomes??[]).slice().sort((a,b)=>b.at.localeCompare(a.at)).map((entry,index)=><article className="cxc-admin-history" key={entry.at+index}><strong>{FIRST_CONTACT_LABELS[entry.result]} · {entry.collector==='collector-1'?'Cobrador 1':'Cobrador 2'}</strong><small style={{display:'block'}}>{new Date(entry.at).toLocaleString('es-PA',{timeZone:'America/Panama'})}</small>{entry.comment && <p>{entry.comment}</p>}{entry.note && entry.note!==entry.comment && <p>{entry.note}</p>}{!entry.comment && !entry.note && <p>Sin comentario.</p>}</article>)}{!props.records[historyId]?.contactOutcomes?.length && <p>Sin gestiones registradas.</p>}</section>}
 </dialog>,document.body)}</>;
}
