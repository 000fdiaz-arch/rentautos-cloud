import { useId } from "react";
import type { ActiveRouteItem } from "../cloudData";
import type { RoutePaymentReport } from "../cloud/routeReportCloudData";
import { formatCurrency } from "../format";
import { isPendingCashRouteReport } from "../routeReviewRules";
import { effectiveRouteUrgency, formatRouteDateTime, routeUrgencyLabel, routeVisualRedIntensity } from "../routeTimeUrgency";
import { fieldManagementLabel } from "./receivables/receivablesTypes";
import "./routeTimeUrgency.css";

export type RouteWorkflowView = "work" | "review" | "partial" | "confirmed" | "custody";
export type RouteCardItem = ActiveRouteItem & { report?: RoutePaymentReport };

type Props = {
  managementFields?: React.ReactNode;
  item: RouteCardItem;
  view: RouteWorkflowView;
  paidRent: number;
  balance: number;
  travelFundBalance: number;
  canReport: boolean;
  canEdit: boolean;
  canRemove: boolean;
  canRegister: boolean;
  hasPendingReport: boolean;
  hasActiveRoute: boolean;
  reportDisabled: boolean;
  saving: boolean;
  receiptLoading: boolean;
  zone: string;
  zoneOptions: string[];
  zoneSaving: boolean;
  comment: string;
  commentSaving: boolean;
  changingRoute: boolean;
  routeOptions: string[];
  inactiveSaving: boolean;
  elapsedNow: number;
  canReturnReport: boolean;
  bankNotices: Array<{ id: string; amount: number; collectionTeam?: string }>;
  onReport: () => void;
  onRegister: () => void;
  onReceipt: () => void;
  onCustody: () => void;
  onRemove: () => void;
  onKeep: () => void;
  onReturnReport: () => void;
  onZone: (value: string) => void;
  onSaveZone: () => void;
  onComment: (value: string) => void;
  onSaveComment: () => void;
  onRoute: (route: string) => void;
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
  const { item, view, paidRent, balance, canReport, canEdit, canRemove, canRegister, saving } = props;
  const report = item.report;
  const remaining = Math.max(0, item.releaseAmount - paidRent);
  const partial = paidRent > 0 && remaining > 0;
  const acknowledged = typeof item.partialDecisionRentAmount === "number" && Math.abs(item.partialDecisionRentAmount - paidRent) < 0.005;
  const pendingCash = view === "review" && isPendingCashRouteReport(report);
  const acceptedBankSavings = report && view === "confirmed"
    && report.confirmed_bank_savings_amount > 0
    && report.confirmed_bank_received_amount > 0
    && Math.abs(report.confirmed_bank_received_amount - report.confirmed_bank_savings_amount - report.bank_amount) < 0.005;
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
  return <article style={routeTimeStyle} className={`route-search-card route-collection-card route-collection-card--${tone}${urgencyClass}${item.routeInactiveAt && view === "work" ? " route-collection-card--inactive" : ""}`} aria-label={`${item.unitId} · ${item.clientName}`}>
    <div className="route-collection-identity">
      <div>
        <h2>{item.unitId} <span>· {item.clientName.trim().split(/\s+/)[0]}</span></h2>
        {view === "work" ? <div className="route-collection-route-time route-collection-route-time--progressive" aria-label={`${urgencyLabel || "En tiempo"}. ${routeElapsedSince(item.publishedAt, props.elapsedNow)} en ruta desde ${formatRouteDateTime(item.publishedAt)}`}>
          <span><small>Tiempo en ruta</small><strong>{routeElapsedSince(item.publishedAt, props.elapsedNow)}</strong></span>
          <em>{urgencyLabel || "En tiempo"}</em>
          <small>Desde {formatRouteDateTime(item.publishedAt)}</small>
        </div> : <span className="route-collection-route-time" title={`Desde ${formatRouteDateTime(item.publishedAt)}`} aria-label={`Tiempo en ruta de ${item.unitId}: ${routeElapsedSince(item.publishedAt, props.elapsedNow)}`}>⏱ En ruta · {routeElapsedSince(item.publishedAt, props.elapsedNow)}</span>}
      </div>
      {canReport && !report ? (
        <select className="route-collection-route route-collection-route-picker" aria-label={`Ruta de ${item.unitId}`} value={(item.routeAssignment ?? "").trim().toUpperCase()} disabled={props.changingRoute || saving} onChange={event => {
          if (event.target.value === "__create_route__") {
            props.onCreateRoute();
            return;
          }
          props.onRoute(event.target.value);
        }}>
          {!item.routeAssignment ? <option value="">Sin ruta</option> : null}
          {props.routeOptions.map((route) => <option key={route} value={route}>{route}</option>)}
          <option value="__create_route__">+ Nueva ruta</option>
        </select>
      ) : <span className="route-collection-route">{item.routeAssignment || "Sin ruta"}</span>}
    </div>
    {view === "work" && props.travelFundBalance > 0 ? (
      <div className="route-collection-travel-fund" aria-label={`Fondo de viaje disponible: ${formatCurrency(props.travelFundBalance)}`}>
        <span aria-hidden="true">✈</span>
        <span>Fondo de viaje disponible</span>
        <strong>{formatCurrency(props.travelFundBalance)}</strong>
      </div>
    ) : null}
      <label className="route-collection-field">Zona<input aria-label={`Zona de ${item.unitId}`} list={zoneListId} value={props.zone} maxLength={40} placeholder="Sin zona" disabled={Boolean(report) || props.zoneSaving} onChange={event => props.onZone(event.target.value)} onBlur={props.onSaveZone} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }} /></label>
      <datalist id={zoneListId}>{props.zoneOptions.map(zone => <option key={zone} value={zone} />)}</datalist>
    {view === "work" && item.routeInactiveAt ? <div className="route-collection-inactive" aria-label={`Estado inactivo de ${item.unitId}`}>
      <strong>Inactivo · no está encendido</strong>
      <span>Declarado {formatRouteDateTime(item.routeInactiveAt)}</span>
      <b>{elapsedSince(item.routeInactiveAt, props.elapsedNow)}</b>
    </div> : null}
    {view === "custody" ? <>
      <span className="route-collection-tag">Vehículo en custodia</span>
      <p className="route-collection-context">Desde {formatRouteDateTime(item.custodySince)}</p>
    </> : report && (view === "review" || view === "confirmed") ? <>
      <span className={`route-collection-tag ${view === "confirmed" ? "route-collection-tag--confirmed" : ""}`}>{acceptedBankSavings ? "Pago confirmado con diferencia" : view === "confirmed" ? "Pago confirmado" : pendingCash && report.bank_amount <= report.confirmed_bank_amount ? "Efectivo pendiente" : report.method === "cash" ? "Efectivo pendiente" : report.method === "mixed" ? "Pago mixto por confirmar" : "Banca por confirmar"}</span>
      <p className="route-collection-amount">{report.method === "cash" || view === "confirmed" ? "Pagó" : "Reportó"} {formatCurrency(report.amount)}</p>
      {acceptedBankSavings ? <div className="route-collection-accepted-difference" aria-label="Diferencia bancaria aceptada">
        <span>Reportó <strong>{formatCurrency(report.amount)}</strong></span>
        <span>Recibido <strong>{formatCurrency(confirmedReceivedAmount)}</strong></span>
        <b>{formatCurrency(report.confirmed_bank_savings_amount)} aplicado a ahorro</b>
        <small>Coincide con unidad, fecha y método bancario</small>
      </div> : null}
      {report.method === "mixed" ? <p className="route-collection-context"><span>Efectivo: {formatCurrency(report.cash_amount)} · {report.confirmed_cash_amount >= report.cash_amount ? "Confirmado" : "Pendiente"}</span><br /><span>Banca: {formatCurrency(report.bank_amount)} · {report.confirmed_bank_amount >= report.bank_amount ? "Confirmado" : "Pendiente"}</span></p> : null}
    </> : <>
      <span className="route-collection-tag">{view === "partial" ? "Decisión pendiente" : partial && acknowledged ? "Debe pagar más" : "Por cobrar"}</span>
      <p className="route-collection-amount">{view === "partial" ? `Pagó ${formatCurrency(paidRent)}` : item.releaseAmount > 0 ? formatCurrency(remaining) : "Monto pendiente"}</p>
      <p className="route-collection-context">{view === "partial" ? `Faltan ${formatCurrency(remaining)} para liberar` : "Pendiente para liberar"}</p>
      {view === "work" ? <p className="route-collection-instruction">{fieldManagementLabel(item.managementType)}</p> : null}
    </>}
      {canEdit && !report ? <label className="route-collection-field route-collection-comment">Comentario<input aria-label={`Comentario de ${item.unitId}`} value={props.comment} maxLength={25} placeholder="Agregar comentario…" disabled={props.commentSaving} onChange={event => props.onComment(event.target.value)} onBlur={props.onSaveComment} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }} /></label> : item.comment ? <p>{item.comment}</p> : null}
    {props.managementFields}
    <div className="route-collection-actions">
      {pendingCash && canRegister ? <button type="button" className="button primary" disabled={saving} onClick={props.onRegister}>Generar recibo</button> : null}
      {view === "confirmed" && report ? <button type="button" className="button primary" disabled={props.receiptLoading} onClick={props.onReceipt}>{props.receiptLoading ? "Abriendo…" : "Ver recibo"}</button> : null}
      {view === "partial" && canRemove && !acknowledged ? <button type="button" className="button primary" disabled={saving} onClick={props.onKeep}>Debe pagar más</button> : null}
      {view === "work" && canReport && !props.hasPendingReport ? <button type="button" className="button primary" disabled={props.reportDisabled || saving} onClick={props.onReport}>Notificar pago</button> : null}
      {view === "work" && canReport && !report ? <button type="button" className={`button ${item.routeInactiveAt ? "route-collection-inactive-action" : "ghost"}`} disabled={props.inactiveSaving || saving} onClick={props.onInactive}>{props.inactiveSaving ? "Guardando…" : item.routeInactiveAt ? "Marcar como disponible" : "Marcar Inactivo"}</button> : null}
      {view === "custody" && canReport ? <button type="button" className="button primary" disabled={saving} onClick={props.onCustody}>Sacar de custodia</button> : null}
      {view !== "confirmed" && view !== "custody" && canReport && props.hasActiveRoute && !item.inCustody ? <button type="button" className="button ghost" disabled={saving} onClick={props.onCustody}>Vehículo en custodia</button> : null}
        {props.canReturnReport ? <button type="button" className="button ghost" disabled={saving} onClick={props.onReturnReport}>Devolver a Trabajo</button> : null}
      {canRemove && (!report || view === "partial") && view !== "custody" ? <button type="button" className="button ghost route-collection-remove" disabled={saving} onClick={props.onRemove}>Sacar de ruta</button> : null}
    </div>
    <details className="route-collection-details">
      <summary>Ver detalles</summary>
      <dl><dt>Cliente</dt><dd>{item.clientName}</dd><dt>Mínimo para liberar</dt><dd>{formatCurrency(item.releaseAmount)}</dd><dt>Saldo vencido</dt><dd>{formatCurrency(balance)}</dd><dt>Atraso</dt><dd>{item.daysLate} días</dd><dt>En ruta</dt><dd>{formatRouteDateTime(item.publishedAt)}</dd></dl>
      {partial ? <p className="route-collection-context">Pago parcial: {formatCurrency(paidRent)} · Faltan {formatCurrency(remaining)}{acknowledged ? <><br />Decisión: Debe pagar más</> : null}</p> : null}
      {props.bankNotices.map(notice => <p className="route-collection-context" key={notice.id}>Por confirmar banca: {formatCurrency(notice.amount)}{notice.collectionTeam ? ` · Equipo ${notice.collectionTeam}` : ""}</p>)}
      {report ? <div className={`route-search-report-status ${report.status === "confirmed" ? "route-search-report-status--confirmed" : ""}`}>
        <strong>{acceptedBankSavings ? "Pago confirmado con diferencia aceptada" : report.status === "confirmed" ? "Pago confirmado" : "Pago reportado · Pendiente de confirmar"}</strong>
        <span>{formatCurrency(report.amount)} · {report.method === "mixed" ? "Mixto" : report.method === "cash" ? "Efectivo" : "Banca"}</span>
        <span>Reportado por {report.reporter_name} · {formatRouteDateTime(report.reported_at)}</span>
        {report.confirmed_at ? <span>Confirmado · {formatRouteDateTime(report.confirmed_at)}</span> : null}
      </div> : null}
    </details>
  </article>;
}
