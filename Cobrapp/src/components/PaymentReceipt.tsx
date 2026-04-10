import { useRef, useState } from "react";
import { formatCurrency, formatDate } from "../format";
import { getDebtStartDate, startOfDay } from "../billing";
import type { Payment } from "../types";

type Props = {
  payment: Payment;
  onClose: () => void;
  closeLabel?: string;
};

function formatDateSpanish(dateStr: string): string {
  const parts = dateStr.split("-");
  if (parts.length !== 3) return dateStr;
  const months = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  const month = parseInt(parts[1], 10) - 1;
  return `${parseInt(parts[2], 10)} ${months[month] ?? ""} ${parts[0]}`;
}

export default function PaymentReceipt({ payment, onClose, closeLabel = "Registrar otro pago" }: Props) {
  const receiptRef = useRef<HTMLDivElement>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  async function handleDownload(): Promise<void> {
    if (!receiptRef.current) return;
    setIsDownloading(true);
    try {
      const html2canvas = (await import("html2canvas")).default;
      const canvas = await html2canvas(receiptRef.current, {
        scale: 2,
        backgroundColor: "#ffffff",
        useCORS: true,
        width: receiptRef.current.scrollWidth,
        height: receiptRef.current.scrollHeight
      });
      const link = document.createElement("a");
      link.download = `recibo-${payment.receiptNumber}-${payment.dateApplied}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    } catch {
      // silently fail — user still sees the receipt on screen
    } finally {
      setIsDownloading(false);
    }
  }

  // Cuotas vencidas reales después del pago
  const overdueAfter = payment.rentAmount > 0
    ? Math.max(0, Math.ceil(payment.balanceAfter / payment.rentAmount))
    : 0;
  const isOverdue = overdueAfter > 0;

  // "Debe desde" con la misma lógica de Módulo 1
  const paymentDate = startOfDay(new Date(payment.dateApplied + "T12:00:00"));
  const minimalClient = {
    balance: payment.balanceAfter,
    rentAmount: payment.rentAmount,
    frequency: payment.frequency,
    weeklyChargeDay: payment.weeklyChargeDay,
    monthlyChargeDay: payment.monthlyChargeDay,
    // campos requeridos por la firma pero no usados en el cálculo
    id: "", unitId: "", name: "", installmentsAgreed: 0,
    installmentsRemaining: 0, installmentsPaid: 0,
    otherCharges: [], savings: 0, createdAt: ""
  } as Parameters<typeof getDebtStartDate>[0];

  const debtStartDate = getDebtStartDate(minimalClient, paymentDate);
  const debtSinceLabel = debtStartDate ? "DEBE DESDE " + formatDate(debtStartDate) : "AL DIA";

  return (
    <div className="receipt-page">
      <div className="receipt-actions-bar">
        <button type="button" className="button primary" onClick={handleDownload} disabled={isDownloading}>
          {isDownloading ? "Generando imagen..." : "Descargar imagen"}
        </button>
        <button type="button" className="button ghost" onClick={onClose}>
          {closeLabel}
        </button>
      </div>

      <div ref={receiptRef} className="receipt-card">
        {/* Header */}
        <div className="receipt-header">
          <div>
            <div className="receipt-brand">COBRAPP</div>
            <div className="receipt-brand-sub">Recibo de Pago</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="receipt-number">{payment.receiptNumber}</div>
            <div className="receipt-date">{formatDateSpanish(payment.dateApplied)}</div>
          </div>
        </div>

        {/* Status banner */}
        {isOverdue && (
          <div className="receipt-overdue-banner">
            <span className="receipt-overdue-icon">⚠</span>
            <div>
              <div className="receipt-overdue-title">ATRASADO</div>
              <div className="receipt-overdue-sub">
                Debe {formatCurrency(payment.balanceAfter)} ({overdueAfter} {overdueAfter === 1 ? "cuota" : "cuotas"})
              </div>
            </div>
          </div>
        )}

        {/* Client info */}
        <div className="receipt-section">
          <div className="receipt-row">
            <span>Fecha aplicada</span>
            <span>{formatDateSpanish(payment.dateApplied)}</span>
          </div>
          <div className="receipt-row">
            <span>Unidad</span>
            <span><strong>{payment.clientUnit}</strong></span>
          </div>
          <div className="receipt-row">
            <span>Cliente</span>
            <span><strong>{payment.clientName.toUpperCase()}</strong></span>
          </div>
          {payment.clientCedula && (
            <div className="receipt-row">
              <span>Cedula</span>
              <span>{payment.clientCedula}</span>
            </div>
          )}
          <div className="receipt-row">
            <span>Forma de pago</span>
            <span>{payment.paymentMethod}</span>
          </div>
          {payment.reference && (
            <div className="receipt-row">
              <span>Referencia / Folio</span>
              <span>{payment.reference}</span>
            </div>
          )}
        </div>

        {/* Payment breakdown */}
        <div className="receipt-section">
          <div className="receipt-row">
            <span>Monto recibido</span>
            <span>{formatCurrency(payment.amountReceived)}</span>
          </div>
          <div className="receipt-row">
            <span>Aplicado a renta</span>
            <span>{formatCurrency(payment.appliedToRent)}</span>
          </div>
          {payment.centavosAhorro > 0 && (
            <div className="receipt-row">
              <span>Centavos a ahorro</span>
              <span>{formatCurrency(payment.centavosAhorro)}</span>
            </div>
          )}
        </div>

        {/* Installments */}
        <div className="receipt-installments-grid">
          <div className="receipt-installment-box receipt-installment-box--good">
            <div className="receipt-installment-label">Cuotas pagadas a la fecha</div>
            <div className="receipt-installment-value">{payment.installmentsPaidAfter}</div>
            <div className="receipt-installment-sub">{payment.installmentsPaidAfter} cuotas completadas en total.</div>
          </div>
          <div className={`receipt-installment-box ${isOverdue ? "receipt-installment-box--debt" : "receipt-installment-box--good"}`}>
            <div className="receipt-installment-label">{isOverdue ? "Cuotas atrasadas" : "Al dia"}</div>
            <div className="receipt-installment-value">{isOverdue ? overdueAfter : "✓"}</div>
            {isOverdue && (
              <div className="receipt-installment-sub">
                Saldo pendiente: {formatCurrency(payment.balanceAfter)}<br />
                ({overdueAfter} {overdueAfter === 1 ? "cuota" : "cuotas"} sin saldar)
              </div>
            )}
          </div>
        </div>

        {/* Debe desde */}
        <div className="receipt-section" style={{ marginTop: 16 }}>
          <div className={`receipt-covers-single ${isOverdue ? "receipt-covers-debt" : "receipt-covers-ok"}`}>
            {debtSinceLabel}
          </div>
          {payment.savingsAfter > 0 && (
            <div className="receipt-savings-box">
              <div className="receipt-savings-label">Fondo de Viaje</div>
              <div className="receipt-savings-sub">Saldo disponible</div>
              <div className="receipt-savings-value">{formatCurrency(payment.savingsAfter)}</div>
            </div>
          )}
        </div>

        {/* Total */}
        <div className="receipt-total-row">
          <span>Total pagado</span>
          <span>{formatCurrency(payment.amountReceived)}</span>
        </div>

        <div className="receipt-footer">
          Emitido por Administracion
        </div>
      </div>
    </div>
  );
}

