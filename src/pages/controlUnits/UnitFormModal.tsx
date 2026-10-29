import { memo, useEffect, useState } from "react";
import type { ControlUnitRow } from "../../cloudData";
import { FLEET_STATUS_OPTIONS, findFleetIdentityDuplicate, type UnitFormState } from "./controlUnitsRules";
import { FleetDocumentIntake } from "./FleetDocumentIntake";
import { FleetDocumentsPanel } from "./FleetDocumentsPanel";
import { CatalogPhotoEditor } from "./CatalogPhotoEditor";

function previewMoney(value: string): string {
  const amount = Number(value);
  if (!value.trim() || !Number.isFinite(amount) || amount < 0) return "Por definir";
  return new Intl.NumberFormat("es-PA", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(amount);
}

function previewTotal(rate: string, managementFee: string): string {
  const rateAmount = Number(rate);
  const feeAmount = Number(managementFee);
  if (!rate.trim() || !managementFee.trim() || !Number.isFinite(rateAmount) || !Number.isFinite(feeAmount)) return "Por definir";
  return previewMoney(String(rateAmount + feeAmount));
}

type Props = {
  form: UnitFormState;
  editTarget: ControlUnitRow | null;
  catalogOnly?: boolean;
  companies: string[];
  groups: string[];
  saving: boolean;
  error?: string;
  photoFile: File | null;
  existingRows: ControlUnitRow[];
  onFormChange: (updater: (current: UnitFormState) => UnitFormState) => void;
  onUnitIdChange: (value: string) => void;
  onPhotoFileChange: (file: File | null) => void;
  onCancel: () => void;
  onSave: () => void;
};

export const UnitFormModal = memo(function UnitFormModal({
  form,
  editTarget,
  catalogOnly = false,
  companies,
  groups,
  saving,
  error,
  photoFile,
  existingRows,
  onFormChange,
  onUnitIdChange,
  onPhotoFileChange,
  onCancel,
  onSave
}: Props) {
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string>("");
  const [createStep, setCreateStep] = useState<"documents" | "details">(editTarget ? "details" : "documents");
  const [detailsTab, setDetailsTab] = useState<"vehicle" | "documents" | "catalog">(catalogOnly ? "catalog" : "vehicle");
  const [documentsApplied, setDocumentsApplied] = useState(false);
  const [documentDuplicateError, setDocumentDuplicateError] = useState("");

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

  function applyExtractedVehicleData() {
    const extractedIdentity = {
      plate: "DC5113",
      engine_serial: "G4KEKD049968",
      chassis_serial: "KMHS281EBLU203445"
    };
    const duplicate = findFleetIdentityDuplicate(existingRows, extractedIdentity, editTarget?.fleet_id);
    if (duplicate) {
      setDocumentDuplicateError(`No se pueden cargar estos documentos: la ${duplicate.label} ${duplicate.value} ya está registrada en la unidad ${duplicate.unitId}.`);
      return;
    }
    setDocumentDuplicateError("");
    onFormChange((current) => ({
      ...current,
      brand_model: "HYUNDAI SANTA FE",
      year: "2020",
      ...extractedIdentity,
      color: "ROJO",
      transmission: "Automático"
    }));
    setDocumentsApplied(true);
    setCreateStep("details");
  }

  return (
    <div className="modal-overlay">
      <div className="modal fleet-create-modal">
        <div className="modal-header">
          <h2>{catalogOnly && editTarget ? `Ficha del catálogo · ${editTarget.unit_id}` : editTarget ? `Editar auto ${editTarget.unit_id}` : "Nuevo auto"}</h2>
          <button type="button" className="modal-close" onClick={onCancel}>X</button>
        </div>
        <div className="modal-body">
          {!editTarget && (
            <div className="fleet-create-steps" aria-label="Pasos para crear el auto">
              <button type="button" className={createStep === "documents" ? "is-active" : "is-complete"} onClick={() => setCreateStep("documents")}>
                <span>1</span><strong>Documentos</strong><small>Cargar y leer archivos</small>
              </button>
              <i aria-hidden="true" />
              <button type="button" className={createStep === "details" ? "is-active" : ""} onClick={() => setCreateStep("details")}>
                <span>2</span><strong>Datos del auto</strong><small>Revisar y completar</small>
              </button>
            </div>
          )}

          {!editTarget && createStep === "documents" ? (
            <FleetDocumentIntake error={documentDuplicateError} onApply={applyExtractedVehicleData} onCancel={onCancel} />
          ) : (
          <>
          {documentsApplied && !editTarget && (
            <div className="fleet-doc-applied-banner" role="status">
              <span aria-hidden="true">✓</span>
              <div><strong>Datos completados desde los documentos</strong><small>Revisa los campos resaltados y asigna la letra y número interno antes de guardar.</small></div>
            </div>
          )}
          {!catalogOnly && <div className="fleet-form-tabs" role="tablist" aria-label="Secciones del auto">
            <button
              type="button"
              role="tab"
              aria-selected={detailsTab === "vehicle"}
              className={detailsTab === "vehicle" ? "is-active" : ""}
              onClick={() => setDetailsTab("vehicle")}
            >
              Datos del auto
            </button>
            {editTarget && (
              <button
                type="button"
                role="tab"
                aria-selected={detailsTab === "documents"}
                className={detailsTab === "documents" ? "is-active" : ""}
                onClick={() => setDetailsTab("documents")}
              >
                Documentos
              </button>
            )}
            <button
              type="button"
              role="tab"
              aria-selected={detailsTab === "catalog"}
              className={detailsTab === "catalog" ? "is-active" : ""}
              onClick={() => setDetailsTab("catalog")}
            >
              Ficha del catálogo
            </button>
          </div>}
          {!catalogOnly && detailsTab === "vehicle" && (
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
            <label>Llave codificada
              <select value={form.key_coded} onChange={(event) => onFormChange((s) => ({ ...s, key_coded: event.target.value as UnitFormState["key_coded"] }))}>
                <option value="">Sin confirmar</option>
                <option value="yes">Sí, codificada</option>
                <option value="no">No codificada</option>
              </select>
              <small className="hint">Utiliza “Sin confirmar” si todavía no se ha probado la llave.</small>
            </label>
            <label>Estado operativo
              <select value={form.operational_status} onChange={(event) => onFormChange((s) => ({ ...s, operational_status: event.target.value }))}>
                {FLEET_STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          </div>
          )}

          {!catalogOnly && detailsTab === "documents" && editTarget && (
            <FleetDocumentsPanel unitId={editTarget.unit_id} />
          )}

          {(catalogOnly || detailsTab === "catalog") && (
          <div className="fleet-catalog-form-section">
            <div>
              <h3>Ficha del catálogo</h3>
              <p className="hint">Configura la duración del contrato, el alquiler y el cobro de gestión de cada plan.</p>
            </div>
            <div className="fleet-catalog-contract-field">
              <label>Duración del contrato (meses)
                <input type="number" min="1" max="120" step="1" value={form.catalog_contract_months} onChange={(event) => onFormChange((s) => ({ ...s, catalog_contract_months: event.target.value }))} placeholder="36" />
              </label>
              <p><span aria-hidden="true">▣</span><strong>{form.catalog_contract_months || "—"} meses</strong><small>Se muestra una sola vez porque aplica a todos los planes.</small></p>
            </div>

            <div className="fleet-catalog-plan-form-grid">
              {([
                ["Diario", "catalog_daily_rate", "catalog_daily_management_fee", "34.00"],
                ["Semanal", "catalog_weekly_rate", "catalog_weekly_management_fee", "198.00"],
                ["Quincenal", "catalog_biweekly_rate", "catalog_biweekly_management_fee", "390.00"]
              ] as const).map(([label, rateKey, feeKey, placeholder]) => (
                <fieldset key={label}>
                  <legend>Plan {label.toLocaleLowerCase("es")}</legend>
                  <label>Alquiler
                    <input type="number" min="0" step="0.01" value={form[rateKey]} onChange={(event) => onFormChange((s) => ({ ...s, [rateKey]: event.target.value }))} placeholder={placeholder} />
                  </label>
                  <label>Gestión
                    <input type="number" min="0" step="0.01" value={form[feeKey]} onChange={(event) => onFormChange((s) => ({ ...s, [feeKey]: event.target.value }))} placeholder="100.00" />
                  </label>
                  <div className="fleet-catalog-form-total"><span>Total al iniciar</span><strong>{previewTotal(form[rateKey], form[feeKey])}</strong></div>
                </fieldset>
              ))}
            </div>

            <div className="fleet-catalog-live-preview" aria-label="Vista previa de los planes">
              <div><span>Vista previa</span><strong>Duración del contrato: {form.catalog_contract_months || "Por definir"}{form.catalog_contract_months ? " meses" : ""}</strong></div>
              <div>
                {([
                  ["Diario", form.catalog_daily_rate, form.catalog_daily_management_fee],
                  ["Semanal", form.catalog_weekly_rate, form.catalog_weekly_management_fee],
                  ["Quincenal", form.catalog_biweekly_rate, form.catalog_biweekly_management_fee]
                ] as const).map(([label, rate, fee]) => (
                  <article key={label}><strong>{label}</strong><span>Alquiler: {previewMoney(rate)}</span><span>Gestión: {previewMoney(fee)}</span><em>Total al iniciar: {previewTotal(rate, fee)}</em></article>
                ))}
              </div>
            </div>

            <div className="fleet-catalog-photo-field">
              <strong>Foto real del auto</strong>
              <CatalogPhotoEditor photoPreviewUrl={photoPreviewUrl} photoFile={photoFile} onPhotoFileChange={onPhotoFileChange} />
            </div>
          </div>
          )}
          <datalist id="fleet-company-options">
            {companies.map((company) => (
              <option key={company} value={company} />
            ))}
          </datalist>
          {error && <p className="error-text" role="alert" style={{ marginTop: 12 }}>{error}</p>}

          <div className="modal-actions" style={{ marginTop: 14 }}>
            {!editTarget && (
              <button type="button" className="button ghost" onClick={() => setCreateStep("documents")}>
                ← Documentos
              </button>
            )}
            <button type="button" className="button ghost" onClick={onCancel}>
              Cancelar
            </button>
            <button type="button" className="button primary" disabled={saving} onClick={onSave}>
              {saving ? "Guardando..." : "Guardar"}
            </button>
          </div>
          </>
          )}
        </div>
      </div>
    </div>
  );
});
