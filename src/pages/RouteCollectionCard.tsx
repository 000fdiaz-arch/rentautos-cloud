import { useId, useState } from "react";
import RouteVehicleDetails from "./RouteVehicleDetails";
import type { ActiveRouteItem } from "../cloudData";
import type { RoutePaymentReport } from "../cloud/routeReportCloudData";
import type { RouteCaptureEvent } from "../cloud/routeCaptureCloudData";
import { formatCurrency } from "../format";
import { isPendingCashRouteReport } from "../routeReviewRules";
import { effectiveRouteUrgency, formatRouteDateTime, routeUrgencyLabel, routeVisualRedIntensity } from "../routeTimeUrgency";
import { fieldManagementLabel } from "./receivables/receivablesTypes";
import "./routeTimeUrgency.css";

export type RouteWorkflowView = "work" | "review" | "confirmed" | "custody" | "managed";
export type RouteCardView = Exclude<RouteWorkflowView, "managed"> | "partial";
export type RouteCardItem = ActiveRouteItem & { report?: RoutePaymentReport };

type Props = {
  dataOwnerUserId?: string | null;
  managementVersion?: "legacy" | "v2";
  managementFields?: React.ReactNode;
  item: RouteCardItem;
  capture?: RouteCaptureEvent;
  view: RouteCardView;
  paidRent: number;
  balance: number;
  travelFundBalance: number;
  canReport: boolean;
  canDeclareCustody: boolean;
  canEdit: boolean;
  canEditAmount: boolean;
  canRemove: boolean;
  canRegister: boolean;
  hasPendingReport: boolean;
  hasActiveRoute: boolean;
  reportDisabled: boolean;
  saving: boolean;
  amountSaving: boolean;
  receiptLoading: boolean;
  hasReceipt: boolean;
  zone: string;
  zoneOptions: string[];
  zoneSaving: boolean;
  comment: string;
  commentSaving: boolean;
  changingRoute: boolean;
  changingAssignedDelta: boolean;
  canEditAssignedDelta: boolean;
  showAssignedDelta?: boolean;
  highlightComments?: boolean;
  routeOptions: string[];
  inactiveSaving: boolean;
  elapsedNow: number;
  canReturnReport: boolean;
  canConfirmBank: boolean;
  bankConfirmationSaving: boolean;
  bankNotices: Array<{ id: string; amount: number; collectionTeam?: string }>;
  onEditAmount: () => void;
  onRegister: () => void;
  onReceipt: () => void;
  onCustody: () => void;
  onRemove: () => void;
  onKeep: () => void;
  onReturnReport: () => void;
  onConfirmBank: () => void;
  onZone: (value: string) => void;
  onSaveZone: () => void;
  onComment: (value: string) => void;
  onSaveComment: () => void;
  onRoute: (route: string) => void;
  onAssignedDelta: (delta: "delta1" | "delta2" | "delta3") => void;
  onCreateRoute: () => void;
  onInactive: () => void;
};

