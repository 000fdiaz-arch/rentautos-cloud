import type { Dispatch, FormEvent, SetStateAction } from "react";
import type { BillingFrequency, WeeklyChargeDay } from "../../types";
import { FREQUENCY_LABEL } from "./clientConstants";
import { createOtherChargeForm, normalizePhoneDigits } from "./clientRules";
import type { ClientForm, EditClientTab } from "./clientTypes";

type SharedProps = {
  form: ClientForm;
  setForm: Dispatch<SetStateAction<ClientForm>>;
  availableUnitOptions: string[];
  errorFields: Set<string>;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  onInstallmentChange: (field: "installmentsAgreed" | "installmentsRemaining", value: string) => void;
  installmentLiveError: string | null;
  errors: string[];
};

type EditProps = SharedProps & {
  editingClientId: string | null;
  onCancel: () => void;
  editClientTab: EditClientTab;
  setEditClientTab: Dispatch<SetStateAction<EditClientTab>>;
};

function IssuedInstallmentsSummary({ value }: { value: string }) {
  const issued = Number.parseInt(value, 10);
  return (
    <aside className="client-installments-issued-summary" aria-label="Resumen automático de cuotas emitidas">
      <div>
        <span>Resumen automático</span>
        <strong>Cuotas emitidas</strong>
        <small>Sumatoria registrada por el sistema. Este valor no se puede editar.</small>
      </div>
      <output aria-label="Total de cuotas emitidas">{Number.isFinite(issued) ? Math.max(issued, 0) : 0}</output>
    </aside>
  );
}

