import type { Dispatch, RefObject, SetStateAction } from "react";
import { formatCurrency, formatDate } from "../../format";
import type { Client, OtherChargesRetentionCycle } from "../../types";
import { PAYMENT_METHODS } from "./paymentConstants";
import {
  getOtherChargeKey,
  getRetentionCycleLabel,
  roundMoney
} from "./paymentRules";
import type { ManualPaymentAllocation, PaymentForm } from "./paymentTypes";

type MonthEndSuggestion = {
  requiredWholeAmount: number;
  targetDate: Date;
  resultingNextDate: Date | null;
};

type Props = {
  registerSectionRef: RefObject<HTMLElement>;
  isRegisterOpen: boolean;
  selectedClient: Client | null;
  handleClearClient: () => void;
  searchRef: RefObject<HTMLInputElement>;
  clientSearch: string;
  setClientSearch: Dispatch<SetStateAction<string>>;
  dropdownOpen: boolean;
  setDropdownOpen: Dispatch<SetStateAction<boolean>>;
  filteredClients: Client[];
  handleSelectClient: (client: Client) => void;
  registerTravelFundInput: string;
  setRegisterTravelFundInput: Dispatch<SetStateAction<string>>;
  handleSaveSelectedClientTravelFund: () => void;
  operationalDateKey: string;
  form: PaymentForm;
  setForm: Dispatch<SetStateAction<PaymentForm>>;
  isBankPayment: boolean;
  isCardPayment: boolean;
  monthEndSuggestion: MonthEndSuggestion | null;
  handleAutoFillToMonthEnd: () => void;
  autoAmountInfo: string;
  setAutoAmountInfo: Dispatch<SetStateAction<string>>;
  isZeroBalance: boolean;
  isForcedOtherChargesRuleClient: boolean;
  isForcedOtherChargesRuleActive: boolean;
  selectedClientRetentionConfig: {
    amount: number;
    cycle: OtherChargesRetentionCycle;
  };
  setManualOverrideForcedOtherCharges: Dispatch<SetStateAction<boolean>>;
  manualOtherChargesInput: Record<string, string>;
  setManualOtherChargesInput: Dispatch<SetStateAction<Record<string, string>>>;
  preview: ManualPaymentAllocation | null;
  previewAdvanceLetterLabel: string | null;
  projectedNextChargeDate: Date | null;
  errors: string[];
  paymentInfo: string;
  handleConfirmPaymentClick: () => Promise<void>;
  isDateClosed: (dateKey: string) => boolean;
  isConfirmingPayment: boolean;
};

