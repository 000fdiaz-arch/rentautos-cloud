import type { ControlUnitRow, FleetLifecycleImpact, FleetUnitEvent } from "../../cloudData";

function ImpactSummary({ impact }: { impact: FleetLifecycleImpact | null }) {
  if (!impact) return <p className="hint">Consultando relaciones activas...</p>;
  return (
    <div className="cash-subpanel" style={{ marginTop: 12 }}>
      <strong>Resumen antes de confirmar</strong>
      <div className="cash-header-grid" style={{ marginTop: 8 }}>
        <span>Clientes o alquileres: <b>{impact.activeClients}</b></span>
        <span>Rutas activas: <b>{impact.activeRoutes}</b></span>
        <span>Promesas pendientes: <b>{impact.pendingPromises}</b></span>
        <span>Reclamos abiertos: <b>{impact.openInsuranceClaims}</b></span>
        <span>Colisiones abiertas: <b>{impact.openCollisionCases}</b></span>
      </div>
    </div>
  );
}

export function RenameFleetUnitModal({
  target,
  nextUnitId,
  reason,
  note,
  impact,
  saving,
  error,
  onNextUnitIdChange,
  onReasonChange,
  onNoteChange,
  onCancel,
  onConfirm
}: {
  target: ControlUnitRow;
  nextUnitId: string;
  reason: string;
  note: string;
  impact: FleetLifecycleImpact | null;
  saving: boolean;
  error: string;
  onNextUnitIdChange: (value: string) => void;
  onReasonChange: (value: string) => void;
  onNoteChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const normalizedNext = nextUnitId.trim().toUpperCase();
  const invalidDestination = Boolean(
    impact && (impact.destinationOccupied || !impact.destinationHasBankRule)
  );
  const canConfirm = /^[A-Z][0-9]{1,3}$/.test(normalizedNext)
    && normalizedNext !== target.unit_id.trim().toUpperCase()
    && reason.trim().length > 0
    && impact !== null
    && !invalidDestination;
  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 720 }}>
        <div className="modal-header">
          <h2>Cambiar nomenclatura de {target.unit_id}</h2>
          <button type="button" className="modal-close" onClick={onCancel}>X</button>
        </div>
        <div className="modal-body">
          <p className="hint">El vehículo conserva su identidad, placa y chasis. La regla bancaria del grupo destino prevalece.</p>
          <div className="form-grid">
            <label>Nueva nomenclatura
              <input value={nextUnitId} onChange={(event) => onNextUnitIdChange(event.target.value)} placeholder="Ejemplo: A39" autoFocus />
            </label>
            <label>Motivo
              <input value={reason} onChange={(event) => onReasonChange(event.target.value)} placeholder="Motivo del cambio" />
            </label>
            <label style={{ gridColumn: "1 / -1" }}>Observación
              <textarea value={note} onChange={(event) => onNoteChange(event.target.value)} rows={3} />
            </label>
          </div>
          <ImpactSummary impact={impact} />
          {impact?.destinationOccupied && <p className="error-text">La nomenclatura {normalizedNext} está ocupada por otra unidad activa.</p>}
          {impact && !impact.destinationHasBankRule && normalizedNext && <p className="error-text">El grupo {normalizedNext[0]} no tiene una regla bancaria activa.</p>}
          {impact?.destinationCompany && <p className="hint">Empresa según regla bancaria: <b>{impact.destinationCompany}</b></p>}
          {error && <p className="error-text" role="alert">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="button ghost" onClick={onCancel} disabled={saving}>Cancelar</button>
            <button type="button" className="button primary" onClick={onConfirm} disabled={saving || !canConfirm}>
              {saving ? "Cambiando..." : `Cambiar a ${normalizedNext || "..."}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function RetireFleetUnitModal({
  target,
  reason,
  note,
  impact,
  saving,
  error,
  onReasonChange,
  onNoteChange,
  onCancel,
  onConfirm
}: {
  target: ControlUnitRow;
  reason: string;
  note: string;
  impact: FleetLifecycleImpact | null;
  saving: boolean;
  error: string;
  onReasonChange: (value: string) => void;
  onNoteChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const blockers = impact
    ? impact.activeClients + impact.activeRoutes + impact.pendingPromises + impact.openInsuranceClaims + impact.openCollisionCases
    : 1;
  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 720 }}>
        <div className="modal-header">
          <h2>Dar de baja {target.unit_id}</h2>
          <button type="button" className="modal-close" onClick={onCancel}>X</button>
        </div>
        <div className="modal-body">
          <p>La unidad saldrá de la flota activa y la nomenclatura <b>{target.unit_id}</b> quedará disponible.</p>
          <div className="form-grid">
            <label>Motivo de baja
              <select value={reason} onChange={(event) => onReasonChange(event.target.value)}>
                <option value="">Seleccionar</option>
                <option value="Vendido">Vendido</option>
                <option value="Pérdida total">Pérdida total</option>
                <option value="Retirado">Retirado</option>
                <option value="Otro">Otro</option>
              </select>
            </label>
            <label style={{ gridColumn: "1 / -1" }}>Observación
              <textarea value={note} onChange={(event) => onNoteChange(event.target.value)} rows={3} placeholder="Detalle de venta, retiro o soporte disponible" />
            </label>
          </div>
          <ImpactSummary impact={impact} />
          {impact && blockers > 0 && <p className="error-text">Resuelve primero las relaciones activas indicadas arriba.</p>}
          {error && <p className="error-text" role="alert">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="button ghost" onClick={onCancel} disabled={saving}>Cancelar</button>
            <button type="button" className="button primary" onClick={onConfirm} disabled={saving || !reason || blockers > 0}>
              {saving ? "Procesando..." : "Confirmar baja"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function RestoreFleetUnitModal({
  target,
  unitId,
  reason,
  saving,
  error,
  onUnitIdChange,
  onReasonChange,
  onCancel,
  onConfirm
}: {
  target: ControlUnitRow;
  unitId: string;
  reason: string;
  saving: boolean;
  error: string;
  onUnitIdChange: (value: string) => void;
  onReasonChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const normalized = unitId.trim().toUpperCase();
  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 620 }}>
        <div className="modal-header">
          <h2>Reactivar auto {target.unit_id}</h2>
          <button type="button" className="modal-close" onClick={onCancel}>X</button>
        </div>
        <div className="modal-body">
          <p className="hint">Si la nomenclatura anterior ya fue reutilizada, asigna una diferente. La regla bancaria del grupo seleccionado prevalece.</p>
          <div className="form-grid">
            <label>Nomenclatura
              <input value={unitId} onChange={(event) => onUnitIdChange(event.target.value)} />
            </label>
            <label>Motivo de reactivación
              <input value={reason} onChange={(event) => onReasonChange(event.target.value)} />
            </label>
          </div>
          {error && <p className="error-text" role="alert">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="button ghost" onClick={onCancel} disabled={saving}>Cancelar</button>
            <button type="button" className="button primary" onClick={onConfirm} disabled={saving || !/^[A-Z][0-9]{1,3}$/.test(normalized) || !reason.trim()}>
              {saving ? "Reactivando..." : "Reactivar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const EVENT_LABELS: Record<FleetUnitEvent["event_type"], string> = {
  renamed: "Cambio de nomenclatura",
  retired: "Baja",
  restored: "Reactivación"
};

export function FleetUnitHistoryModal({
  target,
  events,
  loading,
  error,
  onClose
}: {
  target: ControlUnitRow;
  events: FleetUnitEvent[];
  loading: boolean;
  error: string;
  onClose: () => void;
}) {
  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 760 }}>
        <div className="modal-header">
          <h2>Historial del auto {target.unit_id}</h2>
          <button type="button" className="modal-close" onClick={onClose}>X</button>
        </div>
        <div className="modal-body">
          <p className="hint">Identidad interna: {target.fleet_id}</p>
          {loading ? <p className="hint">Cargando historial...</p> : events.length === 0 ? <p className="empty">Este auto todavía no tiene eventos de nomenclatura o baja.</p> : (
            <div className="table-scroll">
              <table className="ar-table">
                <thead><tr><th>Fecha</th><th>Evento</th><th>Cambio</th><th>Motivo</th><th>Responsable</th><th>Observación</th></tr></thead>
                <tbody>{events.map((event) => (
                  <tr key={event.id}>
                    <td>{new Date(event.occurred_at).toLocaleString("es-PA")}</td>
                    <td>{EVENT_LABELS[event.event_type]}</td>
                    <td>{event.previous_unit_id ?? "-"}{event.next_unit_id ? ` → ${event.next_unit_id}` : ""}</td>
                    <td>{event.reason}</td>
                    <td>{event.performed_by_email ?? event.performed_by ?? "-"}</td>
                    <td>{event.note ?? "-"}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          {error && <p className="error-text">{error}</p>}
          <div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>Cerrar</button></div>
        </div>
      </div>
    </div>
  );
}
