import { memo } from "react";
import type { ControlUnitRow } from "../../cloudData";
import { FLEET_STATUS_OPTIONS, type UnitFormState } from "./controlUnitsRules";

type Props = {
  form: UnitFormState;
  editTarget: ControlUnitRow | null;
  companies: string[];
  saving: boolean;
  error?: string;
  onFormChange: (updater: (current: UnitFormState) => UnitFormState) => void;
  onUnitIdChange: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
};

export const UnitFormModal = memo(function UnitFormModal({
  form,
  editTarget,
  companies,
  saving,
  error,
  onFormChange,
  onUnitIdChange,
  onCancel,
  onSave
}: Props) {
  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 980 }}>
        <div className="modal-header">
          <h2>{editTarget ? `Editar auto ${editTarget.unit_id}` : "Nuevo auto"}</h2>
          <button type="button" className="modal-close" onClick={onCancel}>X</button>
        </div>
        <div className="modal-body">
          <div className="form-grid">
            <label>Unidad
              <input
                value={form.unit_id}
                onChange={(event) => onUnitIdChange(event.target.value)}
                placeholder="Ejemplo: A1"
              />
            </label>
            <label>Marca / Modelo
              <input value={form.brand_model} onChange={(event) => onFormChange((s) => ({ ...s, brand_model: event.target.value }))} />
            </label>
            <label>Ano
              <input value={form.year} onChange={(event) => onFormChange((s) => ({ ...s, year: event.target.value }))} />
            </label>
            <label>Empresa
              <input
                list="fleet-company-options"
                value={form.company}
                onChange={(event) => onFormChange((s) => ({ ...s, company: event.target.value }))}
                placeholder="Selecciona o escribe empresa"
              />
            </label>
            <label>Placa
              <input value={form.plate} onChange={(event) => onFormChange((s) => ({ ...s, plate: event.target.value }))} />
            </label>
            <label>Serial Motor
              <input value={form.engine_serial} onChange={(event) => onFormChange((s) => ({ ...s, engine_serial: event.target.value }))} />
            </label>
            <label>Serial Chasis
              <input value={form.chassis_serial} onChange={(event) => onFormChange((s) => ({ ...s, chassis_serial: event.target.value }))} />
            </label>
            <label>Color
              <input value={form.color} onChange={(event) => onFormChange((s) => ({ ...s, color: event.target.value }))} />
            </label>
            <label>Transmision
              <input value={form.transmission} onChange={(event) => onFormChange((s) => ({ ...s, transmission: event.target.value }))} />
            </label>
            <label>Kilometraje
              <input value={form.mileage} onChange={(event) => onFormChange((s) => ({ ...s, mileage: event.target.value }))} />
            </label>
            <label>Estado operativo
              <select value={form.operational_status} onChange={(event) => onFormChange((s) => ({ ...s, operational_status: event.target.value }))}>
                {FLEET_STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label style={{ gridColumn: "1 / -1" }}>Observaciones
              <input value={form.observation} onChange={(event) => onFormChange((s) => ({ ...s, observation: event.target.value }))} />
            </label>
          </div>
          <datalist id="fleet-company-options">
            {companies.map((company) => (
              <option key={company} value={company} />
            ))}
          </datalist>
          {error && <p className="error-text" role="alert" style={{ marginTop: 12 }}>{error}</p>}

          <div className="modal-actions" style={{ marginTop: 14 }}>
            <button type="button" className="button ghost" onClick={onCancel}>
              Cancelar
            </button>
            <button type="button" className="button primary" disabled={saving} onClick={onSave}>
              {saving ? "Guardando..." : "Guardar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});
