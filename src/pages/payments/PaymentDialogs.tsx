import type { Dispatch, SetStateAction } from "react";
import PaymentReceipt from "../../components/PaymentReceipt";
import { formatCurrency } from "../../format";
import type { Payment } from "../../types";

type PaymentPreviewDialogProps = {
  payment: Payment | null;
  onClose: () => void;
};

export function PaymentPreviewDialog({ payment, onClose }: PaymentPreviewDialogProps) {
  if (!payment) return null;
  return (
    <div className="modal-overlay">
      <div className="modal payment-receipt-modal">
        <PaymentReceipt
          payment={payment}
          onClose={onClose}
          closeLabel="Cerrar vista previa"
          receiptFormat="history"
        />
      </div>
    </div>
  );
}

type ReopenCashDialogProps = {
  date: string | null;
  reason: string;
  setReason: Dispatch<SetStateAction<string>>;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ReopenCashDialog({
  date,
  reason,
  setReason,
  onCancel,
  onConfirm
}: ReopenCashDialogProps) {
  if (!date) return null;
  return (
    <div className="modal-overlay">
      <div className="modal">
        <h3 className="modal-title">Reabrir caja</h3>
        <div className="modal-body">
          Vas a reabrir la caja de <strong>{date}</strong>.<br /><br />
          Indica el motivo de reapertura:
          <div style={{ marginTop: 10 }}>
            <input
              type="text"
              className="payment-input"
              placeholder="Ej. Correccion por pago omitido en corte"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
        </div>
        <div className="modal-actions">
          <button type="button" className="button ghost" onClick={onCancel}>Cancelar</button>
          <button type="button" className="button danger" onClick={onConfirm}>Confirmar reapertura</button>
        </div>
      </div>
    </div>
  );
}

type DeletePaymentDialogProps = {
  payment: Payment | null;
  isDateClosed: (dateKey: string) => boolean;
  onCancel: () => void;
  onConfirm: (payment: Payment) => void;
};

export function DeletePaymentDialog({
  payment,
  isDateClosed,
  onCancel,
  onConfirm
}: DeletePaymentDialogProps) {
  if (!payment) return null;
  const isClosed = isDateClosed(payment.dateApplied);

  return (
    <div className="modal-overlay">
      <div className="modal">
        <h3 className="modal-title">Eliminar pago</h3>
        <p className="modal-body">
          Confirmas que deseas eliminar el recibo <strong>{payment.receiptNumber}</strong> de{" "}
          <strong>{payment.clientName}</strong> por{" "}
          <strong>{formatCurrency(payment.amountReceived)}</strong>?<br /><br />
          El saldo del cliente sera revertido automaticamente.
          {isClosed && (
            <>
              <br /><br />
              Esta fecha tiene caja cerrada. Debes gestionar un ajuste, no eliminar el pago.
            </>
          )}
        </p>
        <div className="modal-actions">
          <button type="button" className="button ghost" onClick={onCancel}>Cancelar</button>
          <button
            type="button"
            className="button danger"
            disabled={isClosed}
            onClick={() => onConfirm(payment)}
          >
            Eliminar
          </button>
        </div>
      </div>
    </div>
  );
}
