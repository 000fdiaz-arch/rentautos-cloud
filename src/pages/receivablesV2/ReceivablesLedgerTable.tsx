import { previousPortfolioRow } from "./PreviousUnitReview";
import { ManagementComment } from "./ManagementComment";
import { hasActiveOperationalClient } from "./receivablesPageRules";
import { ImportantClientNote } from "./ImportantClientNote";
import { requiresCollectionPayment } from "./collectionAmountDue";
import { CollectionRoundSummary } from "./CollectionRoundSummary";
import { alreadyManagedToday, collectionPaymentReview, paymentReview, closedForToday, hasReviewedPaymentPromise } from "./paymentReview";
import { VerifiedPaymentReview } from "./VerifiedPaymentReview";
import { useWorkdayValue, latestContact, contactIsDue, restoredRoundIndex } from "./workdayProgress";
import { OperationalReviewForm } from "./OperationalReviewForm";
import { needsOperationalReview } from "./operationalReview";
import { PromiseFollowupForm } from "./PromiseFollowupForm";
import type { ContactOutcomeResult, PromiseFollowupInput, PaymentPromiseDraft } from "./receivablesTypes";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { formatCurrency, formatDate } from "../../format";
import { STATE_LABEL, type ReceivableRow, type ReceivableState } from "../../receivablesV2";
import type { Client, Payment } from "../../types";
import { promiseFollowup } from "./promiseFollowup";
import {
  fieldManagementLabel,
  type CollectionStatusRecord,
  type DailyContactCloudAttempts,
  type DailyContactResult,
  type DailyContactSaveStates,
  type DailyContactShift,
  type FieldManagementType
} from "./receivablesTypes";
import { ReceivableTableRow } from "./ReceivableTableRow";
import {
  COLLECTION_CUT_OPTIONS,
  COLLECTION_STATUS_HELP,
  COLLECTION_STATUS_OPTIONS,
  ROUTE_ASSIGNMENT_OPTIONS,
  ROUTE_URGENCY_OPTIONS,
  normalizeRouteAssignment,
  overdueInstallmentsText,
  stateToneClass,
  type CollectionClosureItem,
  type CollectionCutKey,
  type ReceivablesViewMode,
  type ReceivablesWorkflowTab
} from "./receivablesPageRules";


export type ReceivablesHistoryRow = {
  clientId: string;
  unitId: string;
  clientName: string;
  lastPaymentDate: string | null;
  lastPaymentAt?: string | null;
  receivableState: string;
  totalPending: number;
  cuts: Partial<Record<CollectionCutKey, CollectionClosureItem>>;
};

type Props = {
  activeRouteClientIds?: Set<string>;
  loadPaymentReviewRow?: (row: ReceivableRow) => Promise<ReceivableRow>;
  initialProgress?: { selectedRowId: string | null; retryIds: string[] | null };
  onValidateUnitStatus?: (row: ReceivableRow, status: string) => Promise<void>;
  isUnitStatusConfirmed?: (row: ReceivableRow) => boolean;
  operationalReviewError?: string;
  progressScope?: string;
  tableScrollRef: RefObject<HTMLDivElement>;
  viewMode: ReceivablesViewMode;
  selectedHistoryDate: string;
  selectedHistoryRows: ReceivablesHistoryRow[];
  rows: ReceivableRow[];
  collectionStatusByClient: Record<string, CollectionStatusRecord>;
  dailyContactCloudAttemptsByClient: Record<string, DailyContactCloudAttempts>;
  dailyContactSaveStatesByClient: Record<string, DailyContactSaveStates>;
  clientStatusById: Map<string, Client["status"]>;
  tenureByClient: Map<string, { label: string; days: number | null }>;
  todayDateKey: string;
  now: Date;
  isTodayCollectionClosed: boolean;
  workflowTab: ReceivablesWorkflowTab;
  todayCollectionCuts: Partial<Record<CollectionCutKey, { items: CollectionClosureItem[] }>>;
  visibleCollectionCut: CollectionCutKey | "all";
  buildWhatsAppReceivableMessage: (row: ReceivableRow) => string;
  getWhatsAppGroupRows: (row: ReceivableRow) => ReceivableRow[] | undefined;
  getStatementGroupRows: (row: ReceivableRow) => ReceivableRow[] | undefined;
  onSelectDetail: (row: ReceivableRow) => void;
  onCollectionCutStatusChange: (cutKey: CollectionCutKey, clientId: string, nextStatus: string) => void;
  onCollectionCutCommentChange: (cutKey: CollectionCutKey, clientId: string, value: string) => void;
  onRouteTagChange: (clientId: string, tagged: boolean) => boolean | Promise<boolean>;
  onRouteManagementTypeChange: (clientId: string, value: FieldManagementType) => void;
  onRouteManagementCommentChange: (clientId: string, value: string) => void;
  onRouteAssignmentChange: (clientId: string, value: string) => void;
  onRouteUrgencyChange: (clientId: string, value: "normal" | "urgent" | "very_urgent") => void;
  onRouteReleaseAmountChange: (clientId: string, value: string) => void;
  onRemoveFromRoute: (clientId: string) => void;
  onWhatsAppMessageSent: (clientId: string, message: string) => void;
  onSaveImportantNote?: (clientId: string, value: string) => Promise<void>;
  onSupportNoteChange: (clientId: string, value: string) => void;
  onContactTimeChange: (clientId: string, value: string) => void;
  onPaymentPromiseDateChange: (clientId: string, value: string) => void;
  onPaymentPromiseTimeChange: (clientId: string, value: string) => void;
  onPaymentPromiseAmountChange: (clientId: string, value: string) => void;
  onGpsLocationReview: (clientId: string, locationNote: string) => Promise<void>;
  onContactOutcome: (clientId: string, result: ContactOutcomeResult, followup?: PromiseFollowupInput, promise?: PaymentPromiseDraft) => Promise<void>;
  collectorKey: string;
  payments: Payment[];
  onPersistPendingChanges: () => void;
  onDailyContactAttemptChange: (clientId: string, shift: DailyContactShift, result: DailyContactResult | "pending") => void;
  onOperationalReviewChange: (clientId: string, operationalStatus: string, reviewed: boolean) => void;
  onOpenRoutePreparation: (clientId: string) => void;
  onOpenRoute: () => void;
  onClearFilters: () => void;
};

