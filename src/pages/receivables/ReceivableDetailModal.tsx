import { memo } from "react";
import { formatCurrency, formatDate } from "../../format";
import { PLAN_LABEL, STATE_LABEL, type ReceivableRow } from "../../receivables";

type Props = {
  row: ReceivableRow;
  onClose: () => void;
};

export const ReceivableDetailModal = memo(function ReceivableDetailModal({ row, onClose }: Props) {
  const totalDue = row.overdueBalance + row.totalOtherCharges;
  const overdueInstallments = row.rentAmount > 0 ? Math.ceil(row.overdueBalance / row.rentAmount) : 0;
  const overdueLabel = overdueInstallments > 0
    ? `${formatCurrency(row.overdueBalance)} (${overdueInstallments} ${overdueInstallments === 1 ? "cuota" : "cuotas"})`
    : formatCurrency(row.overdueBalance);
  return (
    <div className="modal-overlay">
      <div className="modal ar-detail-modal">
        <div className="modal-header">
          <h2>Detalle de cuenta - {row.unitId}</h2>
          <button type="button" className="modal-close" onClick={onClose}>X</button>
        </div>
        <div className="modal-body">
          <div className="ar-detail-grid">
            <div><span className="hint">Cliente</span><p><strong>{row.name}</strong></p></div>
            <div><span className="hint">Cedula</span><p>{row.cedula}</p></div>
            <div><span className="hint">Unidad</span><p>{row.unitId}</p></div>
            <div><span className="hint">Grupo</span><p>{row.group || "-"}</p></div>
            <div><span className="hint">Datos contrato</span><p>{PLAN_LABEL[row.plan]} | Total contrato: {formatCurrency(row.contractTotal)}</p></div>
            <div><span className="hint">Proxima fecha pago</span><p>{row.nextDueDate ? formatDate(new Date(`${row.nextDueDate}T12:00:00`)) : "-"}</p></div>
            <div><span className="hint">Renta vencida</span><p className="amount-debt">{overdueLabel}</p></div>
            <div><span className="hint">Otros cargos</span><p className="amount-debt">{formatCurrency(row.totalOtherCharges)}</p></div>
            <div><span className="hint">Total general</span><p className="amount-debt">{formatCurrency(totalDue)}</p></div>
            <div><span className="hint">Estado</span><p>{STATE_LABEL[row.state]}</p></div>
          </div>
        </div>
        <div className="modal-actions ar-detail-actions">
          <button type="button" className="button ghost" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  );
});
