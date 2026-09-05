import { useMemo } from "react";
import { formatCurrency } from "../format";
import type { Payment } from "../types";
import { buildPendingCashRowsByTeam, getIncomeDate } from "./payments/dailyIncomeRules";

type Props = { payments: Payment[]; dateKey: string; loading?: boolean };

export default function RoutePendingCashPanel({ payments, dateKey, loading = false }: Props) {
  // La misma lista compartida de pagos que recibe Ingresos del día.
  const pending = useMemo(() => buildPendingCashRowsByTeam(payments, dateKey), [payments, dateKey]);

  return <section className="route-pending-cash" aria-label="Efectivo pendiente de entrega">
    <div className="route-pending-cash-heading">
      <strong>Falta entregar</strong>
    </div>
    {loading ? <p role="status">Cargando pagos…</p> : <div className="route-pending-cash-teams">
      {(["WC", "PTY"] as const).map((team) => {
        const rows = [...pending[team]].sort((a, b) => getIncomeDate(a).localeCompare(getIncomeDate(b)) || a.id.localeCompare(b.id));
        const cents = rows.reduce((sum, payment) => sum + Math.round(payment.amountReceived * 100), 0);
        return <details key={team} className="route-pending-cash-team">
          <summary aria-label={`Equipo ${team}: ${formatCurrency(cents / 100)}, ${rows.length} recibos pendientes`}><span>{team}</span><span aria-hidden="true">—</span><strong>{formatCurrency(cents / 100)}</strong></summary>
          {rows.length === 0 ? <p>Sin efectivo pendiente de entrega.</p> : <ul>
            {rows.map((payment) => <li key={payment.id}>
              <div><strong>{payment.clientUnit} · {payment.clientName}</strong><span>{payment.receiptNumber} · {getIncomeDate(payment).split("-").reverse().join("/")}</span></div>
              <strong>{formatCurrency(payment.amountReceived)}</strong>
            </li>)}
          </ul>}
        </details>;
      })}
    </div>}
  </section>;
}
