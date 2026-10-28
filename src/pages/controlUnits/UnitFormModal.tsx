import { memo, useEffect, useState } from "react";
import type { ControlUnitRow } from "../../cloudData";
import { FLEET_STATUS_OPTIONS, type UnitFormState } from "./controlUnitsRules";

type Props = {
  form: UnitFormState;
  editTarget: ControlUnitRow | null;
  companies: string[];
  groups: string[];
  saving: boolean;
  error?: string;
  photoFile: File | null;
  onFormChange: (updater: (current: UnitFormState) => UnitFormState) => void;
  onUnitIdChange: (value: string) => void;
  onPhotoFileChange: (file: File | null) => void;
  onCancel: () => void;
  onSave: () => void;
};

export const UnitFormModal = memo(function UnitFormModal({
  form,
  editTarget,
  companies,
  groups,
  saving,
  error,
  photoFile,
  onFormChange,
  onUnitIdChange,
  onPhotoFileChange,
  onCancel,
  onSave
}: Props) {
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string>("");

  useEffect(() => {
    if (!photoFile) {
      setPhotoPreviewUrl(typeof editTarget?.catalog_photo_url === "string" ? editTarget.catalog_photo_url : "");
      return;
    }
    const objectUrl = URL.createObjectURL(photoFile);
    setPhotoPreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [editTarget?.catalog_photo_url, photoFile]);

  const unitGroup = form.unit_id.slice(0, 1).toUpperCase();
  const unitNumber = form.unit_id.slice(1).replace(/\D/g, "");
  const availableGroups = unitGroup && !groups.includes(unitGroup) ? [unitGroup, ...groups] : groups;

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 980 }}>
        <div className="modal-header">
          <h2>{editTarget ? `Editar auto ${editTarget.unit_id}` : "Nuevo auto"}</h2>
          <button type="button" className="modal-close" onClick={onCancel}>X</button>
        </div>
        <div className="modal-body">
          <div className="form-grid">
            <label>Letra / grupo del auto
              <select
                value={unitGroup}
                onChange={(event) => onUnitIdChange(`${event.target.value}${unitNumber}`)}
                disabled={Boolean(editTarget)}
              >
                <option value="">Selecciona una letra</option>
                {availableGroups.map((group) => <option key={group} value={group}>{group}</option>)}
              </select>
              <small className="hint">Las letras disponibles se configuran en Configuraciones → Reglas bancarias.</small>
            </label>
            <label>Número interno
              <input
                type="number"
                min="1"
                max="100"
                value={unitNumber}
                onChange={(event) => onUnitIdChange(`${unitGroup}${event.target.value}`)}
                placeholder="Ejemplo: 1"
                disabled={Boolean(editTarget) || !unitGroup}
              />
              <small className="hint">Código resultante: {form.unit_id || "—"}. No se muestra en el catálogo.</small>
              {editTarget && <small className="hint">Usa “Cambiar nomenclatura” en la vista Tabla para modificarlo.</small>}
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
            <label>Transmisión
              <select value={form.transmission} onChange={(event) => onFormChange((s) => ({ ...s, transmission: event.target.value }))}>
                <option value="">Selecciona</option>
                <option value="Automático">Automático</option>
                <option value="Manual">Manual</option>
              </select>
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

          <div className="fleet-catalog-form-section">
            <div>
              <h3>Ficha del catálogo</h3>
              <p className="hint">Estos tres planes se muestran directamente en la tarjeta del auto.</p>
            </div>
            <div className="form-grid">
              <label>Plan diario
                <input type="number" min="0" step="0.01" value={form.catalog_daily_rate} onChange={(event) => onFormChange((s) => ({ ...s, catalog_daily_rate: event.target.value }))} placeholder="25.00" />
              </label>
              <label>Plan semanal
                <input type="number" min="0" step="0.01" value={form.catalog_weekly_rate} onChange={(event) => onFormChange((s) => ({ ...s, catalog_weekly_rate: event.target.value }))} placeholder="150.00" />
              </label>
              <label>Plan quincenal
                <input type="number" min="0" step="0.01" value={form.catalog_biweekly_rate} onChange={(event) => onFormChange((s) => ({ ...s, catalog_biweekly_rate: event.target.value }))} placeholder="280.00" />
              </label>
              <label style={{ gridColumn: "1 / -1" }}>Foto real del auto
                <div className="fleet-catalog-photo-editor">
                  {photoPreviewUrl ? (
                    <img src={photoPreviewUrl} alt="Vista previa de la foto real del auto" />
                  ) : (
                    <div className="fleet-catalog-photo-editor-empty"><span aria-hidden="true">📷</span><strong>Aún no hay una foto</strong></div>
                  )}
                  <div>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                      capture="environment"
                      onChange={(event) => onPhotoFileChange(event.target.files?.[0] ?? null)}
                    />
                    <small className="hint">En el teléfono abre la cámara trasera. También puedes elegir una imagen existente; máximo 8 MB.</small>
                    {photoFile && <small className="hint">Seleccionada: {photoFile.name}</small>}
                  </div>
                </div>
              </label>
            </div>
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
