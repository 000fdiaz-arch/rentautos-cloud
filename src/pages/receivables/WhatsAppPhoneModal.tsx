import { memo } from "react";
import type { ReceivableRow } from "../../receivables";
import type { Client } from "../../types";

type Props = {
  client?: Client;
  row?: ReceivableRow;
  draft: string;
  error: string;
  saving: boolean;
  onDraftChange: (value: string) => void;
  onClose: () => void;
  onSave: () => void;
};

export const WhatsAppPhoneModal = memo(function WhatsAppPhoneModal({
  client,
  row,
  draft,
  error,
  saving,
  onDraftChange,
  onClose,
  onSave
}: Props) {
  if (!client && !row) return null;
  return (
    <div className="modal-overlay">
      <div className="modal ar-detail-modal ar-whatsapp-phone-modal">
        <div className="modal-header">
          <h2>WhatsApp - {row?.unitId ?? client?.unitId}</h2>
          <button type="button" className="modal-close" onClick={onClose}>X</button>
        </div>
        <div className="modal-body">
          <div className="ar-detail-grid">
            <div><span className="hint">Cliente</span><p><strong>{row?.name ?? client?.name}</strong></p></div>
            <div><span className="hint">Unidad</span><p>{row?.unitId ?? client?.unitId}</p></div>
          </div>
          <label className="ar-field-management-label ar-whatsapp-phone-field">
            WhatsApp
            <input
              type="tel"
              inputMode="numeric"
              pattern="[0-9]*"
              value={draft}
              onChange={(event) => onDraftChange(event.target.value)}
              placeholder="Ej. 68842222"
              autoFocus
            />
          </label>
          {error ? <span className="hint error-text">{error}</span> : null}
        </div>
        <div className="modal-actions ar-detail-actions">
          <button type="button" className="button ghost" onClick={onClose} disabled={saving}>Cancelar</button>
          <button type="button" className="button primary" onClick={onSave} disabled={saving}>
            {saving ? "Guardando..." : "Guardar WhatsApp"}
          </button>
        </div>
      </div>
    </div>
  );
});
