import { useRef, useState, type ComponentProps } from "react";
import { ReceivablesLedgerTable } from "./ReceivablesLedgerTable";
import type { ReceivableRow } from "../../receivablesV2";
import type { CollectionStatusRecord, ContactOutcomeResult } from "./receivablesTypes";
import { getBusinessDateKey } from "../../billing";

// Deliberately receives no persistence callbacks or database client.
export function ReceivablesRoundTrial({ sourceRows, collector, onClose }: {
  sourceRows: ReceivableRow[]; collector: string; onClose: () => void;
}) {
  const [rows] = useState(() => sourceRows.map(row => ({ ...row, id: `trial-${row.id}` })));
  const [now] = useState(() => new Date());
  const [session] = useState(() => crypto.randomUUID());
  const date = getBusinessDateKey(now);
  const futureDate = getBusinessDateKey(new Date(now.getTime() + 86400000));
  const [stage, setStage] = useState(1);
  const [seed] = useState(() => buildFirstRound());
  const [records, setRecords] = useState<Record<string, CollectionStatusRecord>>(seed.records);
  const [retryIds, setRetryIds] = useState<string[]>(seed.pending);
  const [generation, setGeneration] = useState(0);
  const [trialPayments,setTrialPayments]=useState<NonNullable<ComponentProps<typeof ReceivablesLedgerTable>['payments']>>([]);
  const [paymentScenario,setPaymentScenario]=useState('');
  const [lastSavedId, setLastSavedId] = useState<string | null>(null);
  const [initialProgress, setInitialProgress] = useState<{selectedRowId:string|null; retryIds:string[]|null}>({selectedRowId:rows[rows.length-1]?.id??null,retryIds:null});
  const scroll = useRef<HTMLDivElement>(null);
  function hasDebt(row: ReceivableRow) {
    return row.totalPending > 0 || row.totalOtherCharges > 0 || (row.outstandingFineAmount??0)>0 || (row.outstandingTicketAmount??0)>0;
  }
  function outcome(record: CollectionStatusRecord | undefined, row: ReceivableRow, result: ContactOutcomeResult, index: number) {
    const previousTime = Math.max(0, ...(record?.contactOutcomes ?? []).map(item=>Date.parse(item.at)||0));
    const at = new Date(Math.max(now.getTime() + index + stage * 10000, previousTime + 1)).toISOString();
    const amount = Math.max(1, Math.min(100, row.totalPending || row.totalOtherCharges || 20));
    return { ...record, status: "pending" as const, comment: "PRUEBA EN MEMORIA", updatedAt: at,
      ...(result === "promise" ? {paymentPromiseDate:futureDate,paymentPromiseTime:"12:00",paymentPromiseAmount:amount} : {}),
      contactOutcomes:[...(record?.contactOutcomes??[]), {date,at,collector,result,
        ...(result === "promise" ? {promiseDate:futureDate,promiseTime:"12:00",promiseAmount:amount} : {})}]
    };
  }
  function buildFirstRound() {
    const next: Record<string,CollectionStatusRecord> = {};
    const pending: string[] = [];
    let debtIndex = 0;
    rows.forEach((row,index) => {
      const base = {status:"pending" as const,comment:"PRUEBA EN MEMORIA",updatedAt:now.toISOString()};
      if ((row.operationalStatus ?? "activo") !== "activo") next[row.id]={...base,operationalReviewStatus:row.operationalStatus,operationalReviewedAt:now.toISOString()};
      else if (!hasDebt(row)) next[row.id]={...base,gpsLocationReviewedAt:now.toISOString(),gpsLocationNote:"Revisión simulada — no es una validación real"};
      else {
        const result = debtIndex++ % 4 === 0 ? "no_answer" : "promise";
        next[row.id]=outcome(undefined,row,result,index);
        if(result==="no_answer")pending.push(row.id);
      }
    });
    return {records:next,pending};
  }
  function fillFirstRound() {
    setTrialPayments([]);setPaymentScenario('');
    setLastSavedId(null);
    const firstRound = buildFirstRound();
    setRecords(firstRound.records);setRetryIds(firstRound.pending);setStage(1);
    setInitialProgress({selectedRowId:rows[rows.length-1]?.id??null,retryIds:null});setGeneration(v=>v+1);
  }
  function fillSecondRound() {
    setRecords(current => {
      const next={...current};
      retryIds.forEach((id,index)=>{
        // Keep the second attempts entered manually through the real form.
        const attempts=next[id]?.contactOutcomes?.filter(item=>item.date===date && item.collector===collector)??[];
        if(attempts.length>=2){
          // Repair the ordering of simulated records created before timestamp sequencing.
          let previousTime=0;
          next[id]={...next[id],contactOutcomes:next[id].contactOutcomes?.map(item=>{
            previousTime=Math.max(Date.parse(item.at)||0,previousTime+1);
            return {...item,at:new Date(previousTime).toISOString()};
          })};
          return;
        }
        const row=rows.find(r=>r.id===id)!;
        next[id]=outcome(next[id],row,index%2===0?'promise':'no_answer',index);
      });
      return next;
    });
    setStage(2);setInitialProgress({selectedRowId:retryIds[retryIds.length-1]??null,retryIds});setGeneration(v=>v+1);
  }
  const noop=()=>{};
  function preparePaymentTrial(){
    const targets=rows.filter(row=>row.operationalStatus==='activo' && hasDebt(row)).slice(0,2);
    if(targets.length<2)return;
    const current=rows.find(row=>row.operationalStatus==='activo' && !targets.some(target=>target.id===row.id))!;
    const firstRound=buildFirstRound();
    targets.forEach(row=>{firstRound.records[row.id]={status:'pending',comment:'PRUEBA',updatedAt:now.toISOString(),paymentPromiseDate:date,paymentPromiseTime:'23:00',paymentPromiseAmount:100,contactOutcomes:[{date,at:new Date(now.getTime()-60000).toISOString(),collector,result:'promise',promiseDate:date,promiseTime:'23:00',promiseAmount:100}]};});
    setRecords(firstRound.records);setLastSavedId(null);
    setTrialPayments(targets.map((row,index)=>({id:`trial-payment-${index}`,clientId:row.id,clientName:row.name,clientUnit:row.unitId,receiptNumber:`PRUEBA-${index}`,dateApplied:date,paymentMethod:'Efectivo',amountReceived:index?100:40,createdAt:now.toISOString(),appliedToRent:0,centavosAhorro:0,installmentsDeducted:0,balanceBefore:row.totalPending,balanceAfter:row.totalPending,savingsBefore:0,savingsAfter:0,installmentsPaidAfter:row.installmentsPaid,installmentsRemainingAfter:row.installmentsRemaining,rentAmount:row.rentAmount,frequency:row.plan})));
    setInitialProgress({selectedRowId:current.id,retryIds:null});setGeneration(v=>v+1);
    setPaymentScenario(`Pagos simulados: ${targets[0].unitId} recibió $40 y ${targets[1].unitId} recibió $100. Termina ${current.unitId} para revisar el primer pago.`);
  }
  const props: ComponentProps<typeof ReceivablesLedgerTable> = {
    progressScope:`simulation-${session}-${generation}`,initialProgress,tableScrollRef:scroll,
    viewMode:"cartera",selectedHistoryDate:date,selectedHistoryRows:[],rows,collectionStatusByClient:records,
    dailyContactCloudAttemptsByClient:{},dailyContactSaveStatesByClient:{},clientStatusById:new Map(),tenureByClient:new Map(),
    todayDateKey:date,now,isTodayCollectionClosed:false,workflowTab:"management",todayCollectionCuts:{},visibleCollectionCut:"all",
    buildWhatsAppReceivableMessage:()=>"",getWhatsAppGroupRows:()=>undefined,getStatementGroupRows:()=>undefined,
    onSelectDetail:noop,onCollectionCutStatusChange:noop,onCollectionCutCommentChange:noop,onRouteTagChange:()=>false,
    onRouteManagementTypeChange:noop,onRouteManagementCommentChange:noop,onRouteAssignmentChange:noop,onRouteUrgencyChange:noop,
    onRouteReleaseAmountChange:noop,onRemoveFromRoute:noop,onWhatsAppMessageSent:noop,onSupportNoteChange:noop,onContactTimeChange:noop,
    onPaymentPromiseDateChange:noop,onPaymentPromiseTimeChange:noop,onPaymentPromiseAmountChange:noop,onPersistPendingChanges:noop,
    onDailyContactAttemptChange:noop,onOperationalReviewChange:noop,onOpenRoutePreparation:noop,onOpenRoute:noop,onClearFilters:noop,
    collectorKey:collector,payments:trialPayments,isUnitStatusConfirmed:row=>!!records[row.id]?.operationalReviewedAt,
    onValidateUnitStatus:async row=>{setRecords(current=>({...current,[row.id]:{...current[row.id],status:'pending',comment:'PRUEBA',updatedAt:now.toISOString(),operationalReviewedAt:now.toISOString()}}));},
    onGpsLocationReview:async id=>{setRecords(current=>({...current,[id]:{...current[id],status:'pending',comment:'PRUEBA',updatedAt:now.toISOString(),gpsLocationReviewedAt:now.toISOString()}}));},
    onContactOutcome:async(id,result,_followup,promise)=>{
      const agreed=promise??(_followup?.nextDate && _followup?.nextTime && _followup?.amount ? {date:_followup.nextDate,time:_followup.nextTime,amount:_followup.amount}:undefined);
      setRecords(current=>{
        const next=outcome(current[id],rows.find(r=>r.id===id)!,result,1000);
        Object.assign(next.contactOutcomes[next.contactOutcomes.length-1],{paymentReviewKey:_followup?.paymentReviewKey,followupOf:_followup?.promiseAt});
        if(result==='promise' && agreed){
          next.paymentPromiseDate=agreed.date;next.paymentPromiseTime=agreed.time;next.paymentPromiseAmount=agreed.amount;
          Object.assign(next.contactOutcomes[next.contactOutcomes.length-1],{promiseDate:agreed.date,promiseTime:agreed.time,promiseAmount:agreed.amount});
        }
        return {...current,[id]:next};
      });
      setLastSavedId(id);
    }
  };
  return <section className="panel ar-ledger-panel ar-ledger-panel--essential">
    <div className="ar-followup-summary" style={{margin:12}}>
      <strong>PRUEBA · Copia de {rows.length} unidades · {collector==='collector-1'?'Cobrador 1':'Cobrador 2'}</strong>
      <details style={{marginTop:8}}><summary style={{cursor:'pointer'}}>Opciones de prueba e historial · Sin guardar en la base real</summary>
      <p>Unidades, clientes y saldos de tu cartera real. Solo las respuestas son simuladas en memoria; no se guardan promesas, revisiones ni estados en la base real.</p>
      <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
        <button type="button" className="button" onClick={fillFirstRound}>{stage?'Repetir primera vuelta de prueba':'Completar primera vuelta de prueba'}</button>
        {stage>=1 && retryIds.length>0 && <button type="button" className="button" onClick={fillSecondRound}>Completar segunda vuelta de prueba</button>}
        <button type="button" className="button ghost" onClick={onClose}>Salir de la prueba y volver a mi gestión</button>
        <button type="button" className="button" onClick={preparePaymentTrial}>Probar pagos recibidos sin guardar</button>
      </div>
      {paymentScenario ? <p>{paymentScenario}</p> : stage>0 && <p>{stage===1?`Primera vuelta llena: ${retryIds.length} no contestaron. Pulsa «Finalizar recorrido» para iniciar la segunda vuelta real del componente.`:'Segunda vuelta llena: una parte prometió pagar y otra sigue sin contestar. Pulsa «Finalizar recorrido» para ver el resumen.'}</p>}
      {lastSavedId && <div role="status">
        <strong>Historial de prueba · {rows.find(row=>row.id===lastSavedId)?.unitId} · {records[lastSavedId]?.contactOutcomes?.length} intentos conservados</strong>
        <ol>{records[lastSavedId]?.contactOutcomes?.map((attempt,index)=><li key={`${attempt.at}-${index}`}>Intento {index+1}: {attempt.result==='closed_today'?'Gestión cerrada por hoy':attempt.result==='promise'?`Prometió pagar $${attempt.promiseAmount?.toFixed(2)} · ${attempt.promiseDate} ${attempt.promiseTime}`:'No contestó, se dejó mensaje'}</li>)}</ol>
        <small>Solo en memoria; no se envió a la base real.</small>
      </div>}
      </details>
    </div>
    <ReceivablesLedgerTable key={generation} {...props}/>
  </section>;
}