function elapsedSince(value: string, now: number): string {
  const started = Date.parse(value);
  if (!Number.isFinite(started)) return "Tiempo no disponible";
  const minutes = Math.max(0, Math.floor((now - started) / 60_000));
  if (minutes < 1) return "Hace menos de 1 min";
  if (minutes < 60) return `Hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) return `Hace ${hours} h${remainingMinutes ? ` ${remainingMinutes} min` : ""}`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return `Hace ${days} d${remainingHours ? ` ${remainingHours} h` : ""}`;
}

function routeElapsedSince(value: string, now: number): string {
  const started = Date.parse(value);
  if (!Number.isFinite(started)) return "Tiempo no disponible";
  const minutes = Math.max(0, Math.floor((now - started) / 60_000));
  if (minutes < 1) return "menos de 1 min";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) return `${hours} h${remainingMinutes ? ` ${remainingMinutes} min` : ""}`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return `${days} d${remainingHours ? ` ${remainingHours} h` : ""}`;
}

export default function RouteCollectionCard(props: Props) {
  const zoneListId = useId();
  const routePickerId = useId();
  const [routePickerOpen, setRoutePickerOpen] = useState(false);
  const [routeQuery, setRouteQuery] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const { item, view, paidRent, canReport, canEdit, canRemove, saving } = props;
  const savedCommentClassName = `route-collection-saved-comment${props.highlightComments ? " route-collection-saved-comment--highlight" : ""}`;
  const report = item.report;
  const remaining = Math.max(0, item.releaseAmount - paidRent);
  const partial = paidRent > 0 && remaining > 0;
  const acknowledged = typeof item.partialDecisionRentAmount === "number" && Math.abs(item.partialDecisionRentAmount - paidRent) < 0.005;
  const pendingCash = view === "review" && isPendingCashRouteReport(report);
  const acceptedBankSavings = report && view === "confirmed"
    && report.confirmed_bank_savings_amount > 0
    && report.confirmed_bank_received_amount > 0
    && Math.abs(report.confirmed_bank_received_amount - report.confirmed_bank_savings_amount - report.bank_amount) < 0.005;
  const visuallyConfirmedBank = Boolean(report?.bank_confirmed_visually_at);
  const confirmedReceivedAmount = report
    ? report.cash_amount + (report.bank_amount > 0 ? report.confirmed_bank_received_amount : 0)
    : 0;
  const tone = view === "custody" ? "custody" : view === "confirmed" ? "confirmed" : pendingCash || view === "partial" ? "attention" : "normal";
  const automaticUrgency = view === "work" ? effectiveRouteUrgency(item, props.elapsedNow) : "normal";
  const manualUrgency = view === "partial" && item.urgency && item.urgency !== "normal" ? item.urgency : null;
  const urgencyLabel = automaticUrgency !== "normal" ? routeUrgencyLabel(item, props.elapsedNow) : manualUrgency === "very_urgent" ? "Muy urgente" : manualUrgency ? "Urgente" : "";
  const redIntensity = routeVisualRedIntensity(item, props.elapsedNow);
  const redHue = item.urgency === "very_urgent" ? 345 : 0;
  const routeTimeStyle = view === "work" ? {
    "--route-time-accent": `hsl(${redHue} 76% ${Math.round(82 - redIntensity * 48)}%)`,
    "--route-time-surface": `hsl(${redHue} 72% ${Math.round(99 - redIntensity * 4)}%)`,
    "--route-time-background": `hsl(${redHue} 82% ${Math.round(97 - redIntensity * 57)}%)`,
    "--route-time-foreground": redIntensity >= 0.45 ? "#ffffff" : "#7f1d1d"
  } as React.CSSProperties : undefined;
  const urgencyClass = view === "work"
    ? ` route-collection-card--time-progress${item.urgency === "urgent" || item.urgency === "very_urgent" ? ` route-collection-card--priority-${item.urgency}` : ""}`
    : manualUrgency ? ` route-collection-card--${manualUrgency}` : "";
  const listLayout = view === "review" || view === "partial" || view === "custody";
  const listLayoutClass = listLayout
    ? ` route-collection-card--workflow-list route-collection-card--${view === "custody" ? "custody-list" : "review-list"}`
    : "";
  return <article style={routeTimeStyle} className={`route-search-card route-collection-card route-collection-card--${tone}${urgencyClass}${listLayoutClass}${item.routeInactiveAt && view === "work" ? " route-collection-card--inactive" : ""}`} aria-label={`${item.unitId} · ${item.clientName}`}>
    <div className="route-collection-identity">
      <div>
        <h2>{item.unitId} <span>· {item.clientName.trim().split(/\s+/)[0]}</span></h2>
        {view !== "work" ? <span className="route-collection-route-time" title={`Desde ${formatRouteDateTime(item.publishedAt)}`} aria-label={`Tiempo en ruta de ${item.unitId}: ${routeElapsedSince(item.publishedAt, props.elapsedNow)}`}>⏱ En ruta · {routeElapsedSince(item.publishedAt, props.elapsedNow)}</span> : null}
      </div>
      {canReport && !report ? (
        <div className="route-collection-route-control" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setRoutePickerOpen(false); }}>
        <button type="button" className="button ghost small route-collection-change-route" aria-label={`Cambiar ruta de ${item.unitId}`} aria-expanded={routePickerOpen} aria-controls={routePickerId}
          title={`Ruta actual: ${item.routeAssignment || "Sin ruta"}`} disabled={props.changingRoute || saving} onClick={() => { setRoutePickerOpen(open => !open); setRouteQuery(""); }}>Cambiar ruta</button>
        {routePickerOpen ? <div id={routePickerId} className="route-collection-route-options" onKeyDown={event => { if (event.key === "Escape") setRoutePickerOpen(false); }}>
        <div className="route-collection-route-options-heading"><span>Actual: <strong>{item.routeAssignment || "Sin ruta"}</strong></span>
          <button type="button" aria-label="Cerrar selector de ruta" onClick={() => setRoutePickerOpen(false)}>×</button></div>
        <input autoFocus aria-label={`Buscar ruta para ${item.unitId}`} placeholder="Buscar ruta…" value={routeQuery} onChange={event => setRouteQuery(event.target.value)} />
        <div className="route-collection-route-options-list" role="group" aria-label={`Rutas disponibles para ${item.unitId}`}>
          {props.routeOptions.filter(route => route !== (item.routeAssignment ?? "").trim().toUpperCase()
            && route.toLocaleLowerCase("es").includes(routeQuery.trim().toLocaleLowerCase("es"))).map(route =>
            <button key={route} type="button" disabled={props.changingRoute || saving} onClick={() => { setRoutePickerOpen(false); props.onRoute(route); }}>{route}</button>)}
        </div>
        {routeQuery.trim() && !props.routeOptions.some(route => route !== (item.routeAssignment ?? "").trim().toUpperCase()
          && route.toLocaleLowerCase("es").includes(routeQuery.trim().toLocaleLowerCase("es"))) ? <p>No hay rutas con ese nombre.</p> : null}
        <button type="button" className="route-collection-create-route" onClick={() => { setRoutePickerOpen(false); props.onCreateRoute(); }}>+ Nueva ruta</button>
        </div> : null}</div>
      ) : <span className="route-collection-route">{item.routeAssignment || "Sin ruta"}</span>}
    </div>
    {view === "work" && props.travelFundBalance > 0 ? (
      <div className="route-collection-travel-fund" aria-label={`Fondo de viaje disponible: ${formatCurrency(props.travelFundBalance)}`}>
        <span aria-hidden="true">✈</span>
        <span>Fondo de viaje disponible</span>
        <strong>{formatCurrency(props.travelFundBalance)}</strong>
      </div>
    ) : null}
    {view !== "work" ? <>
      <label className="route-collection-field">Zona<input aria-label={`Zona de ${item.unitId}`} list={zoneListId} value={props.zone} maxLength={40} placeholder="Sin zona" disabled={Boolean(report) || props.zoneSaving} onChange={event => props.onZone(event.target.value)} onBlur={props.onSaveZone} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }} /></label>
    </> : null}
      <datalist id={zoneListId}>{props.zoneOptions.map(zone => <option key={zone} value={zone} />)}</datalist>
    {view === "work" && item.routeInactiveAt ? <div className="route-collection-inactive" aria-label={`Estado inactivo de ${item.unitId}`}>
      <strong>Inactivo · no está encendido</strong>
      <span>Declarado {formatRouteDateTime(item.routeInactiveAt)}</span>
      <b>{elapsedSince(item.routeInactiveAt, props.elapsedNow)}</b>
    </div> : null}
    <div className="route-collection-summary">
      {view === "custody" ? <>
      <span className="route-collection-tag">{props.capture?.status === "confirmed" ? "En custodia · confirmada" : "En custodia · pendiente"}</span>
      <p className="route-collection-context">Desde {formatRouteDateTime(item.custodySince)}</p>
      {props.capture ? <p className="route-collection-context">Reportada por {props.capture.reporter_name.split("@")[0]} · Ruta {props.capture.route_assignment || "Sin ruta"}{props.capture.confirmed_at ? <><br />Confirmada {formatRouteDateTime(props.capture.confirmed_at)}</> : null}</p> : null}
    </> : report && (view === "review" || view === "confirmed") ? <>
      <span className={`route-collection-tag ${view === "confirmed" ? "route-collection-tag--confirmed" : ""}`}>{acceptedBankSavings ? "Pago confirmado con diferencia" : visuallyConfirmedBank ? "Confirmado en banco" : view === "confirmed" ? "Pago confirmado" : `Pago notificado · ${pendingCash && report.bank_amount <= report.confirmed_bank_amount ? "Efectivo pendiente" : report.method === "cash" ? "Efectivo pendiente" : report.method === "mixed" ? "Pago mixto por confirmar" : "Banca por confirmar"}`}</span>
      <p className="route-collection-amount">{report.method === "cash" || view === "confirmed" ? "Pagó" : "Reportó"} {formatCurrency(report.amount)}</p>
      {acceptedBankSavings ? <div className="route-collection-accepted-difference" aria-label="Diferencia bancaria aceptada">
        <span>Reportó <strong>{formatCurrency(report.amount)}</strong></span>
        <span>Recibido <strong>{formatCurrency(confirmedReceivedAmount)}</strong></span>
        <b>{formatCurrency(report.confirmed_bank_savings_amount)} aplicado a ahorro</b>
        <small>Coincide con unidad, fecha y método bancario</small>
      </div> : null}
      {report.method === "mixed" ? <p className="route-collection-context"><span>Efectivo: {formatCurrency(report.cash_amount)} · {report.confirmed_cash_amount >= report.cash_amount ? "Confirmado" : "Pendiente"}</span><br /><span>Banca: {formatCurrency(report.bank_amount)} · {report.confirmed_bank_amount >= report.bank_amount ? "Confirmado" : "Pendiente"}</span></p> : null}
    </> : <>
      <span className={`route-collection-tag${view === "work" ? ` route-collection-action route-collection-action--${item.managementType ?? "solo_cobrar"}` : ""}`}
        aria-label={view === "work" ? `Acción solicitada: ${fieldManagementLabel(item.managementType)}` : undefined}>
        {view === "work" ? fieldManagementLabel(item.managementType) : view === "partial" ? "Decisión pendiente" : partial && acknowledged ? "Debe pagar más" : fieldManagementLabel(item.managementType)}
      </span>
      <div className="route-collection-amount-row">
        <p className="route-collection-amount">{view === "partial" ? `Pagó ${formatCurrency(paidRent)}` : item.releaseAmount > 0 ? formatCurrency(remaining) : "Monto pendiente"}</p>
        {view === "work" && props.canEditAmount && !report ? (
          <button type="button" className="route-collection-amount-edit" aria-label={`Editar monto por cobrar de ${item.unitId}`} title="Editar monto por cobrar" disabled={props.amountSaving || saving} onClick={props.onEditAmount}>
            <span aria-hidden="true">✎</span>
          </button>
        ) : null}
      </div>
      <p className="route-collection-context">{view === "partial" ? `Faltan ${formatCurrency(remaining)} para liberar` : partial && acknowledged ? "Pendiente para liberar · Debe pagar más" : view === "work" ? "Para liberar" : "Pendiente para liberar"}</p>
      </>}
    </div>

    {view !== "work" ? <>
      {canEdit && !report ? <label className="route-collection-field route-collection-comment">Comentario<input aria-label={`Comentario de ${item.unitId}`} value={props.comment} maxLength={25} placeholder="Agregar comentario…" disabled={props.commentSaving} onChange={event => props.onComment(event.target.value)} onBlur={props.onSaveComment} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }} /></label> : item.comment ? <p className={savedCommentClassName}><small>Comentario</small>{item.comment}</p> : null}
    </> : item.comment ? <p className={savedCommentClassName}>{props.highlightComments ? <small>Comentario</small> : null}{item.comment}</p> : null}
    {props.managementFields ? listLayout ? <div className="route-collection-management">{props.managementFields}</div> : props.managementFields : null}
    {view === "work" ? <div className="route-collection-meta">
      <label className="route-collection-zone-field"><span>Zona</span>
      <input className="route-collection-zone-inline" aria-label={`Zona de ${item.unitId}`} title="Editar zona" list={zoneListId}
        value={props.zone} maxLength={40} placeholder="Sin zona" disabled={Boolean(report) || props.zoneSaving}
        style={{ width: `${Math.max(14, Math.min((props.zone || "Sin zona").length + 6, 32))}ch` }}
        onChange={event => props.onZone(event.target.value)} onBlur={props.onSaveZone}
        onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }} /></label>
      {props.showAssignedDelta !== false ? <span>{item.assignedDelta === "delta1" ? "Delta 1" : item.assignedDelta === "delta2" ? "Delta 2" : item.assignedDelta === "delta3" ? "Delta 3" : "Sin asignar"}</span> : null}
    </div> : null}
    {view === "work" ? <div className="route-collection-route-time route-collection-route-time--progressive" title={`Desde ${formatRouteDateTime(item.publishedAt)}`}
      aria-label={`${urgencyLabel || "En tiempo"}. ${routeElapsedSince(item.publishedAt, props.elapsedNow)} en ruta desde ${formatRouteDateTime(item.publishedAt)}`}>
      <span className="route-collection-time-duration"><small>Tiempo en ruta</small><strong>{routeElapsedSince(item.publishedAt, props.elapsedNow)}</strong></span>
      <em>{urgencyLabel || "En tiempo"}</em>
    </div> : null}
    <div className="route-collection-actions">
      {view === "confirmed" && report && props.hasReceipt ? <button type="button" className="button primary" disabled={props.receiptLoading} onClick={props.onReceipt}>{props.receiptLoading ? "Abriendo…" : "Ver recibo"}</button> : null}
      {view === "partial" && canRemove && !acknowledged ? <button type="button" className="button primary" disabled={saving} onClick={props.onKeep}>Debe pagar más</button> : null}
      {view === "review" && report && props.canConfirmBank ? <button type="button" className="button primary" disabled={saving || props.bankConfirmationSaving} onClick={props.onConfirmBank}>{props.bankConfirmationSaving ? "Confirmando…" : "Confirmado en banco"}</button> : null}
      {view === "work" && props.hasActiveRoute && ((props.canDeclareCustody && !item.inCustody) || (canRemove && !report)) ? <details className="route-collection-more-actions"><summary>Más acciones</summary><div>
      {view === "work" && props.canDeclareCustody && props.hasActiveRoute && !item.inCustody ? <button type="button" className="button ghost" disabled={saving} onClick={props.onCustody}>Declarar carro en custodia</button> : null}
      {canRemove && props.hasActiveRoute && !report ? <button type="button" className="button ghost route-collection-remove" disabled={saving} onClick={props.onRemove}>Sacar de ruta</button> : null}
      </div></details> : null}

      {view === "custody" && canReport ? <button type="button" className="button primary" disabled={saving} onClick={props.onCustody}>Sacar de custodia</button> : null}

        {props.canReturnReport ? <button type="button" className="button ghost" disabled={saving} onClick={props.onReturnReport}>No confirmado</button> : null}
      {view !== "work" && canRemove && props.hasActiveRoute && (!report || view === "partial") ? <button type="button" className="button ghost route-collection-remove" disabled={saving} onClick={props.onRemove}>Sacar de ruta</button> : null}
    </div>
    {view === "work" && (props.showAssignedDelta !== false || (canEdit && !report)) ? <details className="route-collection-edit"><summary>{props.showAssignedDelta !== false ? "Asignación y comentario" : "Comentario"}</summary><div className="route-collection-edit-fields">
    {props.showAssignedDelta !== false ? (
      props.canEditAssignedDelta ? <label className="route-collection-field route-collection-delta">
        Responsable de búsqueda
        <select aria-label={`Buscador asignado a ${item.unitId}`} value={item.assignedDelta ?? ""}
          disabled={props.changingAssignedDelta || saving}
          onChange={event => props.onAssignedDelta(event.target.value as "delta1" | "delta2" | "delta3")}>
          {!item.assignedDelta ? <option value="">Sin asignar</option> : null}
          <option value="delta1">Delta 1</option>
          <option value="delta2">Delta 2</option>
          <option value="delta3">Delta 3</option>
        </select>
      </label> : <p className="route-collection-delta-badge">
        <small>Responsable de búsqueda</small>
        <strong>{item.assignedDelta === "delta1" ? "Delta 1" : item.assignedDelta === "delta2" ? "Delta 2" : item.assignedDelta === "delta3" ? "Delta 3" : "Sin asignar"}</strong>
      </p>
    ) : null}
      {canEdit && !report ? <label className="route-collection-field route-collection-comment">Comentario<input aria-label={`Comentario de ${item.unitId}`} value={props.comment} maxLength={25} placeholder="Agregar comentario…" disabled={props.commentSaving} onChange={event => props.onComment(event.target.value)} onBlur={props.onSaveComment} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }} /></label> : item.comment ? <p className={savedCommentClassName}><small>Comentario</small>{item.comment}</p> : null}
    </div></details> : null}
    <details className="route-collection-details" onToggle={event => setDetailsOpen(event.currentTarget.open)}>
      <summary>Datos del auto</summary>
      {detailsOpen && props.dataOwnerUserId ? <RouteVehicleDetails key={`${props.dataOwnerUserId}:${item.clientId}:${item.publishedAt}:${props.managementVersion ?? "legacy"}`}
        ownerId={props.dataOwnerUserId} clientId={item.clientId} publishedAt={item.publishedAt} version={props.managementVersion ?? "legacy"} /> : null}
      {partial ? <p className="route-collection-context">Pago parcial: {formatCurrency(paidRent)} · Faltan {formatCurrency(remaining)}{acknowledged ? <><br />Decisión: Debe pagar más</> : null}</p> : null}
      {props.bankNotices.map(notice => <p className="route-collection-context" key={notice.id}>Por confirmar banca: {formatCurrency(notice.amount)}{notice.collectionTeam ? ` · Equipo ${notice.collectionTeam}` : ""}</p>)}
      {report ? <div className={`route-search-report-status ${report.status === "confirmed" ? "route-search-report-status--confirmed" : ""}`}>
        <strong>{acceptedBankSavings ? "Pago confirmado con diferencia aceptada" : report.status === "confirmed" ? "Pago confirmado" : "Pago reportado · Pendiente de confirmar"}</strong>
        <span>{formatCurrency(report.amount)} · {report.method === "mixed" ? "Mixto" : report.method === "cash" ? "Efectivo" : "Banca"}</span>
        <span>Reportado por {report.reporter_name} · {formatRouteDateTime(report.reported_at)}</span>
        {report.bank_confirmed_visually_at ? <span>Confirmado visualmente en banco · {formatRouteDateTime(report.bank_confirmed_visually_at)}</span> : report.confirmed_at ? <span>Confirmado · {formatRouteDateTime(report.confirmed_at)}</span> : null}
      </div> : null}
    </details>
  </article>;
}
