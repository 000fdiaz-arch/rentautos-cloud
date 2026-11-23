import { useMemo } from "react";
import { formatCurrency } from "../format";
import { collectionDeltaFromPayment, collectionTeamForDelta } from "../cashTeamRules";
import type { CollectionDelta, CollectionTeam, Payment } from "../types";
import { buildPendingCashRowsByTeam, getIncomeDate } from "./payments/dailyIncomeRules";

type Props = { payments: Payment[]; dateKey: string; loading?: boolean; team?: CollectionTeam; delta?: CollectionDelta; prominent?: boolean };

export default function RoutePendingCashPanel({ payments, dateKey, loading = false, team, delta, prominent = false }: Props) {
  // La misma lista compartida de pagos que recibe Ingresos del día.
  const scopedPayments = useMemo(() => delta
    ? payments.filter((payment) => collectionDeltaFromPayment(payment) === delta)
    : payments, [delta, payments]);
  const pending = useMemo(() => buildPendingCashRowsByTeam(scopedPayments, dateKey), [scopedPayments, dateKey]);
  const visibleTeams: CollectionTeam[] = delta ? [collectionTeamForDelta(delta)] : team ? [team] : ["WC", "PTY"];
  const visibleRows = visibleTeams.flatMap(visibleTeam => pending[visibleTeam])
    .sort((a, b) => getIncomeDate(a).localeCompare(getIncomeDate(b)) || a.id.localeCompare(b.id));
  const totalCents = visibleRows.reduce((sum, payment) => sum + Math.round(payment.amountReceived * 100), 0);

  function receiptList(rows: Payment[]) {
    return rows.length === 0 ? <p>Sin efectivo pendiente de entrega.</p> : <ul className="route-pending-cash-receipts">
      {rows.map(payment => <li key={payment.id}>
        <strong className="route-pending-cash-unit">{payment.clientUnit}</strong>
        <strong className="route-pending-cash-amount">{formatCurrency(payment.amountReceived)}</strong>
      </li>)}
    </ul>;
  }

  const content = <section className="route-pending-cash" aria-label="Efectivo pendiente de entrega">
    {!prominent ? <div className="route-pending-cash-heading">
      <strong>Falta entregar</strong>
    </div> : null}
    {loading ? <p role="status">Cargando pagos…</p> : prominent ? receiptList(visibleRows) : <div className="route-pending-cash-teams">
      {visibleTeams.map((visibleTeam) => {
        const label = visibleTeam === "WC" ? "DELTA2" : visibleTeam;
        const rows = [...pending[visibleTeam]].sort((a, b) => getIncomeDate(a).localeCompare(getIncomeDate(b)) || a.id.localeCompare(b.id));
        const cents = rows.reduce((sum, payment) => sum + Math.round(payment.amountReceived * 100), 0);
        return <details key={visibleTeam} className="route-pending-cash-team" open={prominent && visibleTeams.length === 1}>
          <summary aria-label={`Equipo ${label}: ${formatCurrency(cents / 100)}, ${rows.length} recibos pendientes`}><span>{label}</span><span aria-hidden="true">—</span><strong>{formatCurrency(cents / 100)}</strong></summary>
          {receiptList(rows)}
        </details>;
      })}
    </div>}
  </section>;
  return prominent ? <details className="route-pending-cash-disclosure route-collection-cash-summary">
    <summary title="Efectivo pendiente de entrega · Ver desglose" aria-busy={loading}
      aria-label={loading ? "Cargando efectivo pendiente de entrega" : `Efectivo pendiente de entrega: ${formatCurrency(totalCents / 100)}. Ver desglose`}>
      <span className="route-pending-cash-label">Efectivo por entregar</span>
      <strong>{loading ? "…" : formatCurrency(totalCents / 100)}</strong>
    </summary>
    {content}
  </details> : content;
}