function getCutItemsForClient(
  cuts: Partial<Record<CollectionCutKey, { items: CollectionClosureItem[] }>>,
  clientId: string
): Partial<Record<CollectionCutKey, CollectionClosureItem>> {
  const cutItems: Partial<Record<CollectionCutKey, CollectionClosureItem>> = {};
  for (const option of COLLECTION_CUT_OPTIONS) {
    const item = cuts[option.key]?.items.find((cutItem) => cutItem.clientId === clientId);
    if (item) cutItems[option.key] = item;
  }
  return cutItems;
}

function renderCutStatusCell(item: CollectionClosureItem | undefined) {
  if (!item) return <span className="ar-cut-empty">Sin corte</span>;
  const label = COLLECTION_STATUS_OPTIONS.find((option) => option.value === item.collectionStatus)?.label ?? "Sin estado";
  return (
    <div className="ar-cut-cell-content">
      <span
        className={`ar-cut-status ar-cut-status--${item.collectionStatus}`}
        title={COLLECTION_STATUS_HELP[item.collectionStatus]}
      >
        {label}
      </span>
      {item.comment ? <span className="hint ar-cut-comment">Comentario: {item.comment}</span> : null}
      <div className="ar-cut-actions">
        {item.whatsAppMessageSentAt ? <span>Enviado</span> : item.whatsAppMessageCopiedAt ? <span>Por enviar</span> : null}
        {item.managementAmount ? (
          <span>
            {fieldManagementLabel(item.managementType)} en ruta {formatCurrency(item.managementAmount)}
          </span>
        ) : null}
        {item.contactTime ? <span>Contactar {item.contactTime}</span> : null}
        {item.managementComment ? <span>{item.managementComment}</span> : null}
      </div>
    </div>
  );
}

function renderHistoryCutStack(item: CollectionClosureItem | undefined, cutKey: CollectionCutKey) {
  const cutOption = COLLECTION_CUT_OPTIONS.find((option) => option.key === cutKey);
  return (
    <div className={`ar-cut-stack-row ar-cut-stack-row--${cutKey}`}>
      <span className="ar-cut-stack-label">
        {cutOption?.shortLabel ?? "Gestion"}
      </span>
      {renderCutStatusCell(item)}
    </div>
  );
}

function firstName(value: string): string {
  return value.trim().split(/\s+/)[0] || value;
}

function useStableEvent<T extends (...args: any[]) => any>(handler: T): T {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  return useCallback(((...args: Parameters<T>) => handlerRef.current(...args)) as T, []);
}