export default function RegisterPaymentPanel({
  registerSectionRef,
  isRegisterOpen,
  selectedClient,
  handleClearClient,
  searchRef,
  clientSearch,
  setClientSearch,
  dropdownOpen,
  setDropdownOpen,
  filteredClients,
  handleSelectClient,
  registerTravelFundInput,
  setRegisterTravelFundInput,
  handleSaveSelectedClientTravelFund,
  operationalDateKey,
  form,
  setForm,
  isBankPayment,
  isCardPayment,
  monthEndSuggestion,
  handleAutoFillToMonthEnd,
  autoAmountInfo,
  setAutoAmountInfo,
  isZeroBalance,
  isForcedOtherChargesRuleClient,
  isForcedOtherChargesRuleActive,
  selectedClientRetentionConfig,
  setManualOverrideForcedOtherCharges,
  manualOtherChargesInput,
  setManualOtherChargesInput,
  preview,
  previewAdvanceLetterLabel,
  projectedNextChargeDate,
  errors,
  paymentInfo,
  handleConfirmPaymentClick,
  isDateClosed,
  isConfirmingPayment
}: Props) {
  return (
    <section id="payment-panel-register" role="tabpanel" aria-labelledby="payment-tab-register" ref={registerSectionRef} className="panel" style={{ display: isRegisterOpen ? undefined : "none" }}>
            <div className="panel-head">
              <h2>Registrar pago</h2>
            </div>

            {isRegisterOpen && (
            <>
            {/* Client selector */}
            <div className="payment-form-grid" style={{ marginTop: 16 }}>
              <div className="payment-field-group" style={{ gridColumn: "1 / -1" }}>
                <label className="payment-label">Cliente</label>
                {selectedClient ? (
                  <div className="client-selected-pill">
                    <span><strong>{selectedClient.unitId}</strong> - {selectedClient.name}{selectedClient.cedula ? ` (${selectedClient.cedula})` : ""}</span>
                    <button type="button" className="client-pill-clear" onClick={handleClearClient} title="Cambiar cliente">X</button>
                  </div>
                ) : (
                  <div className="client-selector">
                    <input
                      ref={searchRef}
                      type="text"
                      className="client-search-input"
                      placeholder="Buscar por unidad, nombre o cedula..."
                      value={clientSearch}
                      onChange={(e) => { setClientSearch(e.target.value); setDropdownOpen(true); }}
                      onFocus={() => setDropdownOpen(true)}
                      onBlur={() => setTimeout(() => setDropdownOpen(false), 150)}
                      autoComplete="off"
                    />
                    {dropdownOpen && filteredClients.length > 0 && (
                      <div className="client-dropdown">
                        {filteredClients.map((c) => (
                          <div key={c.id} className="client-dropdown-item" onMouseDown={() => handleSelectClient(c)}>
                            <strong>{c.unitId}</strong> - {c.name}
                            {c.cedula && <span className="client-dropdown-cedula"> - {c.cedula}</span>}
                            <span className="client-dropdown-balance"> - {formatCurrency(c.balance)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {dropdownOpen && filteredClients.length === 0 && clientSearch.trim() && (
                      <div className="client-dropdown">
                        <div className="client-dropdown-empty">Sin resultados para "{clientSearch}"</div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {selectedClient && (
                <div className="payment-field-group" style={{ gridColumn: "1 / -1" }}>
                  <label className="payment-label">Fondo de viaje (USD)</label>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <input
                      type="number"
                      className="payment-input"
                      min="0"
                      step="0.01"
                      value={registerTravelFundInput}
                      onChange={(e) => setRegisterTravelFundInput(e.target.value)}
                      placeholder="0.00"
                      style={{ maxWidth: 180 }}
                    />
                    <button type="button" className="button ghost small" onClick={handleSaveSelectedClientTravelFund}>
                      Guardar fondo
                    </button>
                    <span className="payment-inline-hint">
                      Disponible actual: {formatCurrency(roundMoney(Math.max(0, selectedClient.travelFundBalance ?? 0)))}
                    </span>
                  </div>
                </div>
              )}

              {/* Date */}
              <div className="payment-field-group">
                <label className="payment-label">Fecha aplicada (automatica por cierre)</label>
                <input
                  type="date"
                  className="payment-input"
                  value={operationalDateKey}
                  disabled
                  readOnly
                />
                <span className="payment-inline-hint">Usa la fecha operativa del negocio en Panama.</span>
              </div>

              {/* Method */}
              <div className="payment-field-group">
                <label className="payment-label">Forma de pago</label>
                <div className="payment-method-grid" role="radiogroup" aria-label="Forma de pago">
                  {PAYMENT_METHODS.map((m) => {
                    const isSelected = form.paymentMethod === m;
                    return (
                      <button
                        key={m}
                        type="button"
                        className={`payment-method-option${isSelected ? " payment-method-option--active" : ""}`}
                        aria-pressed={isSelected}
                        onClick={() => setForm((f) => ({ ...f, paymentMethod: m }))}
                      >
                        {m}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="payment-field-group">
                <label className="payment-label">{(isBankPayment || isCardPayment) ? "Referencia (Folio)" : "Referencia (Opcional)"}</label>
                <input
                  type="text"
                  className="payment-input"
                  placeholder={isBankPayment ? "Obligatorio para pago bancario" : isCardPayment ? "Opcional (si no, se crea folio temporal)" : "Opcional"}
                  value={form.reference}
                  onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
                />
                {(isBankPayment || isCardPayment) && (
                  <span className="payment-inline-hint">
                    {isCardPayment
                      ? "El pago en tarjeta se aplica de inmediato y queda pendiente solo para conciliacion bancaria por folio."
                      : "Para pagos bancarios debes colocar el folio o referencia."}
                  </span>
                )}
              </div>

              {/* Amount */}
              <div className="payment-field-group">
                <label className="payment-label">Monto recibido (USD)</label>
                <input
                  type="number"
                  className="payment-input payment-input--amount"
                  step="0.01"
                  min="0.01"
                  placeholder="0.00"
                  value={form.amountReceived}
                  onChange={(e) => {
                    setForm((f) => ({ ...f, amountReceived: e.target.value }));
                    setAutoAmountInfo("");
                  }}
                />
                {monthEndSuggestion && (
                  <div style={{ marginTop: 8 }}>
                    <button
                      type="button"
                      className="button ghost small"
                      onClick={handleAutoFillToMonthEnd}
                    >
                      Auto hasta fin de mes
                    </button>
                    <span className="payment-inline-hint" style={{ display: "inline-block", marginLeft: 8 }}>
                      Objetivo: {formatDate(monthEndSuggestion.targetDate)}
                    </span>
                  </div>
                )}
                {autoAmountInfo && <span className="payment-inline-hint">{autoAmountInfo}</span>}
              </div>
            </div>

            {/* Zero balance notice */}
            {isZeroBalance && (
              <div className="payment-notice">
                Este cliente no tiene saldo pendiente. El monto se aplicara como pago adelantado de renta.
              </div>
            )}

            {/* Otros cargos */}
            {selectedClient && (selectedClient.otherCharges ?? []).length > 0 && (
              <div className="other-charges-section" style={{ marginTop: 14 }}>
                <div className="other-charges-title">Otros cargos de este cliente</div>
                {isForcedOtherChargesRuleClient && (
                  <>
                    <p className="hint" style={{ marginTop: 4, marginBottom: 8 }}>
                      {isForcedOtherChargesRuleActive
                        ? `Regla automatica activa (${getRetentionCycleLabel(selectedClientRetentionConfig.cycle)}): monto base ${formatCurrency(selectedClientRetentionConfig.amount)}.`
                        : "Edicion manual activa para este pago: puedes definir otros cargos manualmente."}
                    </p>
                    <button
                      type="button"
                      className="button ghost small"
                      onClick={() => setManualOverrideForcedOtherCharges((prev) => !prev)}
                    >
                      {isForcedOtherChargesRuleActive ? "Editar este pago" : "Volver a automatico"}
                    </button>
                  </>
                )}
                {(selectedClient.otherCharges ?? []).map((charge, index) => (
                  <div key={getOtherChargeKey(charge, index)} className="other-charges-row">
                    <label className="payment-label">{charge.label} <span className="amount-muted">(configurado: {formatCurrency(charge.amount)})</span></label>
                    {isForcedOtherChargesRuleActive ? (
                      <div className="payment-input" style={{ display: "flex", alignItems: "center" }}>
                        Aplicacion automatica
                      </div>
                    ) : (
                      <input
                        type="number"
                        className="payment-input"
                        min="0"
                        step="0.01"
                        placeholder={String(charge.amount)}
                        value={manualOtherChargesInput[getOtherChargeKey(charge, index)] ?? charge.amount}
                        onChange={(e) => setManualOtherChargesInput((prev) => ({ ...prev, [getOtherChargeKey(charge, index)]: e.target.value }))}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Preview */}
            {preview && selectedClient && (
              <div className="payment-preview">
                <div className="payment-preview-title">Vista previa del pago</div>
                <div className="payment-preview-body">
                  <div className="payment-preview-col">
                    <div className="payment-preview-row">
                      <span>Saldo actual</span>
                      <strong className="amount-debt">{formatCurrency(preview.balanceBefore)}</strong>
                    </div>
                    <div className="payment-preview-row">
                      <span>Aplicado a renta</span>
                      <strong>{formatCurrency(preview.appliedToRent)}</strong>
                    </div>
                    {preview.totalOtherCharges > 0 && (
                      <div className="payment-preview-row">
                        <span>{preview.forcedOtherChargesRuleApplied ? "Otros cargos (regla automatica)" : "Otros cargos (manual)"}</span>
                        <strong className="amount-warning">{formatCurrency(preview.totalOtherCharges)}</strong>
                      </div>
                    )}
                    {preview.centavosAhorro > 0 && (
                      <div className="payment-preview-row">
                        <span>Ahorro (centavos)</span>
                        <strong>{formatCurrency(preview.centavosAhorro)}</strong>
                      </div>
                    )}
                    {preview.advanceApplied > 0 && (
                      <div className="payment-preview-row">
                        <span>Pago adelantado</span>
                        <strong>{formatCurrency(preview.advanceApplied)}</strong>
                      </div>
                    )}
                    {previewAdvanceLetterLabel && (
                      <div className="payment-preview-row">
                        <span>Adelanto aplica a</span>
                        <strong>{previewAdvanceLetterLabel}</strong>
                      </div>
                    )}
                  </div>
                  <div className="payment-preview-col">
                    <div className="payment-preview-row">
                      <span>Nuevo saldo</span>
                      <strong className={preview.balanceAfter <= 0 ? "amount-good" : "amount-debt"}>{formatCurrency(preview.balanceAfter)}</strong>
                    </div>
                    <div className="payment-preview-row">
                      <span>Cuotas deducidas</span>
                      <strong>{preview.installmentsDeducted}</strong>
                    </div>
                    <div className="payment-preview-row">
                      <span>Cuotas restantes</span>
                      <strong>{Math.max(0, selectedClient.installmentsRemaining - preview.installmentsDeducted)}</strong>
                    </div>
                    {projectedNextChargeDate && (
                      <div className="payment-preview-row">
                        <span>Prox. fecha de pago</span>
                        <strong>{formatDate(projectedNextChargeDate)}</strong>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {errors.length > 0 && (
              <ul className="error-list">{errors.map((e) => <li key={e}>{e}</li>)}</ul>
            )}
            {paymentInfo && <p className="hint recon-info">{paymentInfo}</p>}

            <div style={{ marginTop: 20 }}>
              <button
                type="button"
                className="button primary"
                onClick={() => void handleConfirmPaymentClick()}
                disabled={!form.clientId || !preview || isDateClosed(operationalDateKey) || isConfirmingPayment}
              >
                {isConfirmingPayment ? "Guardando pago..." : "Confirmar pago y generar recibo"}
              </button>
            </div>
            </>
            )}
          </section>
  );
}
