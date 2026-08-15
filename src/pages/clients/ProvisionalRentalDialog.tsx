import { useEffect, useState } from "react";
import { formatCurrency } from "../../format";
import type { Client, ProvisionalRentalFrequency } from "../../types";
import { nextProvisionalRentalChargeDate } from "../../provisionalRentals";
import type { FleetDetail } from "./ClientsDialogs";

export type ProvisionalRentalDraft = {
  unitId: string;
  frequency: ProvisionalRentalFrequency;
  rentAmount: number;
};

type Props = {
  client: Client | null;
  availableUnits: string[];
  fleetDetailsByUnit: Record<string, FleetDetail>;
  hasRentalPayments: boolean;
  saving: boolean;
  error: string;
  onClose: () => void;
  onAssign: (draft: ProvisionalRentalDraft) => void;
  onUpdateTerms: (draft: ProvisionalRentalDraft) => void;
  onReturn: () => void;
  onCancelAssignment: () => void;
};

const FREQUENCIES: Array<{ value: ProvisionalRentalFrequency; label: string }> = [
  { value: "daily", label: "Diario" },
  { value: "weekly", label: "Semanal" },
  { value: "biweekly", label: "Quincenal" }
];

export function ProvisionalRentalDialog({
  client,
  availableUnits,
  fleetDetailsByUnit,
  hasRentalPayments,
  saving,
  error,
  onClose,
  onAssign,
  onUpdateTerms,
  onReturn,
  onCancelAssignment
}: Props) {
  const rental = client?.activeProvisionalRental;
  const [unitId, setUnitId] = useState("");
  const [frequency, setFrequency] = useState<ProvisionalRentalFrequency>("daily");
  const [rentAmount, setRentAmount] = useState("");

  useEffect(() => {
    setUnitId(rental?.unitId ?? "");
    setFrequency(rental?.frequency ?? "daily");
    setRentAmount(rental ? String(rental.rentAmount) : "");
  }, [client?.id, rental?.id, rental?.frequency, rental?.rentAmount, rental?.unitId]);

  if (!client) return null;
  const parsedAmount = Number(rentAmount);
  const valid = Boolean((rental || unitId) && Number.isFinite(parsedAmount) && parsedAmount > 0);
  const vehicle = fleetDetailsByUnit[rental?.unitId ?? unitId];
  const nextCharge = rental ? nextProvisionalRentalChargeDate(rental) : null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal provisional-rental-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <span className="provisional-rental-eyebrow">AUTO PROVISIONAL/ALQUILER DE AUTO</span>
            <h2>{client.name}</h2>
          </div>
          <button type="button" className="modal-close" onClick={onClose} disabled={saving}>X</button>
        </div>
        <div className="modal-body">
          {rental ? (
            <div className="provisional-rental-summary">
              <div><span>Unidad provisional</span><strong>{rental.unitId}</strong></div>
              <div><span>Vehículo</span><strong>{[vehicle?.brand_model, vehicle?.plate].filter(Boolean).join(" · ") || "Sin detalle"}</strong></div>
              <div><span>Deuda provisional</span><strong>{formatCurrency(rental.balance)}</strong></div>
              <div><span>Saldo a favor</span><strong>{formatCurrency(rental.creditBalance)}</strong></div>
              <div><span>Próximo cobro</span><strong>{nextCharge ?? "Por definir"}</strong></div>
              <div><span>Cuenta regular</span><strong>{client.unitId} · PAUSADA</strong></div>
            </div>
          ) : (
            <label>Auto libre
              <select value={unitId} onChange={(event) => setUnitId(event.target.value)} disabled={saving}>
                <option value="">Selecciona un auto...</option>
                {availableUnits.map((unit) => {
                  const detail = fleetDetailsByUnit[unit];
                  return <option key={unit} value={unit}>{unit}{detail?.brand_model ? ` · ${detail.brand_model}` : ""}{detail?.plate ? ` · ${detail.plate}` : ""}</option>;
                })}
              </select>
            </label>
          )}

          <div className="provisional-rental-fields">
            <label>Frecuencia
              <select value={frequency} onChange={(event) => setFrequency(event.target.value as ProvisionalRentalFrequency)} disabled={saving}>
                {FREQUENCIES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label>Monto a pagar
              <input type="number" min="0.01" step="0.01" value={rentAmount} onChange={(event) => setRentAmount(event.target.value)} disabled={saving} />
            </label>
          </div>

          {client.provisionalRentalHistory?.length ? (
            <details className="provisional-rental-history">
              <summary>Historial de alquileres ({client.provisionalRentalHistory.length})</summary>
              {client.provisionalRentalHistory.slice().reverse().map((item) => (
                <div key={item.id}><strong>{item.unitId}</strong><span>{item.startDate} · {item.status === "returned" ? "Devuelto" : "Cancelado"} · Saldo {formatCurrency(item.balance)}</span></div>
              ))}
            </details>
          ) : null}

          {error && <p className="error-banner" role="alert">{error}</p>}
          <div className="modal-actions provisional-rental-actions">
            <button type="button" className="button ghost" onClick={onClose} disabled={saving}>Cerrar</button>
            {rental ? (
              <>
                {!hasRentalPayments && <button type="button" className="button danger" onClick={onCancelAssignment} disabled={saving}>Cancelar asignación</button>}
                <button type="button" className="button ghost" onClick={() => onUpdateTerms({ unitId: rental.unitId, frequency, rentAmount: parsedAmount })} disabled={saving || !valid}>Actualizar tarifa</button>
                <button type="button" className="button primary" onClick={onReturn} disabled={saving}>Devolver auto</button>
              </>
            ) : (
              <button type="button" className="button primary" onClick={() => onAssign({ unitId, frequency, rentAmount: parsedAmount })} disabled={saving || !valid}>Asignar auto provisional</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
