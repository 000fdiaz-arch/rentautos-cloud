import { formatCurrency } from "../format";
import { routeDeltaLabel, type RouteManagedAction } from "../routeDeltaTracking";
import { formatRouteDateTime } from "../routeTimeUrgency";

type Props = {
  actions: RouteManagedAction[];
};

function actionLabel(action: RouteManagedAction): string {
  if (action.kind === "custody") return "En custodia";
  if (action.kind === "absent") return "Ausente";
  return "Cobrado";
}

export default function RouteManagedList({ actions }: Props) {
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
      {action.kind === "paid" ? <div className="route-managed-payment" aria-label={`Pago de ${action.unitId}`}>
        <span><small>Efectivo</small><strong>{action.cashAmount > 0 ? formatCurrency(action.cashAmount) : "—"}</strong></span>
        <span><small>Transferencia</small><strong>{action.bankAmount > 0 ? formatCurrency(action.bankAmount) : "—"}</strong></span>
      </div> : <div className="route-managed-result">
        <strong>{action.kind === "custody" ? "Carro declarado en custodia" : "Unidad marcada como ausente"}</strong>
        <span>{formatRouteDateTime(action.occurredAt)}</span>
      </div>}
      <details className="route-managed-details">
        <summary>Ver registro</summary>
        <span>Gestionado por {routeDeltaLabel(action.delta)} · {formatRouteDateTime(action.occurredAt)}{action.actionCount > 1 ? ` · ${action.actionCount} movimientos consolidados` : ""}</span>
      </details>
    </article>)}
  </div>;
}