export const ReceivablesLedgerTable = memo(function ReceivablesLedgerTable({
  activeRouteClientIds,
  loadPaymentReviewRow,
  progressScope = "preview",
  initialProgress,
  onValidateUnitStatus,
  isUnitStatusConfirmed,
  operationalReviewError,
  tableScrollRef,
  viewMode,
  selectedHistoryDate,
  selectedHistoryRows,
  rows,
  collectionStatusByClient,
  dailyContactCloudAttemptsByClient,
  dailyContactSaveStatesByClient,
  clientStatusById,
  tenureByClient,
  todayDateKey,
  now,
  isTodayCollectionClosed,
  workflowTab,
  todayCollectionCuts,
  visibleCollectionCut,
  buildWhatsAppReceivableMessage,
  getWhatsAppGroupRows,
  getStatementGroupRows,
  onSelectDetail,
  onCollectionCutStatusChange,
  onCollectionCutCommentChange,
  onRouteTagChange,
  onRouteManagementTypeChange,
  onRouteManagementCommentChange,
  onRouteAssignmentChange,
  onRouteUrgencyChange,
  onRouteReleaseAmountChange,
  onRemoveFromRoute,
  onWhatsAppMessageSent,
  onSaveImportantNote,
  onSupportNoteChange,
  onContactTimeChange,
  onPaymentPromiseDateChange,
  onPaymentPromiseTimeChange,
  onPaymentPromiseAmountChange,
  onGpsLocationReview,
  onContactOutcome,
  collectorKey,
  payments,
  onPersistPendingChanges,
  onDailyContactAttemptChange,
  onOperationalReviewChange,
  onOpenRoutePreparation,
  onOpenRoute,
  onClearFilters
}: Props) {
  const progressKey = `cxc.v2.workday.v1:${progressScope}:${collectorKey}:${todayDateKey}`;
  const [customRouteEditorByClient, setCustomRouteEditorByClient] = useState<Record<string, boolean>>({});
  const [routeAmountDraftByClient, setRouteAmountDraftByClient] = useState<Record<string, string>>({});
  const [selectedRowId, setSelectedRowId] = useWorkdayValue<string | null>(progressKey + ":unit", initialProgress?.selectedRowId ?? null);
  const [outcomeSaving, setOutcomeSaving] = useState(false);
  const [inspectionId,setInspectionId] = useState<string|null>(null);
  const saveContactOutcome = useStableEvent(async (clientId: string, result: "no_answer" | "promise" | "paid_up" | "reminder_today" | "reminder_tomorrow", promise?: PaymentPromiseDraft) => {
    const advance = advanceAfterManagement;
    setOutcomeSaving(true);
    try {
      await onContactOutcome(clientId, result, undefined, promise);
      advance({ clientId, result });
    }
    finally { setOutcomeSaving(false); }
  });
  const [retryIds, setRetryIds] = useWorkdayValue<string[] | null>(progressKey + ":retryIds", initialProgress?.retryIds ?? null);
  const [roundFinished, setRoundFinished] = useWorkdayValue<boolean>(progressKey + ":roundFinished", false);
  const [hotClientId, setHotClientId] = useWorkdayValue<string | null>(progressKey + ":hotClientId", null);
  const [automaticFollowup, setAutomaticFollowup] = useWorkdayValue<boolean>(progressKey + ":automaticFollowup", false);
  const [shownPromises, setShownPromises] = useWorkdayValue<string[]>(progressKey + ":shownPromises", []);
  const [deferredIds, setDeferredIds] = useWorkdayValue<string[]>(progressKey + ":deferred", []);
  const [operationalPending, setOperationalPending] = useWorkdayValue(progressKey + ":operational-pending", false);
  const [paymentReviewId,setPaymentReviewId] = useWorkdayValue<string|null>(progressKey + ":payment-review",null);
  const [paymentResumeAdvance,setPaymentResumeAdvance] = useWorkdayValue(progressKey + ":payment-resume-advance",true);
  useEffect(() => {
    // Retire restored automatic detours without changing the portfolio cursor or history.
    setHotClientId(null); setAutomaticFollowup(false);
  }, []);
  const paymentReviews = rows.filter(row => !alreadyManagedToday(collectionStatusByClient[row.id],collectorKey,now) && !isUnitStatusConfirmed?.(row)).map(row=>({row,review:collectionPaymentReview(row,collectionStatusByClient[row.id],collectorKey,payments.filter(payment=>payment.clientId===row.id),now)})).filter(item=>item.review!==null);

  const openRows=rows.filter(row=>!closedForToday(collectionStatusByClient[row.id],collectorKey,todayDateKey));
  const followups = rows.map(row => ({
    row,
    followup: promiseFollowup(collectionStatusByClient[row.id], collectorKey,
      payments.filter(payment => payment.clientId === row.id), now)
  }));
  const dueFollowups = followups.filter(item => item.followup?.overdue && requiresCollectionPayment(item.row) && !closedForToday(collectionStatusByClient[item.row.id],collectorKey,todayDateKey) && !needsOperationalReview(item.row.operationalStatus ?? "activo")).sort((a, b) =>
    (a.followup!.promise.promiseDate! + a.followup!.promise.promiseTime!)
      .localeCompare(b.followup!.promise.promiseDate! + b.followup!.promise.promiseTime!));
  useEffect(() => {
    if (!hotClientId || outcomeSaving) return;
    const last = latestContact(collectionStatusByClient[hotClientId], collectorKey, todayDateKey);
    if (last?.result === "no_answer" && last.followupOf) {
      setHotClientId(null);
      setAutomaticFollowup(false);
    }
  }, [hotClientId, outcomeSaving, collectionStatusByClient, collectorKey, todayDateKey]);
  const eligibleRows = openRows.filter(row => {
    const record = collectionStatusByClient[row.id];
    // The first round contains only units without a confirmed management today.
    // No-answer retries and overdue promises keep their own follow-up flows.
    if (retryIds === null && (alreadyManagedToday(record, collectorKey, now) || isUnitStatusConfirmed?.(row))) return false;
    const last = latestContact(record, collectorKey, todayDateKey);
    const waitingForCallback = last?.result === "no_answer"
      && (retryIds === null || !contactIsDue(record, collectorKey, todayDateKey, now));
    return !waitingForCallback && !hasReviewedPaymentPromise(record, collectorKey, todayDateKey);
  });
  const roundRows = retryIds === null ? eligibleRows : retryIds.flatMap((id) => eligibleRows.filter((row) => row.id === id));
  const roundRowsKey = JSON.stringify(roundRows.map(row => row.id));
  const pendingIds = openRows.filter(row => latestContact(collectionStatusByClient[row.id], collectorKey, todayDateKey)?.result === "no_answer").map(row => row.id);
  const readyPendingIds = pendingIds.filter(id => contactIsDue(collectionStatusByClient[id], collectorKey, todayDateKey, now));
  const scheduledIds = pendingIds.filter(id => !readyPendingIds.includes(id));
  const currentRowIndex = restoredRoundIndex(roundRows, rows, selectedRowId);
  const nextRowIndex = roundRows.findIndex((row, index) => index > currentRowIndex && !hasReviewedPaymentPromise(collectionStatusByClient[row.id], collectorKey, todayDateKey) && (retryIds === null || contactIsDue(collectionStatusByClient[row.id], collectorKey, todayDateKey, now)));
  function setSelectedRowIndex(index: number) { setSelectedRowId(roundRows[index]?.id ?? null); }
  const visibleRows = roundFinished ? [] : roundRows.slice(currentRowIndex, currentRowIndex + 1);
  const visibleRow = visibleRows[0];
  const inspectedRow = rows.find(row=>row.id===inspectionId);
  const previousRow = previousPortfolioRow(rows,inspectedRow?.id ?? visibleRow?.id);
  // Old sessions may have restored a payment taken from the former global queue.
  // Only the unit at the current cursor can open a receipt review now.
  const activePaymentReview = paymentReviews.find(item => item.row.id === paymentReviewId && item.row.id === visibleRow?.id && !hotClientId && !roundFinished);
  useEffect(() => {
    if (paymentReviewId && !activePaymentReview && rows.length) setPaymentReviewId(null);
  }, [paymentReviewId, activePaymentReview, rows.length]);
  const currentPaymentReview = paymentReviews.find(item => !hotClientId && item.row.id === visibleRow?.id);
  useEffect(function openCurrentPaymentReview() {
    // Review a receipt for the unit already on screen; other units stay queued.
    // Drafts and the portfolio cursor remain in their existing workday keys.
    if (viewMode !== "cartera" || workflowTab === "route" || roundFinished || outcomeSaving || paymentReviewId || !currentPaymentReview) return;
    setPaymentResumeAdvance(hotClientId ? automaticFollowup : true);
    setPaymentReviewId(currentPaymentReview.row.id);
    setHotClientId(null);
    setAutomaticFollowup(false);
  }, [viewMode, workflowTab, roundFinished, outcomeSaving, paymentReviewId, currentPaymentReview, hotClientId, automaticFollowup]);
  const reviewedRow = rows.find(row => row.id === hotClientId) ?? visibleRow;
  const navigationBlockedByStatus = !!reviewedRow && needsOperationalReview(reviewedRow.operationalStatus ?? "activo")
    && (operationalPending || !isUnitStatusConfirmed?.(reviewedRow));
  // Draft fields are not proof of a saved contact. Retry rounds require a new save.
  const navigationBlocked = !!reviewedRow && (navigationBlockedByStatus
    || (!needsOperationalReview(reviewedRow.operationalStatus ?? "activo")
      && (retryIds !== null || !alreadyManagedToday(collectionStatusByClient[reviewedRow.id], collectorKey, now))));
  const navigationBlockMessage = navigationBlockedByStatus
    ? "Valida y guarda el estado antes de continuar."
    : "Guarda la gestión de esta unidad para continuar.";
  const stableOnSelectDetail = useStableEvent(onSelectDetail);
  const stableOnCollectionCutStatusChange = useStableEvent(onCollectionCutStatusChange);
  const stableOnCollectionCutCommentChange = useStableEvent(onCollectionCutCommentChange);
  const stableOnRouteTagChange = useStableEvent(onRouteTagChange);
  const stableOnRouteManagementTypeChange = useStableEvent(onRouteManagementTypeChange);
  const stableOnRouteManagementCommentChange = useStableEvent(onRouteManagementCommentChange);
  const stableOnRouteAssignmentChange = useStableEvent(onRouteAssignmentChange);
  const stableOnRouteUrgencyChange = useStableEvent(onRouteUrgencyChange);
  const stableOnRouteReleaseAmountChange = useStableEvent(onRouteReleaseAmountChange);
  const stableOnWhatsAppMessageSent = useStableEvent(onWhatsAppMessageSent);
  const stableOnSupportNoteChange = useStableEvent(onSupportNoteChange);
  const stableOnContactTimeChange = useStableEvent(onContactTimeChange);
  const stableOnPaymentPromiseDateChange = useStableEvent(onPaymentPromiseDateChange);
  const stableOnPaymentPromiseTimeChange = useStableEvent(onPaymentPromiseTimeChange);
  const stableOnPaymentPromiseAmountChange = useStableEvent(onPaymentPromiseAmountChange);
  const stableOnGpsLocationReview = useStableEvent(async (clientId: string, locationNote: string) => {
    const advance = advanceAfterManagement;
    setOutcomeSaving(true);
    try {
      await onGpsLocationReview(clientId, locationNote);
      advance();
    } finally { setOutcomeSaving(false); }
  });
  const stableOnPersistPendingChanges = useStableEvent(onPersistPendingChanges);
  const stableOnDailyContactAttemptChange = useStableEvent(onDailyContactAttemptChange);
  const stableOnOperationalReviewChange = useStableEvent(onOperationalReviewChange);
  const stableOnOpenRoutePreparation = useStableEvent(onOpenRoutePreparation);
  const stableOnOpenRoute = useStableEvent(onOpenRoute);

  useEffect(() => {
    // Never reset a restored position while cloud rows are still loading.
    if (rows.length && !roundFinished && retryIds === null && currentRowIndex >= roundRows.length && !hotClientId && !paymentReviewId && !outcomeSaving) {
      setDeferredIds(scheduledIds);
      setRetryIds([]);
      setRoundFinished(true);
      return;
    }
    if (rows.length && selectedRowId && hasReviewedPaymentPromise(collectionStatusByClient[selectedRowId], collectorKey, todayDateKey)) {
      if (roundRows[currentRowIndex]) setSelectedRowId(roundRows[currentRowIndex].id);
      else if (!hotClientId && !paymentReviewId) setRoundFinished(true);
    }
    if (!selectedRowId && roundRows.length) setSelectedRowId(roundRows[0].id);
    if (hotClientId && rows.length && !rows.some(row => row.id === hotClientId)) setHotClientId(null);
  }, [roundFinished, now, rows, selectedRowId, hotClientId, roundRowsKey, outcomeSaving, paymentReviewId]);

  const collectionCutItemsByClient = useMemo(() => {
    const byClient = new Map<string, Partial<Record<CollectionCutKey, CollectionClosureItem>>>();
    for (const row of rows) byClient.set(row.id, getCutItemsForClient(todayCollectionCuts, row.id));
    return byClient;
  }, [rows, todayCollectionCuts]);

  function updateRouteAmountDraft(clientId: string, value: string): void {
    setRouteAmountDraftByClient((current) => ({
      ...current,
      [clientId]: value
    }));
  }

  function changeSelectedRow(nextIndex: number): void {
    setSelectedRowIndex(Math.max(0, Math.min(roundRows.length - 1, nextIndex)));
    window.requestAnimationFrame(() => tableScrollRef.current?.scrollIntoView({ block: "start" }));
  }

  function advanceAfterManagement(completed?: { clientId: string; result: "no_answer" | "promise" | "paid_up" | "reminder_today" | "reminder_tomorrow" }, reviewedPaymentId?: string): void {

    if (hotClientId && !automaticFollowup) { setHotClientId(null); return; }
    setHotClientId(null);
    setAutomaticFollowup(false);
    const resumeIndex = reviewedPaymentId ? roundRows.findIndex((row,index)=>index>currentRowIndex && row.id!==reviewedPaymentId && !hasReviewedPaymentPromise(collectionStatusByClient[row.id],collectorKey,todayDateKey) && (retryIds===null || contactIsDue(collectionStatusByClient[row.id],collectorKey,todayDateKey,now))) : nextRowIndex;
    if (resumeIndex >= 0) changeSelectedRow(resumeIndex);
    else if (retryIds === null) {
      setDeferredIds((completed ? scheduledIds.filter(id => id !== completed.clientId) : scheduledIds).filter(id=>id!==reviewedPaymentId));
      // Finish visibly. A second attempt starts only through its explicit action.
      setRetryIds([]);
      setRoundFinished(true);
    } else setRoundFinished(true);
  }

  function renderImportantNote() {
    const row = inspectedRow ?? activePaymentReview?.row ?? rows.find(item => item.id === hotClientId) ?? visibleRow;
    if (!row || viewMode !== "cartera" || roundFinished) return null;
    return <><ImportantClientNote key={row.id} unit={row.unitId} name={row.name}
      value={collectionStatusByClient[row.id]?.supportNote ?? ""} disabled={!!inspectedRow || isTodayCollectionClosed || !onSaveImportantNote}
      onSave={note => onSaveImportantNote!(row.id, note)} /><ManagementComment key={row.id+":"+(collectionStatusByClient[row.id]?.contactOutcomes?.slice(-1)[0]?.at??"")} scope={progressKey} clientId={row.id} disabled={!!inspectedRow || isTodayCollectionClosed || outcomeSaving}/></>;
  }

  function renderRowsNavigation(position: "top" | "bottom") {
    if (inspectedRow) return position === "bottom" ? null : <nav className="ar-ledger-pagination"><button type="button" className="button ghost ar-ledger-pagination-button" disabled={!previousRow} onClick={()=>{if(previousRow)setInspectionId(previousRow.id);}}>← Anterior</button><span className="ar-ledger-pagination-status"><strong>{inspectedRow.unitId}</strong><small>Consulta de unidad anterior</small></span><button type="button" className="button ghost ar-ledger-pagination-button" onClick={()=>setInspectionId(null)}>Volver a gestionar {visibleRow?.unitId} →</button></nav>;
    if(activePaymentReview){
      if(position==='bottom')return null;
      const {row,review}=activePaymentReview;
      return <><div className="cxc-route-review-action">{activeRouteClientIds?.has(row.id) ? <button type="button" className="button cxc-send-route is-in-route" onClick={onOpenRoute}><span>✓ En ruta en calle</span><span>Ver ruta ↗</span></button> : hasActiveOperationalClient(row) && <button type="button" className="button cxc-send-route" disabled={isTodayCollectionClosed || outcomeSaving} onClick={()=>onOpenRoutePreparation(row.id)}>Enviar {row.unitId} a ruta en calle <span aria-hidden="true">↗</span></button>}</div><VerifiedPaymentReview tenureDays={tenureByClient.get(row.id)?.days} loadRow={loadPaymentReviewRow} key={row.id+review!.key} draftKey={progressKey+':payment:'+row.id+':'+review!.key} unit={row.unitId} name={row.name}
        row={row} today={todayDateKey} review={review!}
        onSave={async(result,input)=>{
          // Capture the position before closing today's client removes it from roundRows.
          const advance=()=>advanceAfterManagement(result === "no_answer" ? {clientId:row.id,result} : undefined,row.id);
          setOutcomeSaving(true);
          try {await onContactOutcome(row.id,result,input);setPaymentReviewId(null);if(!roundFinished && paymentResumeAdvance)advance();}
          finally{setOutcomeSaving(false);}
        }}/></>;
    }
    if (rows.length === 0) return null;
    if (position === "bottom" && roundFinished) return null;
    const notices = position === "top" && hotClientId ? <button type="button" className="button ghost" disabled={outcomeSaving || navigationBlockedByStatus} onClick={() => setHotClientId(null)}>Volver a mi gestión</button> : null;
    if (roundFinished) return <>{notices}<CollectionRoundSummary
      collector={collectorKey === "collector-1" ? "Cobrador 1" : "Cobrador 2"} date={todayDateKey}
      promises={followups.filter(item => item.followup?.promise.date === todayDateKey).map(({row,followup})=>({
        id:row.id,unit:row.unitId,name:row.name,amount:followup!.promise.promiseAmount ?? 0,
        remaining:followup!.remaining,date:followup!.promise.promiseDate,time:followup!.promise.promiseTime
      }))}
      pending={rows.filter(row=>pendingIds.includes(row.id)).map(row=>({
        id:row.id,unit:row.unitId,name:row.name,
        attempts:collectionStatusByClient[row.id]?.contactOutcomes?.filter(item=>item.date===todayDateKey && item.collector===collectorKey).length ?? 0,
        nextContactAt:latestContact(collectionStatusByClient[row.id],collectorKey,todayDateKey)?.nextContactAt
      }))}
    /><nav className="ar-ledger-pagination">
      <strong>Recorrido terminado · {pendingIds.length} pendientes sin respuesta</strong>

      {readyPendingIds.length > 0 ? <button type="button" className="button" onClick={() => {
        setRetryIds(readyPendingIds); setSelectedRowId(readyPendingIds[0]); setRoundFinished(false);
      }}>Volver a intentar pendientes</button> : <span>{scheduledIds.length ? "Esperando la próxima hora de contacto." : "No quedan clientes sin respuesta."}</span>}
    </nav></>;
    return (
      <>{notices}
      <nav
        className={`ar-ledger-pagination ar-ledger-pagination--${position}`}
        aria-label={`${position === "top" ? "Navegación superior" : "Navegación inferior"} de unidades en cuentas por cobrar`}
      >
        <button
          type="button"
          className="button ghost ar-ledger-pagination-button"
          onClick={() => {if(previousRow && !outcomeSaving)setInspectionId(previousRow.id);}}
          disabled={!previousRow || outcomeSaving || hotClientId !== null}
        >
          <span aria-hidden="true">←</span> Anterior
        </button>
        <span className="ar-ledger-pagination-status" aria-live="polite">
          <strong>{rows.find(row => row.id === hotClientId)?.unitId ?? visibleRows[0]?.unitId ?? "Unidad"}</strong>
          <small>{hotClientId ? (followups.find(item => item.row.id === hotClientId)?.followup?.paid ? "Seguimiento de pago parcial" : "Seguimiento de promesa pendiente") : `${retryIds === null ? "Primera vuelta" : "Seguimiento sin respuesta"} · Unidad ${currentRowIndex + 1} de ${roundRows.length}`}</small>
          {navigationBlocked ? (
            <small className="ar-ledger-pagination-required">
              {navigationBlockMessage}
            </small>
          ) : null}
        </span>
        <button
          type="button"
          className="button ghost ar-ledger-pagination-button"
          onClick={() => {
            if (navigationBlocked || outcomeSaving) return;
            advanceAfterManagement();
          }}
          disabled={navigationBlocked || outcomeSaving || hotClientId !== null}
          title={navigationBlocked ? navigationBlockMessage : undefined}
        >
          {hotClientId ? "Terminar seguimiento y continuar" : currentRowIndex >= roundRows.length - 1 ? "Finalizar recorrido" : "Siguiente"} <span aria-hidden="true">→</span>
        </button>
      </nav></>
    );
  }

  function commitRouteAmountDraft(clientId: string): void {
    const draft = routeAmountDraftByClient[clientId];
    if (draft === undefined) return;
    setRouteAmountDraftByClient((current) => {
      const next = { ...current };
      delete next[clientId];
      return next;
    });
    onRouteReleaseAmountChange(clientId, draft);
  }

  if (viewMode === "cartera" && rows.length === 0) {
    return (
      <div className="table-scroll ar-ledger-scroll" ref={tableScrollRef}>
        <div className="ar-empty-results">
          <strong>No hay clientes para esos filtros</strong>
          <span>Prueba con otro estado o limpia los filtros para volver a ver la cartera.</span>
          <button type="button" className="button ghost small" onClick={onClearFilters}>
            Limpiar filtros
          </button>
        </div>
      </div>
    );
  }

  if (viewMode === "cartera" && workflowTab === "route") {
    return (
      <div className="table-scroll ar-ledger-scroll" ref={tableScrollRef}>
        {renderRowsNavigation("top")}
        <table className="ar-table ar-route-list-table">
          <thead>
            <tr>
              <th>Unidad</th>
              <th>Cliente</th>
              <th>Atraso</th>
              <th>Ult. pago</th>
              <th>Renta vencida</th>
              <th>Tipo</th>
              <th>Min. liberar</th>
              <th>Comentario</th>
              <th>Ruta</th>
              <th>Alarma</th>
              <th>Accion</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => {
              const statusRecord = collectionStatusByClient[row.id];
              const routeReleaseAmount = statusRecord?.routeReleaseAmount ?? statusRecord?.managementAmount;
              const routeAssignment = statusRecord?.routeAssignment ?? "";
              const routeUrgency = statusRecord?.routeUrgency ?? "normal";
              const isCustomRouteAssignment = !!routeAssignment && !ROUTE_ASSIGNMENT_OPTIONS.includes(routeAssignment);
              const isCustomRouteEditorOpen = isCustomRouteAssignment || !!customRouteEditorByClient[row.id];
              return (
                <tr key={row.id} className={routeUrgency !== "normal" ? `ar-route-urgency-row ar-route-urgency-row--${routeUrgency}` : undefined}>
                  <td><strong className="ar-unit-id">{row.unitId}</strong></td>
                  <td>
                    <span className="client-name ar-route-client-name" title={row.name}>{firstName(row.name)}</span>
                  </td>
                  <td>{row.daysLate > 0 ? `${row.daysLate} dias` : "Sin atraso"}</td>
                  <td>
                    <div className="ar-account-status-stack">
                      <span className="ar-last-payment-date">
                        {row.lastPaymentDate ? formatDate(new Date(`${row.lastPaymentDate}T12:00:00`)) : "Sin pagos"}
                      </span>
                    </div>
                  </td>
                  <td className="amount-debt">
                    <strong className="ar-overdue-chip-amount">{formatCurrency(row.overdueBalance)}</strong>
                    <small className="ar-overdue-chip-installments">{overdueInstallmentsText(row.overdueBalance, row.rentAmount)}</small>
                  </td>
                  <td>
                    <select
                      className="ar-route-list-type"
                      value={statusRecord?.managementType ?? "solo_cobrar"}
                      onChange={(event) => onRouteManagementTypeChange(row.id, event.target.value as FieldManagementType)}
                      disabled={isTodayCollectionClosed}
                    >
                      <option value="solo_cobrar">Solo cobrar</option>
                      <option value="cobrar_o_quitar">Cobrar o quitar</option>
                      <option value="desiste">Desiste</option>
                      <option value="quitar">Quitar</option>
                    </select>
                  </td>
                  <td>
                    <input
                      className="ar-route-list-amount"
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      value={routeAmountDraftByClient[row.id] ?? (routeReleaseAmount ?? "")}
                      onChange={(event) => updateRouteAmountDraft(row.id, event.target.value)}
                      onBlur={() => commitRouteAmountDraft(row.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur();
                      }}
                      placeholder={row.overdueBalance > 0 ? row.overdueBalance.toFixed(2) : "0.00"}
                      disabled={isTodayCollectionClosed}
                    />
                  </td>
                  <td>
                    <input
                      className="ar-route-list-comment"
                      type="text"
                      value={statusRecord?.managementComment ?? ""}
                      onChange={(event) => onRouteManagementCommentChange(row.id, event.target.value)}
                      placeholder="Comentario..."
                      maxLength={25}
                      disabled={isTodayCollectionClosed}
                    />
                  </td>
                  <td>
                    <div className="ar-route-assignment-cell">
                      {isCustomRouteEditorOpen ? (
                        <input
                          className="ar-route-list-route-custom"
                          type="text"
                          value={routeAssignment}
                          onChange={(event) => onRouteAssignmentChange(row.id, event.target.value)}
                          onBlur={(event) => {
                            const normalized = normalizeRouteAssignment(event.target.value);
                            if (event.target.value !== (normalized ?? "")) onRouteAssignmentChange(row.id, normalized ?? "");
                            if (!normalized) setCustomRouteEditorByClient((current) => ({ ...current, [row.id]: false }));
                          }}
                          autoFocus
                          placeholder="Escribe ruta"
                          maxLength={12}
                          disabled={isTodayCollectionClosed}
                          aria-label={`Ruta manual de ${row.unitId}`}
                        />
                      ) : (
                        <select
                          className="ar-route-list-route"
                          value={routeAssignment}
                          onChange={(event) => {
                            const selected = event.target.value;
                            if (selected === "__custom") {
                              setCustomRouteEditorByClient((current) => ({ ...current, [row.id]: true }));
                              onRouteAssignmentChange(row.id, "");
                              return;
                            }
                            setCustomRouteEditorByClient((current) => ({ ...current, [row.id]: false }));
                            onRouteAssignmentChange(row.id, selected);
                          }}
                          disabled={isTodayCollectionClosed}
                          aria-label={`Ruta de ${row.unitId}`}
                        >
                          <option value="">Sin ruta</option>
                          {ROUTE_ASSIGNMENT_OPTIONS.map((option) => (
                            <option key={option} value={option}>{option}</option>
                          ))}
                          <option value="__custom">Otra</option>
                        </select>
                      )}
                    </div>
                  </td>
                  <td>
                    <select
                      className={`ar-route-urgency-select ar-route-urgency-select--${routeUrgency}`}
                      value={routeUrgency}
                      onChange={(event) => onRouteUrgencyChange(row.id, event.target.value as "normal" | "urgent" | "very_urgent")}
                      disabled={isTodayCollectionClosed}
                    >
                      {ROUTE_URGENCY_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="button ghost small ar-route-list-remove"
                      onClick={() => onRemoveFromRoute(row.id)}
                      disabled={isTodayCollectionClosed}
                    >
                      Sacar
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="ar-route-mobile-list" aria-label="Cobro en ruta">
          {visibleRows.map((row) => {
            const statusRecord = collectionStatusByClient[row.id];
            const routeReleaseAmount = statusRecord?.routeReleaseAmount ?? statusRecord?.managementAmount;
            const routeAssignment = statusRecord?.routeAssignment ?? "";
            const routeUrgency = statusRecord?.routeUrgency ?? "normal";
            const isCustomRouteAssignment = !!routeAssignment && !ROUTE_ASSIGNMENT_OPTIONS.includes(routeAssignment);
            const isCustomRouteEditorOpen = isCustomRouteAssignment || !!customRouteEditorByClient[row.id];
            return (
              <article className={`ar-route-mobile-card ${routeUrgency !== "normal" ? `ar-route-mobile-card--${routeUrgency}` : ""}`} key={`mobile-route-${row.id}`}>
                <div className="ar-route-mobile-head">
                  <div className="ar-route-mobile-unit">
                    <strong className="ar-unit-id">{row.unitId}</strong>
                    <span title={row.name}>{firstName(row.name)}</span>
                  </div>
                  <div className="ar-route-mobile-amount">
                    <small>Renta vencida</small>
                    <strong className="ar-overdue-chip-amount">{formatCurrency(row.overdueBalance)}</strong>
                    <small className="ar-overdue-chip-installments">{overdueInstallmentsText(row.overdueBalance, row.rentAmount)}</small>
                  </div>
                </div>
                {routeUrgency !== "normal" ? (
                  <div className={`ar-route-alarm ar-route-alarm--${routeUrgency}`}>
                    {routeUrgency === "very_urgent" ? "Muy urgente" : "Urgente"}
                  </div>
                ) : null}

                <div className="ar-route-mobile-meta">
                  <span>{row.daysLate > 0 ? `${row.daysLate} dias de atraso` : "Sin atraso"}</span>
                  <span>{row.lastPaymentDate ? formatDate(new Date(`${row.lastPaymentDate}T12:00:00`)) : "Sin pagos"}</span>
                </div>

                <div className="ar-route-mobile-controls">
                  <label>
                    <span>Estado</span>
                    <span className="ar-cut-select ar-cut-select--pending ar-route-status-fixed">Pendiente · En ruta</span>
                  </label>
                  <label>
                    <span>Tipo</span>
                    <select
                      className="ar-route-list-type"
                      value={statusRecord?.managementType ?? "solo_cobrar"}
                      onChange={(event) => onRouteManagementTypeChange(row.id, event.target.value as FieldManagementType)}
                      disabled={isTodayCollectionClosed}
                    >
                      <option value="solo_cobrar">Solo cobrar</option>
                      <option value="cobrar_o_quitar">Cobrar o quitar</option>
                      <option value="desiste">Desiste</option>
                      <option value="quitar">Quitar</option>
                    </select>
                  </label>
                  <label>
                    <span>Min. liberar</span>
                    <input
                      className="ar-route-list-amount"
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      value={routeAmountDraftByClient[row.id] ?? (routeReleaseAmount ?? "")}
                      onChange={(event) => updateRouteAmountDraft(row.id, event.target.value)}
                      onBlur={() => commitRouteAmountDraft(row.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur();
                      }}
                      placeholder={row.overdueBalance > 0 ? row.overdueBalance.toFixed(2) : "0.00"}
                      disabled={isTodayCollectionClosed}
                    />
                  </label>
                  <label>
                    <span>Ruta</span>
                    {isCustomRouteEditorOpen ? (
                      <input
                        className="ar-route-list-route-custom"
                        type="text"
                        value={routeAssignment}
                        onChange={(event) => onRouteAssignmentChange(row.id, event.target.value)}
                        onBlur={(event) => {
                          const normalized = normalizeRouteAssignment(event.target.value);
                          if (event.target.value !== (normalized ?? "")) onRouteAssignmentChange(row.id, normalized ?? "");
                          if (!normalized) setCustomRouteEditorByClient((current) => ({ ...current, [row.id]: false }));
                        }}
                        placeholder="Escribe ruta"
                        maxLength={12}
                        disabled={isTodayCollectionClosed}
                        aria-label={`Ruta manual de ${row.unitId}`}
                      />
                    ) : (
                      <select
                        className="ar-route-list-route"
                        value={routeAssignment}
                        onChange={(event) => {
                          const selected = event.target.value;
                          if (selected === "__custom") {
                            setCustomRouteEditorByClient((current) => ({ ...current, [row.id]: true }));
                            onRouteAssignmentChange(row.id, "");
                            return;
                          }
                          setCustomRouteEditorByClient((current) => ({ ...current, [row.id]: false }));
                          onRouteAssignmentChange(row.id, selected);
                        }}
                        disabled={isTodayCollectionClosed}
                        aria-label={`Ruta de ${row.unitId}`}
                      >
                        <option value="">Sin ruta</option>
                        {ROUTE_ASSIGNMENT_OPTIONS.map((option) => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                        <option value="__custom">Otra</option>
                      </select>
                    )}
                  </label>
                  <label>
                    <span>Alarma</span>
                    <select
                      className={`ar-route-urgency-select ar-route-urgency-select--${routeUrgency}`}
                      value={routeUrgency}
                      onChange={(event) => onRouteUrgencyChange(row.id, event.target.value as "normal" | "urgent" | "very_urgent")}
                      disabled={isTodayCollectionClosed}
                    >
                      {ROUTE_URGENCY_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="ar-route-mobile-comment">
                    <span>Comentario</span>
                    <input
                      className="ar-route-list-comment"
                      type="text"
                      value={statusRecord?.managementComment ?? ""}
                      onChange={(event) => onRouteManagementCommentChange(row.id, event.target.value)}
                      placeholder="Comentario..."
                      maxLength={25}
                      disabled={isTodayCollectionClosed}
                    />
                  </label>
                </div>

                <button
                  type="button"
                  className="button ghost small ar-route-list-remove ar-route-mobile-remove"
                  onClick={() => onRemoveFromRoute(row.id)}
                  disabled={isTodayCollectionClosed}
                >
                  Sacar de ruta
                </button>
              </article>
            );
          })}
        </div>
        {renderRowsNavigation("bottom")}
      </div>
    );
  }

  return (
    <div className="table-scroll ar-ledger-scroll" ref={tableScrollRef}>
      {renderImportantNote()}
      {viewMode === "cartera" ? renderRowsNavigation("top") : null}
      <table className="ar-table ar-table--compact">
        <tbody>
          {viewMode === "historial" ? (
            selectedHistoryRows.length === 0 ? (
              <tr>
                <td colSpan={4} className="empty" style={{ textAlign: "center" }}>
                  No hay datos en esta gestion.
                </td>
              </tr>
            ) : selectedHistoryRows.map((item) => (
              <tr key={`${selectedHistoryDate}-${item.clientId}`}>
                <td><strong className="ar-unit-id">{item.unitId}</strong></td>
                <td className="ar-pending-cell">
                  <div className="ar-client-money-layout">
                    <div className="ar-client-money-main">
                      <span className="client-name">{formatCurrency(item.totalPending)}</span>
                      <span className="debt-meta ar-truncate-line" title={item.clientName}>{item.clientName}</span>
                    </div>
                    <div className="ar-account-status-stack">
                      <span className="ar-last-payment-date">
                        {item.lastPaymentDate ? formatDate(new Date(`${item.lastPaymentDate}T12:00:00`)) : "Sin pagos"}
                      </span>
                      <span className={stateToneClass(item.receivableState as ReceivableState)}>
                        {STATE_LABEL[item.receivableState as ReceivableState] ?? item.receivableState}
                      </span>
                    </div>
                  </div>
                </td>
                <td className="ar-support-note-cell"><span className="hint">-</span></td>
                <td className="ar-cut-cell ar-cut-cell--stacked">
                  <div className="ar-cut-stack">
                    {COLLECTION_CUT_OPTIONS.map((option) => (
                      <div key={option.key}>
                        {renderHistoryCutStack(item.cuts[option.key], option.key)}
                      </div>
                    ))}
                  </div>
                </td>
              </tr>
            ))
          ) : (inspectedRow ? [inspectedRow] : activePaymentReview ? [] : [...visibleRows, ...rows.filter(row => row.id === hotClientId && !visibleRows.some(current => current.id === row.id))]).map((row) => (
            <ReceivableTableRow
              key={row.id + (retryIds === null ? "-first" : "-retry")}
              draftKey={progressKey + ":draft:" + row.id + (retryIds === null ? "" : ":second")}
              isSecondRound={retryIds !== null && hotClientId !== row.id}
              row={row}
              hidden={!inspectedRow && hotClientId !== null && hotClientId !== row.id}
              followupForm={needsOperationalReview(row.operationalStatus ?? "activo") ? <>
                <OperationalReviewForm key={`${row.unitId}:${row.operationalStatus}`} unit={row.unitId} status={row.operationalStatus ?? ""}
                  loadError={operationalReviewError}
                  draftKey={`${progressKey}:operational:${row.unitId}:${row.operationalStatus}`}
                  confirmed={!!isUnitStatusConfirmed?.(row)} disabled={!!inspectedRow || isTodayCollectionClosed || outcomeSaving}
                  onPendingChange={setOperationalPending} onSave={async status => {
                    if (!onValidateUnitStatus) throw new Error("La validación de estado no está disponible.");
                    // Preserve the cursor before a status change can replace the client row with a fleet row.
                    const advance = advanceAfterManagement;
                    setOutcomeSaving(true);
                    try {
                      await onValidateUnitStatus(row, status);
                      setOperationalPending(false);
                      advance();
                    } finally { setOutcomeSaving(false); }
                  }}/>
              </> : hotClientId === row.id && followups.find(item => item.row.id === row.id)?.followup ? <PromiseFollowupForm draftKey={progressKey + ":followup:" + row.id + ":" + followups.find(item => item.row.id === row.id)!.followup!.alertKey} key={row.id} today={todayDateKey} followup={followups.find(item => item.row.id === row.id)!.followup!} onSave={async (result, input) => {
                setOutcomeSaving(true);
                try {
                  await onContactOutcome(row.id, result, input);

                  setHotClientId(null);
                  setAutomaticFollowup(false);
                } finally { setOutcomeSaving(false); }
              }}/> : undefined}
              statusRecord={collectionStatusByClient[row.id]}
              dailyContactCloudAttempts={dailyContactCloudAttemptsByClient[row.id]}
              dailyContactSaveStates={dailyContactSaveStatesByClient[row.id]}
              operationalStatus={row.operationalStatus ?? clientStatusById.get(row.id) ?? "activo"}
              tenureLabel={tenureByClient.get(row.id)?.label ?? "Sin antigüedad"}
              tenureDays={tenureByClient.get(row.id)?.days ?? null}
              todayDateKey={todayDateKey}
              now={now}
              isTodayCollectionClosed={isTodayCollectionClosed || !!inspectedRow}
              workflowTab={workflowTab}
              collectionCutItems={collectionCutItemsByClient.get(row.id) ?? {}}
              visibleCutKey={visibleCollectionCut}
              whatsAppMessage={buildWhatsAppReceivableMessage(row)}
              whatsAppGroupRows={getWhatsAppGroupRows(row)}
              statementGroupRows={getStatementGroupRows(row)}
              onSelectDetail={stableOnSelectDetail}
              onCollectionCutStatusChange={stableOnCollectionCutStatusChange}
              onCollectionCutCommentChange={stableOnCollectionCutCommentChange}
              onRouteTagChange={stableOnRouteTagChange}
              onRouteManagementTypeChange={stableOnRouteManagementTypeChange}
              onRouteManagementCommentChange={stableOnRouteManagementCommentChange}
              onRouteAssignmentChange={stableOnRouteAssignmentChange}
              onRouteUrgencyChange={stableOnRouteUrgencyChange}
              onRouteReleaseAmountChange={stableOnRouteReleaseAmountChange}
              onWhatsAppMessageSent={stableOnWhatsAppMessageSent}
              onSupportNoteChange={stableOnSupportNoteChange}
              onContactTimeChange={stableOnContactTimeChange}
              onPaymentPromiseDateChange={stableOnPaymentPromiseDateChange}
              onPaymentPromiseTimeChange={stableOnPaymentPromiseTimeChange}
              onPaymentPromiseAmountChange={stableOnPaymentPromiseAmountChange}
              onContinuePaidUp={inspectedRow ? undefined : () => saveContactOutcome(row.id, "paid_up")}
              onGpsLocationReview={stableOnGpsLocationReview}
              onContactOutcome={saveContactOutcome}
              collectorKey={collectorKey}
              onPersistPendingChanges={stableOnPersistPendingChanges}
              onDailyContactAttemptChange={stableOnDailyContactAttemptChange}
              onOperationalReviewChange={stableOnOperationalReviewChange}
              isInSharedRoute={activeRouteClientIds?.has(row.id) ?? false}
              onOpenRoutePreparation={stableOnOpenRoutePreparation}
              onOpenRoute={stableOnOpenRoute}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
});
