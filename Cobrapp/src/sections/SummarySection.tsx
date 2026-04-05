import SummaryStat from "../components/SummaryStat";
import { formatMoney } from "../utils/format";

interface SummarySectionProps {
  totalPending: number;
  totalClientsWithDebt: number;
  totalMonthPayments: number;
  monthPaymentsCount: number;
  pendingBankRows: number;
}

function SummarySection({
  totalPending,
  totalClientsWithDebt,
  totalMonthPayments,
  monthPaymentsCount,
  pendingBankRows,
}: SummarySectionProps) {
  return (
    <section className="summary-grid" id="resumen">
      <SummaryStat
        label="Saldo pendiente"
        value={formatMoney(totalPending)}
        detail="Total por cobrar entre todos los clientes."
        tone="accent"
      />
      <SummaryStat
        label="Clientes con deuda"
        value={String(totalClientsWithDebt)}
        detail="Clientes que aun no estan al dia."
      />
      <SummaryStat
        label="Abonos del mes"
        value={formatMoney(totalMonthPayments)}
        detail={`${monthPaymentsCount} pagos anotados este mes.`}
      />
      <SummaryStat
        label="Banco por revisar"
        value={String(pendingBankRows)}
        detail="Filas del CSV aun pendientes."
        tone="warning"
      />
    </section>
  );
}

export default SummarySection;
