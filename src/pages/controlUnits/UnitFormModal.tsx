import { memo, useEffect, useState } from "react";
import type { ControlUnitRow } from "../../cloudData";
import { findFleetIdentityDuplicate, type UnitFormState } from "./controlUnitsRules";
import { FleetDocumentIntake, type FleetExtractedVehicleData } from "./FleetDocumentIntake";
import { FleetDocumentsPanel } from "./FleetDocumentsPanel";
import { CatalogPhotoEditor } from "./CatalogPhotoEditor";
import { FleetVehicleFields } from "./FleetVehicleFields";

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
  const [detailsTab, setDetailsTab] = useState<"vehicle" | "documents" | "catalog">(catalogOnly ? "catalog" : "vehicle");
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

  function applyExtractedVehicleData(extractedData: FleetExtractedVehicleData) {
    const extractedIdentity = {
      plate: extractedData.plate ?? "",
      engine_serial: extractedData.engine_serial ?? "",
      chassis_serial: extractedData.chassis_serial ?? ""
    };
    const duplicate = findFleetIdentityDuplicate(existingRows, extractedIdentity, editTarget?.fleet_id);
    if (duplicate) {
      setDocumentDuplicateError(`No se pueden cargar estos documentos: la ${duplicate.label} ${duplicate.value} ya está registrada en la unidad ${duplicate.unitId}.`);
      return;
    }
    setDocumentDuplicateError("");
    onFormChange((current) => ({
      ...current,
      ...extractedData
    }));
  }

  return (
    <div className="modal-overlay">
      <div className="modal fleet-create-modal">
        <div className="modal-header">
          <h2>{catalogOnly && editTarget ? `Ficha del catálogo · ${editTarget.unit_id}` : editTarget ? `Editar auto ${editTarget.unit_id}` : "Nuevo auto"}</h2>
          <button type="button" className="modal-close" onClick={onCancel}>X</button>
        </div>
        <div className="modal-body">
          {!editTarget ? (
            <FleetDocumentIntake
              error={documentDuplicateError}
              saving={saving}
              vehicleFields={(
                <FleetVehicleFields
                  form={form}
                  editTarget={editTarget}
                  groups={groups}
                  onFormChange={onFormChange}
                  onUnitIdChange={onUnitIdChange}
                />
              )}
              onDetectedData={applyExtractedVehicleData}
              onCancel={onCancel}
              onSave={onSave}
            />
          ) : (
          <>
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
            <FleetVehicleFields
              form={form}
              editTarget={editTarget}
              groups={groups}
              onFormChange={onFormChange}
              onUnitIdChange={onUnitIdChange}
            />
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
