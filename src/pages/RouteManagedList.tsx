import { formatCurrency } from "../format";
import { routeDeltaLabel, type RouteManagedAction } from "../routeDeltaTracking";
import { formatRouteDateTime } from "../routeTimeUrgency";

type Props = {
  actions: RouteManagedAction[];
  deletingId?: string | null;
  outcomeSavingId?: string | null;
  onChangeOutcome?: (action: RouteManagedAction) => void;
  onRequestDelete?: (action: RouteManagedAction) => void;
};

function actionLabel(action: RouteManagedAction): string {
  if (action.kind === "custody") return "En custodia";
  if (action.kind === "remote") return "Gestión remota";
  return "Cobrado";
}

export default function RouteManagedList({ actions, deletingId = null, outcomeSavingId = null, onChangeOutcome, onRequestDelete }: Props) {
  return <div className="route-managed-list" aria-label="Carros gestionados hoy">
    {actions.map((action) => <article className={`route-managed-row route-managed-row--${action.kind}`} key={action.id}>
      <div className="route-managed-identity">
        <strong>{action.unitId}</strong>
        <span>· {action.clientName.trim().split(/\s+/)[0] || action.clientName}</span>
      </div>
      <div className="route-managed-tags">
        <b className={`route-managed-status route-managed-status--${action.kind}`}>{actionLabel(action)}</b>
        <span>Ruta {action.routeAssignment || "Sin ruta"}</span>
        <span>{routeDeltaLabel(action.delta)}</span>
      </div>
      {action.kind === "paid" || action.kind === "remote" ? <div className="route-managed-payment" aria-label={`Pago de ${action.unitId}`}>
        <span><small>Efectivo</small><strong>{action.cashAmount > 0 ? formatCurrency(action.cashAmount) : "—"}</strong></span>
        <span><small>Transferencia</small><strong>{action.bankAmount > 0 ? formatCurrency(action.bankAmount) : "—"}</strong></span>
      </div> : <div className="route-managed-result">
        <strong>Carro declarado en custodia</strong>
        <span>{formatRouteDateTime(action.occurredAt)}</span>
      </div>}
      <div className="route-managed-actions">
        <details className="route-managed-details">
          <summary>Ver registro</summary>
          <span>Gestionado por {routeDeltaLabel(action.delta)} · {formatRouteDateTime(action.occurredAt)}{action.actionCount > 1 ? ` · ${action.actionCount} movimientos consolidados` : ""}</span>
        </details>
        {action.report && onChangeOutcome ? <button type="button" className="button ghost small" disabled={outcomeSavingId === action.id || deletingId === action.id} onClick={() => onChangeOutcome(action)}>
          {outcomeSavingId === action.id ? "Guardando..." : action.kind === "remote" ? "Marcar como cobrado" : "Marcar gestión remota"}
        </button> : null}
        {action.report && onRequestDelete ? <button type="button" className="button danger small" disabled={deletingId === action.id} onClick={() => onRequestDelete(action)}>
          {deletingId === action.id ? "Quitando..." : "Eliminar registro"}
        </button> : null}
      </div>
    </article>)}
  </div>;
}
