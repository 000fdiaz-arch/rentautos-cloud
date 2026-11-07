import { useMemo } from "react";
import { formatCurrency } from "../format";
import { collectionDeltaFromPayment, collectionTeamForDelta } from "../cashTeamRules";
import type { CollectionDelta, CollectionTeam, Payment } from "../types";
import { buildPendingCashRowsByTeam, getIncomeDate } from "./payments/dailyIncomeRules";

type Props = { payments: Payment[]; dateKey: string; loading?: boolean; team?: CollectionTeam; delta?: CollectionDelta };

export default function RoutePendingCashPanel({ payments, dateKey, loading = false, team, delta }: Props) {
  // La misma lista compartida de pagos que recibe Ingresos del día.
  const scopedPayments = useMemo(() => delta
    ? payments.filter((payment) => collectionDeltaFromPayment(payment) === delta)
    : payments, [delta, payments]);
  const pending = useMemo(() => buildPendingCashRowsByTeam(scopedPayments, dateKey), [scopedPayments, dateKey]);
  const visibleTeams: CollectionTeam[] = delta ? [collectionTeamForDelta(delta)] : team ? [team] : ["WC", "PTY"];

  return <section className="route-pending-cash" aria-label="Efectivo pendiente de entrega">
    <div className="route-pending-cash-heading">
      <strong>Falta entregar</strong>
    </div>
    {loading ? <p role="status">Cargando pagos…</p> : <div className="route-pending-cash-teams">
      {visibleTeams.map((visibleTeam) => {
        const rows = [...pending[visibleTeam]].sort((a, b) => getIncomeDate(a).localeCompare(getIncomeDate(b)) || a.id.localeCompare(b.id));
        const cents = rows.reduce((sum, payment) => sum + Math.round(payment.amountReceived * 100), 0);
        return <details key={visibleTeam} className="route-pending-cash-team">
          <summary aria-label={`Equipo ${visibleTeam}: ${formatCurrency(cents / 100)}, ${rows.length} recibos pendientes`}><span>{visibleTeam}</span><span aria-hidden="true">—</span><strong>{formatCurrency(cents / 100)}</strong></summary>
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
