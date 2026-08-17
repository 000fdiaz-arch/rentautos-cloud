import type { Dispatch, SetStateAction } from "react";
import { formatCurrency } from "../../format";
import { otherChargeDateKey, sortOtherChargesOldestFirst } from "../../otherCharges";
import type { Client } from "../../types";
import { FREQUENCY_LABEL, STATUS_LABEL } from "./clientConstants";

export type ConfirmDialogValue = {
  title: string;
  message: string;
  variant: "warning" | "danger";
  onConfirm: () => void | Promise<void>;
};

export type StatusDialogValue = {
  clientId: string;
  nextStatus: Client["status"];
  comment: string;
};


export type FleetDetail = {
  plate?: string | null;
  brand_model?: string | null;
  engine_serial?: string | null;
  chassis_serial?: string | null;
  cupo?: string | null;
  company?: string | null;
  observation?: string | null;
  operational_status?: string | null;
};

export function ConfirmDialog({
  dialog,
  onClose
}: {
  dialog: ConfirmDialogValue | null;
  onClose: () => void;
}) {
  if (!dialog) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal confirm-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <h2>{dialog.title}</h2>
          <button type="button" className="modal-close" onClick={onClose}>X</button>
        </div>
        <div className="confirm-modal-body">
          <p>{dialog.message}</p>
          <div className="confirm-modal-actions">
            <button type="button" className={`button ${dialog.variant === "danger" ? "danger" : "primary"}`} onClick={dialog.onConfirm}>Confirmar</button>
            <button type="button" className="button ghost" onClick={onClose}>Cancelar</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function StatusChangeDialog({
  dialog,
  setDialog,
  onConfirm
}: {
  dialog: StatusDialogValue | null;
  setDialog: Dispatch<SetStateAction<StatusDialogValue | null>>;
  onConfirm: () => void | Promise<void>;
}) {
  if (!dialog) return null;
  return (
    <div className="modal-overlay" onClick={() => setDialog(null)}>
      <div className="modal confirm-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <h2>Cambiar estado</h2>
          <button type="button" className="modal-close" onClick={() => setDialog(null)}>X</button>
        </div>
        <div className="confirm-modal-body">
          <p>
            Confirma el cambio a <strong>{STATUS_LABEL[dialog.nextStatus]}</strong> e indica el motivo:
          </p>
          <textarea
            className="pause-comment-input"
            placeholder="Ej. Acuerdo de pago, reparacion en unidad, negociacion..."
            value={dialog.comment}
            onChange={(event) => setDialog((current) => current ? { ...current, comment: event.target.value } : current)}
            rows={3}
            autoFocus
          />
          <div className="confirm-modal-actions" style={{ marginTop: 16 }}>
            <button type="button" className="button primary" onClick={onConfirm} disabled={dialog.comment.trim().length === 0}>
              Confirmar
            </button>
            <button type="button" className="button ghost" onClick={() => setDialog(null)}>Cancelar</button>
          </div>
        </div>
      </div>
    </div>
  );
}


export function VehicleInfoDialog({
  unitId,
  detailsByUnit,
  onClose
}: {
  unitId: string | null;
  detailsByUnit: Record<string, FleetDetail>;
  onClose: () => void;
}) {
  if (!unitId) return null;
  const detail = detailsByUnit[unitId];
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal confirm-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <h2>Info de unidad {unitId}</h2>
          <button type="button" className="modal-close" onClick={onClose}>X</button>
        </div>
        <div className="confirm-modal-body" style={{ maxHeight: "70vh", overflowY: "auto", paddingRight: 6 }}>
          <div className="control-unit-info-grid">
            <div><span className="hint">Placa</span><p>{detail?.plate ?? "-"}</p></div>
            <div><span className="hint">Marca/Modelo</span><p>{detail?.brand_model ?? "-"}</p></div>
            <div><span className="hint">Empresa</span><p>{detail?.company ?? "-"}</p></div>
            <div><span className="hint">Serial Motor</span><p>{detail?.engine_serial ?? "-"}</p></div>
            <div><span className="hint">Serial Chasis</span><p>{detail?.chassis_serial ?? "-"}</p></div>
            <div><span className="hint">Cupo</span><p>{detail?.cupo ?? "-"}</p></div>
            <div style={{ gridColumn: "1 / -1" }}><span className="hint">Observacion</span><p>{detail?.observation ?? "-"}</p></div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ClientInfoDialog({
  clientId,
  clients,
  onClose
}: {
  clientId: string | null;
  clients: Client[];
  onClose: () => void;
}) {
  if (!clientId) return null;
  const selected = clients.find((client) => client.id === clientId);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal confirm-modal client-data-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <h2>Datos del cliente</h2>
          <button type="button" className="modal-close" onClick={onClose}>X</button>
        </div>
        <div className="confirm-modal-body client-data-modal-body">
          {!selected ? (
            <p className="hint">No se encontro cliente.</p>
          ) : (
            <div className="control-unit-info-grid">
              <div><span className="hint">Unidad</span><p>{selected.unitId}</p></div>
              <div><span className="hint">Nombre completo</span><p>{selected.name}</p></div>
              <div><span className="hint">Cedula</span><p>{selected.cedula ?? "-"}</p></div>
              <div><span className="hint">Estado</span><p>{STATUS_LABEL[selected.status]}</p></div>
              <div><span className="hint">Renta</span><p>{formatCurrency(selected.rentAmount)}</p></div>
              <div><span className="hint">Frecuencia</span><p>{FREQUENCY_LABEL[selected.frequency]}</p></div>
              <div><span className="hint">Fecha primer cobro</span><p>{selected.firstChargeDate ?? "-"}</p></div>
              <div><span className="hint">Ultimo cobro</span><p>{selected.lastChargeDate ?? "-"}</p></div>
              <div><span className="hint">Cuotas pactadas</span><p>{selected.installmentsAgreed}</p></div>
              <div><span className="hint">Cuotas emitidas</span><p>{selected.installmentsIssued ?? 0}{selected.installmentsIssuedEstimateNeedsReview ? " (estimación por revisar)" : ""}</p></div>
              <div><span className="hint">Cuotas restantes</span><p>{selected.installmentsRemaining}</p></div>
              <div><span className="hint">Cuotas pagadas</span><p>{selected.installmentsPaid}</p></div>
              <div><span className="hint">Monto a cobrar</span><p>{formatCurrency(selected.balance)}</p></div>
              <div><span className="hint">Fondo de viaje</span><p>{formatCurrency(selected.travelFundBalance ?? 0)}</p></div>
              <div><span className="hint">Ahorro de siniestros</span><p>{formatCurrency(selected.savings)}</p></div>
              <div><span className="hint">Saldo a favor</span><p>{formatCurrency(selected.advanceBalance)}</p></div>
              <div><span className="hint">Creado</span><p>{selected.createdAt}</p></div>
              <div><span className="hint">Archivado en</span><p>{selected.archivedAt ?? "-"}</p></div>
              <div style={{ gridColumn: "1 / -1" }}><span className="hint">Comentario de estado</span><p>{selected.statusComment ?? "-"}</p></div>
              <div style={{ gridColumn: "1 / -1" }}>
                <span className="hint">Otros cargos</span>
                <p>{selected.otherCharges.length > 0 ? sortOtherChargesOldestFirst(selected.otherCharges).map((charge) => `${otherChargeDateKey(charge) || "Sin fecha"} · ${charge.label}: ${formatCurrency(charge.amount)}`).join(" | ") : "-"}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
