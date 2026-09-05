import { useId } from "react";
import type { ActiveRouteItem } from "../cloudData";
import type { RoutePaymentReport } from "../cloud/routeReportCloudData";
import { formatCurrency } from "../format";
import { isPendingCashRouteReport } from "../routeReviewRules";
import { fieldManagementLabel } from "./receivables/receivablesTypes";

export type RouteWorkflowView = "work" | "review" | "partial" | "confirmed" | "custody";
export type RouteCardItem = ActiveRouteItem & { report?: RoutePaymentReport };

type Props = {
  item: RouteCardItem;
  view: RouteWorkflowView;
  paidRent: number;
  balance: number;
  canReport: boolean;
  canEdit: boolean;
  canRemove: boolean;
  canRegister: boolean;
  hasReport: boolean;
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
  onRoute: (route: "WC" | "PTY") => void;
};

function when(value?: string): string {
  if (!value) return "";
  return new Date(value).toLocaleString("es-PA", { timeZone: "America/Panama", dateStyle: "short", timeStyle: "short" });
}

export default function RouteCollectionCard(props: Props) {
  const zoneListId = useId();
  const { item, view, paidRent, balance, canReport, canEdit, canRemove, canRegister, saving } = props;
  const report = item.report;
  const remaining = Math.max(0, item.releaseAmount - paidRent);
  const partial = paidRent > 0 && remaining > 0;
  const acknowledged = typeof item.partialDecisionRentAmount === "number" && Math.abs(item.partialDecisionRentAmount - paidRent) < 0.005;
  const pendingCash = view === "review" && isPendingCashRouteReport(report);
  const tone = view === "custody" ? "custody" : view === "confirmed" ? "confirmed" : pendingCash || view === "partial" ? "attention" : "normal";
  return <article className={`route-search-card route-collection-card route-collection-card--${tone}`} aria-label={`${item.unitId} · ${item.clientName}`}>
    <div className="route-collection-identity">
      <h2>{item.unitId} <span>· {item.clientName.trim().split(/\s+/)[0]}</span></h2>
      <span className="route-collection-route">{item.routeAssignment || "Sin ruta"}</span>
    </div>
    {item.urgency && item.urgency !== "normal" && (view === "work" || view === "partial") ? <span className="route-collection-tag route-collection-tag--urgent">{item.urgency === "very_urgent" ? "Muy urgente" : "Urgente"}</span> : null}
    {view === "custody" ? <>
      <span className="route-collection-tag">Vehículo en custodia</span>
      <p className="route-collection-context">Desde {when(item.custodySince)}</p>
    </> : report && (view === "review" || view === "confirmed") ? <>
      <span className={`route-collection-tag ${view === "confirmed" ? "route-collection-tag--confirmed" : ""}`}>{view === "confirmed" ? "Pago confirmado" : report.method === "cash" ? "Efectivo" : report.method === "mixed" ? "Pago mixto por confirmar" : "Banca por confirmar"}</span>
      <p className="route-collection-amount">{report.method === "cash" || view === "confirmed" ? "Pagó" : "Reportó"} {formatCurrency(report.amount)}</p>
      {report.method === "mixed" ? <p className="route-collection-context"><span>Efectivo: {formatCurrency(report.cash_amount)} · {report.confirmed_cash_amount >= report.cash_amount ? "Confirmado" : "Pendiente"}</span><br /><span>Banca: {formatCurrency(report.bank_amount)} · {report.confirmed_bank_amount >= report.bank_amount ? "Confirmado" : "Pendiente"}</span></p> : null}
    </> : <>
      <span className="route-collection-tag">{view === "partial" ? "Decisión pendiente" : partial && acknowledged ? "Debe pagar más" : "Por cobrar"}</span>
      <p className="route-collection-amount">{view === "partial" ? `Pagó ${formatCurrency(paidRent)}` : item.releaseAmount > 0 ? formatCurrency(remaining) : "Monto pendiente"}</p>
      <p className="route-collection-context">{view === "partial" ? `Faltan ${formatCurrency(remaining)} para liberar` : "Pendiente para liberar"}</p>
      {view === "work" ? <p className="route-collection-instruction">{fieldManagementLabel(item.managementType)}</p> : null}
    </>}
    <div className="route-collection-actions">
      {pendingCash && canRegister ? <button type="button" className="button primary" disabled={saving} onClick={props.onRegister}>Generar recibo</button> : null}
      {view === "confirmed" && report ? <button type="button" className="button primary" disabled={props.receiptLoading} onClick={props.onReceipt}>{props.receiptLoading ? "Abriendo…" : "Ver recibo"}</button> : null}
      {view === "partial" && canRemove && !acknowledged ? <button type="button" className="button primary" disabled={saving} onClick={props.onKeep}>Debe pagar más</button> : null}
      {view === "work" && canReport && !props.hasReport ? <button type="button" className="button primary" disabled={props.reportDisabled || saving} onClick={props.onReport}>Reportar que pagó</button> : null}
      {view === "work" && canRegister ? <button type="button" className="button ghost" disabled={saving} onClick={props.onRegister}>Registrar pago</button> : null}
      {view === "custody" && canReport ? <button type="button" className="button primary" disabled={saving} onClick={props.onCustody}>Sacar de custodia</button> : null}
      {view !== "confirmed" && view !== "custody" && canReport && props.hasActiveRoute && !item.inCustody ? <button type="button" className="button ghost" disabled={saving} onClick={props.onCustody}>Vehículo en custodia</button> : null}
    </div>
    <details className="route-collection-details">
      <summary>Ver detalles</summary>
      <dl><dt>Cliente</dt><dd>{item.clientName}</dd><dt>Mínimo para liberar</dt><dd>{formatCurrency(item.releaseAmount)}</dd><dt>Saldo vencido</dt><dd>{formatCurrency(balance)}</dd><dt>Atraso</dt><dd>{item.daysLate} días</dd><dt>En ruta</dt><dd>{when(item.publishedAt)}</dd></dl>
      {partial ? <p className="route-collection-context">Pago parcial: {formatCurrency(paidRent)} · Faltan {formatCurrency(remaining)}{acknowledged ? <><br />Decisión: Debe pagar más</> : null}</p> : null}
      {canReport && !report && (item.routeAssignment === "WC" || item.routeAssignment === "PTY") ? <label>Ruta<select aria-label={`Ruta de ${item.unitId}`} value={item.routeAssignment} disabled={props.changingRoute} onChange={event => props.onRoute(event.target.value as "WC" | "PTY")}><option value="WC">WC</option><option value="PTY">PTY</option></select></label> : null}
      <label>Zona<input aria-label={`Zona de ${item.unitId}`} list={zoneListId} value={props.zone} maxLength={40} disabled={Boolean(report) || props.zoneSaving} onChange={event => props.onZone(event.target.value)} onBlur={props.onSaveZone} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }} /></label>
      <datalist id={zoneListId}>{props.zoneOptions.map(zone => <option key={zone} value={zone} />)}</datalist>
      {canEdit && !report ? <label>Comentario<input aria-label={`Comentario de ${item.unitId}`} value={props.comment} maxLength={25} disabled={props.commentSaving} onChange={event => props.onComment(event.target.value)} onBlur={props.onSaveComment} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }} /></label> : item.comment ? <p>{item.comment}</p> : null}
      {props.bankNotices.map(notice => <p className="route-collection-context" key={notice.id}>Por confirmar banca: {formatCurrency(notice.amount)}{notice.collectionTeam ? ` · Equipo ${notice.collectionTeam}` : ""}</p>)}
      {report ? <div className="route-search-report-status">
        <strong>{report.status === "confirmed" ? "Pago confirmado" : "Pago reportado · Pendiente de confirmar"}</strong>
        <span>{formatCurrency(report.amount)} · {report.method === "mixed" ? "Mixto" : report.method === "cash" ? "Efectivo" : "Banca"}</span>
        <span>Reportado por {report.reporter_name} · {when(report.reported_at)}</span>
        {report.confirmed_at ? <span>Confirmado · {when(report.confirmed_at)}</span> : null}
        {props.canReturnReport ? <button type="button" className="button ghost" disabled={saving} onClick={props.onReturnReport}>Devolver a Trabajo</button> : null}
      </div> : null}
      {canRemove && (!report || view === "partial") && view !== "custody" ? <button type="button" className="button ghost route-collection-remove" disabled={saving} onClick={props.onRemove}>Sacar de ruta</button> : null}
    </details>
  </article>;
}