export function EditClientDialog({
  editingClientId,
  onCancel: handleCancelEdit,
  form,
  setForm,
  editClientTab,
  setEditClientTab,
  availableUnitOptions,
  errorFields,
  onSubmit: handleSubmitClient,
  onInstallmentChange: handleInstallmentChange,
  installmentLiveError,
  errors
}: EditProps) {
  return (
    <>
      {editingClientId !== null && (
            <div className="modal-overlay" onClick={handleCancelEdit}>
              <div className="modal edit-client-modal" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                  <h2>Editar cliente</h2>
                  <button type="button" className="modal-close" onClick={handleCancelEdit}>X</button>
                </div>
                <div className="modal-body edit-client-modal-body">
                  <div className="edit-client-summary">
                    <div><span className="hint">Unidad</span><p>{form.unitId || "-"}</p></div>
                    <div><span className="hint">Cliente</span><p>{form.name || "-"}</p></div>
                    <div><span className="hint">Frecuencia</span><p>{FREQUENCY_LABEL[form.frequency]}</p></div>
                    <div><span className="hint">Saldo</span><p>{form.initialBalance || "0.00"}</p></div>
                  </div>
                  <IssuedInstallmentsSummary value={form.installmentsIssued} />
                  <div className="cash-view-tabs" style={{ marginBottom: 12 }}>
                    <button type="button" className={`button ghost small ${editClientTab === "identidad" ? "cash-tab-active" : ""}`} onClick={() => setEditClientTab("identidad")}>Identidad</button>
                    <button type="button" className={`button ghost small ${editClientTab === "plan" ? "cash-tab-active" : ""}`} onClick={() => setEditClientTab("plan")}>Plan y Cobranza</button>
                    <button type="button" className={`button ghost small ${editClientTab === "cargos" ? "cash-tab-active" : ""}`} onClick={() => setEditClientTab("cargos")}>Otros cargos</button>
                    <button type="button" className={`button ghost small ${editClientTab === "estado" ? "cash-tab-active" : ""}`} onClick={() => setEditClientTab("estado")}>Estado</button>
                  </div>
                  <form className="form-grid edit-client-form-grid" onSubmit={handleSubmitClient}>
                    {editClientTab === "identidad" && (
                      <>
                        <label>UNIDAD
                          <select value={form.unitId} onChange={(e) => setForm((c) => ({ ...c, unitId: e.target.value.toUpperCase() }))} className={errorFields.has("unitId") ? "input-error" : undefined} required>
                            <option value="">Selecciona unidad...</option>
                            {availableUnitOptions.map((unit) => (
                              <option key={unit} value={unit}>{unit}</option>
                            ))}
                          </select>
                        </label>
                        <label>Cedula
                          <input type="text" value={form.cedula} onChange={(e) => setForm((c) => ({ ...c, cedula: e.target.value }))} placeholder="Ej. 8-123-456" />
                        </label>
                        <label>Nombre
                          <input type="text" value={form.name} onChange={(e) => setForm((c) => ({ ...c, name: e.target.value }))} placeholder="Ej. Richard Alexander" className={errorFields.has("name") ? "input-error" : undefined} required />
                        </label>
                        <label>WhatsApp
                          <input type="tel" inputMode="numeric" pattern="[0-9]*" value={form.whatsAppPhone} onChange={(e) => setForm((c) => ({ ...c, whatsAppPhone: normalizePhoneDigits(e.target.value) }))} placeholder="Ej. 68842222" />
                        </label>
                        <label>Fecha primer cobro
                          <input type="date" value={form.firstChargeDate} onChange={(e) => setForm((c) => ({ ...c, firstChargeDate: e.target.value }))} className={errorFields.has("firstChargeDate") ? "input-error" : undefined} required />
                        </label>
                      </>
                    )}
                    {editClientTab === "plan" && (
                      <>
                        <label>Renta (USD)
                          <input type="number" step="0.01" min="0" value={form.rentAmount} onChange={(e) => setForm((c) => ({ ...c, rentAmount: e.target.value }))} placeholder="0.00" className={errorFields.has("rentAmount") ? "input-error" : undefined} required />
                        </label>
                        <label>Frecuencia
                          <select value={form.frequency} onChange={(e) => setForm((c) => ({ ...c, frequency: e.target.value as BillingFrequency }))}>
                            <option value="daily">Diario</option>
                            <option value="weekly">Semanal</option>
                            <option value="biweekly">Quincenal</option>
                            <option value="monthly">Mensual</option>
                          </select>
                        </label>
                        {form.frequency === "daily" && (
                          <label>
                            <span style={{ textTransform: "none", letterSpacing: "normal", fontWeight: 600 }}>Cobrar primer domingo</span>
                            <select value={form.chargeFirstSunday ? "yes" : "no"} onChange={(e) => setForm((c) => ({ ...c, chargeFirstSunday: e.target.value === "yes" }))}>
                              <option value="no">No</option>
                              <option value="yes">Si</option>
                            </select>
                          </label>
                        )}
                        {form.frequency === "weekly" && (
                          <label>Dia de cobro semanal
                            <select value={form.weeklyChargeDay} onChange={(e) => setForm((c) => ({ ...c, weeklyChargeDay: e.target.value as WeeklyChargeDay }))}>
                              <option value="monday">Lunes</option>
                              <option value="tuesday">Martes</option>
                              <option value="wednesday">Miercoles</option>
                              <option value="thursday">Jueves</option>
                              <option value="friday">Viernes</option>
                              <option value="saturday">Sabado</option>
                            </select>
                          </label>
                        )}
                        {form.frequency === "monthly" && (
                          <label>Dia del mes para cobrar
                            <input type="number" min="1" max="31" step="1" value={form.monthlyChargeDay} onChange={(e) => setForm((c) => ({ ...c, monthlyChargeDay: e.target.value }))} className={errorFields.has("monthlyChargeDay") ? "input-error" : undefined} required />
                          </label>
                        )}
                        <label>Cuotas pactadas
                          <input type="number" step="1" min="0" value={form.installmentsAgreed} onChange={(e) => handleInstallmentChange("installmentsAgreed", e.target.value)} className={errorFields.has("installmentsAgreed") ? "input-error" : undefined} required />
                        </label>
                        <label>Cuotas restantes
                          <input type="number" step="1" min="0" value={form.installmentsRemaining} onChange={(e) => handleInstallmentChange("installmentsRemaining", e.target.value)} className={errorFields.has("installmentsRemaining") ? "input-error" : undefined} required />
                        </label>
                        <label>Cuotas pagadas
                          <input type="number" step="1" min="0" value={form.installmentsPaid} readOnly />
                        </label>
                        <label>MONTO A COBRAR (USD)
                          <input type="number" step="0.01" min="0" value={form.initialBalance} onChange={(e) => setForm((c) => ({ ...c, initialBalance: e.target.value }))} placeholder="0.00" className={errorFields.has("initialBalance") ? "input-error" : undefined} required />
                        </label>
                        <label>FONDO DE VIAJE (USD)
                          <input type="number" step="0.01" min="0" value={form.travelFundBalance} onChange={(e) => setForm((c) => ({ ...c, travelFundBalance: e.target.value }))} placeholder="0.00" className={errorFields.has("travelFundBalance") ? "input-error" : undefined} required />
                        </label>
                      </>
                    )}
                    {editClientTab === "cargos" && (
                      <div className="other-charges-section" style={{ gridColumn: "1 / -1" }}>
                        <div className="other-charges-header">
                          <span>Otros cargos</span>
                          <button type="button" className="button ghost small" onClick={() =>
                            setForm((c) => ({ ...c, otherCharges: [...c.otherCharges, createOtherChargeForm()] }))
                          }>+ Agregar</button>
                        </div>
                        {form.otherCharges.map((charge, i) => (
                          <div key={i} className="other-charge-row">
                            <input type="text" placeholder="Concepto" value={charge.label}
                              onChange={(e) => setForm((c) => ({ ...c, otherCharges: c.otherCharges.map((ch, idx) => idx === i ? { ...ch, label: e.target.value } : ch) }))} />
                            <input type="number" step="0.01" min="0" placeholder="0.00" value={charge.amount}
                              onChange={(e) => setForm((c) => ({ ...c, otherCharges: c.otherCharges.map((ch, idx) => idx === i ? { ...ch, amount: e.target.value } : ch) }))} />
                            <button type="button" className="other-charge-remove" onClick={() =>
                              setForm((c) => ({ ...c, otherCharges: c.otherCharges.filter((_, idx) => idx !== i) }))
                            }>X</button>
                          </div>
                        ))}
                      </div>
                    )}
                    {editClientTab === "estado" && (
                      <div className="cash-subpanel" style={{ gridColumn: "1 / -1" }}>
                        <h3>Estado operativo</h3>
                        <p className="hint">El estado se edita desde la tabla principal en la columna Cobranza.</p>
                      </div>
                    )}
                    <div className="modal-actions edit-client-footer">
                      <button type="submit" className={`button primary ${installmentLiveError ? "button-disabled" : ""}`} disabled={installmentLiveError !== null}>
                        Guardar cambios
                      </button>
                      <button type="button" className="button ghost" onClick={handleCancelEdit}>Cancelar</button>
                    </div>
                  </form>
                  {form.frequency === "daily" && <p className="hint">Regla diaria: cobro automatico de lunes a sabado.</p>}
                  {form.frequency === "daily" && form.chargeFirstSunday && <p className="hint">Incluye el primer domingo automaticamente una sola vez.</p>}
                  {form.frequency === "biweekly" && <p className="hint">Regla quincenal: cobros fijos dia 15 y fin de mes.</p>}
                  {form.frequency === "monthly" && <p className="hint">Regla mensual: si el dia configurado cae domingo, el cobro se mueve al lunes siguiente.</p>}
                  {errors.length > 0 && <ul className="error-list">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
                  {installmentLiveError !== null && <ul className="error-list"><li>{installmentLiveError}</li></ul>}
                </div>
              </div>
            </div>
          )}
    </>
  );
}

type CreateProps = SharedProps & {
  isOpen: boolean;
  onClose: () => void;
};

export function CreateClientDialog({
  isOpen: isFormOpen,
  onClose,
  form,
  setForm,
  availableUnitOptions,
  errorFields,
  onSubmit: handleSubmitClient,
  onInstallmentChange: handleInstallmentChange,
  installmentLiveError,
  errors
}: CreateProps) {
  const setIsFormOpen = (open: boolean) => {
    if (!open) onClose();
  };

  return (
    <>
      {isFormOpen && (
            <div className="modal-overlay" onClick={() => setIsFormOpen(false)}>
              <div className="modal edit-client-modal" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                  <h2>Agregar cliente</h2>
                  <button type="button" className="modal-close" onClick={() => setIsFormOpen(false)}>X</button>
                </div>
                <div className="modal-body edit-client-modal-body">
                  <IssuedInstallmentsSummary value={form.installmentsIssued} />
                  <form className="form-grid" onSubmit={handleSubmitClient}>
                <label>
                  UNIDAD
                  <select value={form.unitId} onChange={(e) => setForm((c) => ({ ...c, unitId: e.target.value.toUpperCase() }))} className={errorFields.has("unitId") ? "input-error" : undefined} required>
                    <option value="">Selecciona unidad...</option>
                    {availableUnitOptions.map((unit) => (
                      <option key={unit} value={unit}>{unit}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Cedula
                  <input type="text" value={form.cedula} onChange={(e) => setForm((c) => ({ ...c, cedula: e.target.value }))} placeholder="Ej. 8-123-456" />
                </label>
                <label>
                  Nombre
                  <input type="text" value={form.name} onChange={(e) => setForm((c) => ({ ...c, name: e.target.value }))} placeholder="Ej. Richard Alexander" className={errorFields.has("name") ? "input-error" : undefined} required />
                </label>
                <label>
                  WhatsApp
                  <input type="tel" inputMode="numeric" pattern="[0-9]*" value={form.whatsAppPhone} onChange={(e) => setForm((c) => ({ ...c, whatsAppPhone: normalizePhoneDigits(e.target.value) }))} placeholder="Ej. 68842222" />
                </label>
                <label>
                  Fecha primer cobro
                  <input type="date" value={form.firstChargeDate} onChange={(e) => setForm((c) => ({ ...c, firstChargeDate: e.target.value }))} className={errorFields.has("firstChargeDate") ? "input-error" : undefined} required />
                </label>
                <label>
                  Renta (USD)
                  <input type="number" step="0.01" min="0" value={form.rentAmount} onChange={(e) => setForm((c) => ({ ...c, rentAmount: e.target.value }))} placeholder="0.00" className={errorFields.has("rentAmount") ? "input-error" : undefined} required />
                </label>
                <label>
                  Frecuencia
                  <select value={form.frequency} onChange={(e) => setForm((c) => ({ ...c, frequency: e.target.value as BillingFrequency }))}>
                    <option value="daily">Diario</option>
                    <option value="weekly">Semanal</option>
                    <option value="biweekly">Quincenal</option>
                    <option value="monthly">Mensual</option>
                  </select>
                </label>
                {form.frequency === "daily" && (
                  <label>
                    <span style={{ textTransform: "none", letterSpacing: "normal", fontWeight: 600 }}>Cobrar primer domingo</span>
                    <select value={form.chargeFirstSunday ? "yes" : "no"} onChange={(e) => setForm((c) => ({ ...c, chargeFirstSunday: e.target.value === "yes" }))}>
                      <option value="no">No</option>
                      <option value="yes">Si</option>
                    </select>
                  </label>
                )}
                {form.frequency === "weekly" && (
                  <label>
                    Dia de cobro semanal
                    <select value={form.weeklyChargeDay} onChange={(e) => setForm((c) => ({ ...c, weeklyChargeDay: e.target.value as WeeklyChargeDay }))}>
                      <option value="monday">Lunes</option>
                      <option value="tuesday">Martes</option>
                      <option value="wednesday">Miercoles</option>
                      <option value="thursday">Jueves</option>
                      <option value="friday">Viernes</option>
                      <option value="saturday">Sabado</option>
                    </select>
                  </label>
                )}
                {form.frequency === "monthly" && (
                  <label>
                    Dia del mes para cobrar
                    <input type="number" min="1" max="31" step="1" value={form.monthlyChargeDay} onChange={(e) => setForm((c) => ({ ...c, monthlyChargeDay: e.target.value }))} required />
                  </label>
                )}
                <label>
                  Cuotas pactadas
                  <input type="number" step="1" min="0" value={form.installmentsAgreed} onChange={(e) => handleInstallmentChange("installmentsAgreed", e.target.value)} className={errorFields.has("installmentsAgreed") ? "input-error" : undefined} required />
                </label>
                <label>
                  Cuotas restantes
                  <input type="number" step="1" min="0" value={form.installmentsRemaining} onChange={(e) => handleInstallmentChange("installmentsRemaining", e.target.value)} className={errorFields.has("installmentsRemaining") ? "input-error" : undefined} required />
                </label>
                <label>
                  Cuotas pagadas
                  <input type="number" step="1" min="0" value={form.installmentsPaid} readOnly />
                </label>
                <label>
                  MONTO A COBRAR (USD)
                  <input type="number" step="0.01" min="0" value={form.initialBalance} onChange={(e) => setForm((c) => ({ ...c, initialBalance: e.target.value }))} placeholder="0.00" className={errorFields.has("initialBalance") ? "input-error" : undefined} required />
                </label>
                <label>
                  FONDO DE VIAJE (USD)
                  <input type="number" step="0.01" min="0" value={form.travelFundBalance} onChange={(e) => setForm((c) => ({ ...c, travelFundBalance: e.target.value }))} placeholder="0.00" className={errorFields.has("travelFundBalance") ? "input-error" : undefined} required />
                </label>
                <div className="other-charges-section">
                  <div className="other-charges-header">
                    <span>Otros cargos</span>
                    <button type="button" className="button ghost small" onClick={() =>
                      setForm((c) => ({ ...c, otherCharges: [...c.otherCharges, createOtherChargeForm()] }))
                    }>+ Agregar</button>
                  </div>
                  {form.otherCharges.map((charge, i) => (
                    <div key={i} className="other-charge-row">
                      <input type="text" placeholder="Concepto (ej. Mantenimiento)" value={charge.label}
                        onChange={(e) => setForm((c) => ({ ...c, otherCharges: c.otherCharges.map((ch, idx) => idx === i ? { ...ch, label: e.target.value } : ch) }))} />
                      <input type="number" step="0.01" min="0" placeholder="0.00" value={charge.amount}
                        onChange={(e) => setForm((c) => ({ ...c, otherCharges: c.otherCharges.map((ch, idx) => idx === i ? { ...ch, amount: e.target.value } : ch) }))} />
                      <button type="button" className="other-charge-remove" onClick={() =>
                        setForm((c) => ({ ...c, otherCharges: c.otherCharges.filter((_, idx) => idx !== i) }))
                      }>X</button>
                    </div>
                  ))}
                </div>
                <button type="submit" className={`button primary ${installmentLiveError ? "button-disabled" : ""}`} disabled={installmentLiveError !== null}>
                  Guardar cliente
                </button>
                  </form>
                  {form.frequency === "daily" && <p className="hint">Regla diaria: cobro automatico de lunes a sabado.</p>}
                  {form.frequency === "daily" && form.chargeFirstSunday && <p className="hint">Incluye el primer domingo automaticamente una sola vez.</p>}
                  {form.frequency === "biweekly" && <p className="hint">Regla quincenal: cobros fijos dia 15 y fin de mes.</p>}
                  {form.frequency === "monthly" && <p className="hint">Regla mensual: si el dia configurado cae domingo, el cobro se mueve al lunes siguiente.</p>}
                  {errors.length > 0 && <ul className="error-list">{errors.map((error) => <li key={error}>{error}</li>)}</ul>}
                  {installmentLiveError !== null && <ul className="error-list"><li>{installmentLiveError}</li></ul>}
                </div>
              </div>
            </div>
          )}
    </>
  );
}
