import { memo } from "react";
import type { FleetStatus } from "./controlUnitsRules";
import { FLEET_STATUS_OPTIONS, statusLabel } from "./controlUnitsRules";

type Props = {
  unitId: string;
  draft: FleetStatus;
  saving: boolean;
  error: string;
  willArchiveClient: boolean;
  clientName: string;
  onDraftChange: (value: FleetStatus) => void;
  onCancel: () => void;
  onConfirm: () => void;
};

export const FleetStatusModal = memo(function FleetStatusModal({
  unitId,
  draft,
  saving,
  error,
  willArchiveClient,
  clientName,
  onDraftChange,
  onCancel,
  onConfirm
}: Props) {
  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 520 }}>
        <div className="modal-header">
          <h2>Cambiar estado {unitId}</h2>
          <button type="button" className="modal-close" onClick={onCancel}>X</button>
        </div>
        <div className="modal-body">
          <label>Estado
            <select
              value={draft}
              onChange={(event) => onDraftChange(event.target.value as FleetStatus)}
              disabled={saving}
            >
              {FLEET_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          {willArchiveClient && (
            <div className="error-banner" style={{ marginTop: 12 }}>
              La unidad quedara {statusLabel(draft)} y {clientName || "el cliente enlazado"} pasara a Clientes archivados conservando la unidad {unitId}.
            </div>
          )}

          {error && <p className="hint error-text">{error}</p>}

          <div className="modal-actions" style={{ marginTop: 14 }}>
            <button type="button" className="button ghost" disabled={saving} onClick={onCancel}>
              Cancelar
            </button>
            <button type="button" className="button primary" disabled={saving} onClick={onConfirm}>
              {saving ? "Guardando..." : "Confirmar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});
