import { ROUTE_PAYMENT_DECLARATIONS, type RouteDeclarationMethod } from "./OutsideRouteCashDialog";

type Props = { disabled: boolean; onSelect: (method: RouteDeclarationMethod) => void };

export default function RoutePaymentDeclarationActions({ disabled, onSelect }: Props) {
  return <>{(["cash", "bank", "mixed"] as const).map(method => {
    const declaration = ROUTE_PAYMENT_DECLARATIONS[method];
    return <button key={method} type="button"
      className={`button small route-payment-declaration-button route-payment-declaration-button--${method}`}
      aria-label={`${declaration.title}${method === "mixed" ? " (Efectivo+transferencia)" : ""} · ${declaration.badge}`} disabled={disabled} onClick={() => onSelect(method)}>
      <span>{declaration.title}{method === "mixed" ? <small className="route-declaration-method-note">(Efectivo+transferencia)</small> : null}</span><strong className="route-declaration-badge">{declaration.badge}</strong>
    </button>;
  })}</>;
}
