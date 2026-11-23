import { useMemo, useState } from "react";
import { formatCurrency } from "../format";
import { routeDeltaLabel, type RouteManagedAction, type RouteManagedActionKind } from "../routeDeltaTracking";
import { formatRouteDateTime } from "../routeTimeUrgency";
import "./routeManagedCompactList.css";

type ResultFilter = "all" | RouteManagedActionKind;
type MethodFilter = "all" | "cash" | "bank";
type Props = {
  actions: RouteManagedAction[];
  receiptLoadingId?: string | null;
  onReceipt: (action: RouteManagedAction) => void;
};

const RESULTS = [
  { value: "all", label: "Todos" },
  { value: "paid", label: "Cobrado" },
  { value: "remote", label: "Gestión remota" },
  { value: "custody", label: "En custodia" }
] as const;

const METHODS = [
  { value: "all", label: "Todos" },
  { value: "cash", label: "Efectivo" },
  { value: "bank", label: "Transferencia" }
] as const;

function matchesMethod(action: RouteManagedAction, method: MethodFilter): boolean {
  return method === "all" || (method === "cash" ? action.cashAmount > 0 : action.bankAmount > 0);
}

function resultLabel(kind: RouteManagedActionKind): string {
  return RESULTS.find(result => result.value === kind)!.label;
}

function paymentMethod(action: RouteManagedAction, methodFilter: MethodFilter): string {
  if (action.kind === "custody") return "Captación registrada";
  const method = methodFilter === "cash" ? "Efectivo" : methodFilter === "bank" ? "Transferencia"
    : action.cashAmount > 0 && action.bankAmount > 0 ? "Efectivo y transferencia"
    : action.bankAmount > 0 ? "Transferencia" : "Efectivo";
  return `${method} · ${action.outsideRoute ? "Fuera de ruta" : "En ruta"}`;
}

export default function RouteManagedCompactList({ actions, receiptLoadingId, onReceipt }: Props) {
  const [resultFilter, setResultFilter] = useState<ResultFilter>("all");
  const [methodFilter, setMethodFilter] = useState<MethodFilter>("all");
  const summary = useMemo(() => ({
    cash: actions.reduce((total, action) => total + Math.round(action.cashAmount * 100), 0) / 100,
    bank: actions.reduce((total, action) => total + Math.round(action.bankAmount * 100), 0) / 100,
    counts: {
      all: actions.length,
      paid: actions.filter(action => action.kind === "paid").length,
      remote: actions.filter(action => action.kind === "remote").length,
      custody: actions.filter(action => action.kind === "custody").length
    }
  }), [actions]);
  const methodCounts = useMemo(() => {
    const paid = actions.filter(action => action.kind === "paid");
    return { all: paid.length, cash: paid.filter(action => action.cashAmount > 0).length,
      bank: paid.filter(action => action.bankAmount > 0).length };
  }, [actions]);
  const visibleActions = useMemo(() => actions.filter(action => (resultFilter === "all" || action.kind === resultFilter)
    && (resultFilter !== "paid" || matchesMethod(action, methodFilter))), [actions, resultFilter, methodFilter]);

  return <section className="route-managed-compact" aria-label="Lista compacta de gestionados hoy">
    <div className="route-managed-compact-summary" aria-label="Resumen de todas las gestiones visibles de hoy">
      <div className="route-managed-compact-total"><span>Total de hoy</span><strong>{formatCurrency(summary.cash + summary.bank)}</strong></div>
      <div className="route-managed-compact-totals">
        <div><span>Efectivo</span><strong>{formatCurrency(summary.cash)}</strong></div>
        <div><span>Transferencia</span><strong>{formatCurrency(summary.bank)}</strong></div>
      </div>
    </div>
    <div className="route-managed-result-filters" role="group" aria-label="Filtrar gestionados por resultado">
      {RESULTS.map(result => <button type="button" key={result.value}
        className={`button small ${resultFilter === result.value ? "primary" : "ghost"}`}
        aria-pressed={resultFilter === result.value} onClick={() => { setResultFilter(result.value); setMethodFilter("all"); }}>
        {result.label} <span>({summary.counts[result.value]})</span>
      </button>)}
    </div>
    {resultFilter === "paid" ? <div className="route-managed-method-section">
      <span>Método de pago</span>
      <div className="route-managed-method-filters" role="group" aria-label="Filtrar cobrados por método">
        {METHODS.map(method => <button type="button" key={method.value}
          className={`button small ${methodFilter === method.value ? "primary" : "ghost"}`}
          aria-pressed={methodFilter === method.value} onClick={() => setMethodFilter(method.value)}>
          {method.label} <span>({methodCounts[method.value]})</span>
        </button>)}
      </div>
    </div> : null}
    <p className="route-managed-compact-count" role="status">Mostrando {visibleActions.length} de {actions.length} registros</p>
    {visibleActions.length === 0 ? <div className="route-search-empty">{actions.length === 0
      ? "No hay carros gestionados hoy con estos filtros."
      : "No hay gestiones con este resultado. Selecciona otro resultado para continuar."}</div>
      : <div className="route-managed-compact-rows">
        {visibleActions.map(action => {
          const displayedMethod = resultFilter === "paid" ? methodFilter : "all";
          const displayedAmount = displayedMethod === "cash" ? action.cashAmount : displayedMethod === "bank" ? action.bankAmount : action.cashAmount + action.bankAmount;
          const hasReceipt = Boolean(action.payment || action.report?.confirmed_payment_id
            || action.report?.bank_settled_payment_id || (action.report?.confirmed_cash_amount ?? 0) > 0);
          const receiptBusy = Boolean(action.report && receiptLoadingId === action.report.id);
          return <article className="route-managed-compact-row" key={action.id} aria-label={`${action.unitId} · ${action.clientName}`}>
            <div className="route-managed-compact-row-head">
              <div className="route-managed-compact-identity"><strong>{action.unitId}</strong><span>{action.clientName}</span></div>
              <div className="route-managed-compact-outcome">
                <span className={`route-managed-compact-status route-managed-compact-status--${action.kind}`}>{resultLabel(action.kind)}</span>
                {action.kind !== "custody" ? <strong>{formatCurrency(displayedAmount)}</strong> : null}
              </div>
            </div>
            <div className="route-managed-compact-row-bottom"><span>{paymentMethod(action, displayedMethod)}</span>
              <details className="route-managed-compact-record"><summary>Ver registro</summary>
                <div className="route-managed-compact-record-body">
                  <p>{routeDeltaLabel(action.delta)} · <time dateTime={action.occurredAt}>{formatRouteDateTime(action.occurredAt)}</time></p>
                  {action.kind !== "custody" ? <p>Efectivo {formatCurrency(action.cashAmount)} · Transferencia {formatCurrency(action.bankAmount)}</p> : null}
                  {!action.outsideRoute && action.routeAssignment ? <p>Ruta {action.routeAssignment}</p> : null}
                  {action.actionCount > 1 ? <p>{action.actionCount} movimientos consolidados</p> : null}
                  {action.payment?.receiptNumber ? <p>Recibo {action.payment.receiptNumber}</p> : null}
                  {hasReceipt ? <button type="button" className="button ghost small" disabled={receiptBusy} onClick={() => onReceipt(action)}>{receiptBusy ? "Abriendo…" : "Ver recibo"}</button> : null}
                </div>
              </details>
            </div>
          </article>;
        })}
      </div>}
  </section>;
}
