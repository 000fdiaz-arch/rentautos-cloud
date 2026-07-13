import { findNextChargeDay, parseDateKey, startOfDay } from "../../billing";
import { formatCurrency, formatDate } from "../../format";
import type { Client, OtherChargesRetentionByClient, Payment, PendingBankItem } from "../../types";
import {
  computeEffectiveOtherChargesAllocation,
  getAdvanceLetterLabel,
  getConfiguredOtherChargesRetentionConfig,
  getOtherChargeKey,
  getRetentionCycleLabel,
  roundMoney,
  shouldForceRetentionToOtherCharges
} from "./paymentRules";

type Props = {
  item: PendingBankItem;
  client: Client | null;
  payments: Payment[];
  retentionByClient: OtherChargesRetentionByClient;
  otherChargesInput: Record<string, string>;
  manualOverride: boolean;
  error: string;
  isSaving: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onToggleManualOverride: () => void;
  onOtherChargeChange: (key: string, value: string) => void;
};

export default function PendingBankReview({
  item,
  client,
  payments,
  retentionByClient,
  otherChargesInput,
  manualOverride,
  error,
  isSaving,
  onClose,
  onConfirm,
  onToggleManualOverride,
  onOtherChargeChange
}: Props) {
  if (!client) {
    return (
      <div className="pending-inline-review">
        <p className="hint error-text">El cliente asignado ya no está disponible. Selecciona otro cliente en la fila.</p>
      </div>
    );
  }

  const wholePart = roundMoney(item.capitalPart);
  const centsPart = roundMoney(item.centsPart);
  const retentionConfig = getConfiguredOtherChargesRetentionConfig(client, retentionByClient);
  const hasForcedRule = shouldForceRetentionToOtherCharges(client, retentionByClient, payments, item.dateApplied);
  const forcedRuleActive = hasForcedRule && !manualOverride;
  const { totalOtherCharges, forcedRuleApplied } = computeEffectiveOtherChargesAllocation(
    client,
    otherChargesInput,
    wholePart,
    retentionByClient,
    payments,
    item.dateApplied,
    manualOverride
  );
  const capitalForRent = roundMoney(Math.max(0, wholePart - totalOtherCharges));
  const appliedToRent = roundMoney(Math.min(capitalForRent, Math.max(0, client.balance)));
  const advanceApplied = roundMoney(Math.max(0, wholePart - appliedToRent - totalOtherCharges));
  const balanceAfter = roundMoney(Math.max(0, client.balance - appliedToRent));
  const advanceLetterLabel = getAdvanceLetterLabel(client, advanceApplied);
  const referenceDate = parseDateKey(item.dateApplied) ?? startOfDay(new Date());
  const projectedClient: Client = {
    ...client,
    balance: balanceAfter,
    advanceBalance: roundMoney((client.advanceBalance ?? 0) + advanceApplied),
    savings: roundMoney((client.savings ?? 0) + centsPart)
  };
  const projectedNextPayDate = findNextChargeDay(projectedClient, referenceDate);

  return (
    <div className="pending-inline-review">
      <div className="pending-inline-review__header">
        <div>
          <strong>Revisión de cargos</strong>
          <span>{item.folio} · {client.unitId} - {client.name} · {formatCurrency(item.amountReceived)}</span>
        </div>
        <button type="button" className="button ghost small" onClick={onClose}>Cerrar</button>
      </div>

      {client.otherCharges.length > 0 && (
        <div className="other-charges-section">
          <div className="other-charges-title">Otros cargos</div>
          {hasForcedRule && (
            <div className="pending-inline-review__rule">
              <p className="hint">
                {forcedRuleActive
                  ? `Aplicación automática (${getRetentionCycleLabel(retentionConfig.cycle)}): ${formatCurrency(retentionConfig.amount)}.`
                  : "Edición manual activa para este pago."}
              </p>
              <button type="button" className="button ghost small" onClick={onToggleManualOverride}>
                {forcedRuleActive ? "Editar monto" : "Volver a automático"}
              </button>
            </div>
          )}
          {client.otherCharges.map((charge, index) => {
            const key = getOtherChargeKey(charge, index);
            return (
              <div key={key} className="other-charges-row">
                <label className="payment-label">
                  {charge.label} <span className="amount-muted">({formatCurrency(charge.amount)})</span>
                </label>
                {forcedRuleActive ? (
                  <div className="payment-input">Aplicación automática</div>
                ) : (
                  <input
                    type="number"
                    className="payment-input"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={otherChargesInput[key] ?? ""}
                    onChange={(event) => onOtherChargeChange(key, event.target.value)}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="payment-preview pending-inline-review__preview">
        <div className="payment-preview-title">Resultado del pago</div>
        <div className="payment-preview-body">
          <div className="payment-preview-col">
            <div className="payment-preview-row"><span>Saldo actual</span><strong className="amount-debt">{formatCurrency(client.balance)}</strong></div>
            <div className="payment-preview-row"><span>Aplicado a renta</span><strong>{formatCurrency(appliedToRent)}</strong></div>
            {totalOtherCharges > 0 && <div className="payment-preview-row"><span>{forcedRuleApplied ? "Otros cargos (automático)" : "Otros cargos (manual)"}</span><strong className="amount-warning">{formatCurrency(totalOtherCharges)}</strong></div>}
            {centsPart > 0 && <div className="payment-preview-row"><span>Ahorro</span><strong>{formatCurrency(centsPart)}</strong></div>}
            {advanceApplied > 0 && <div className="payment-preview-row"><span>Pago adelantado</span><strong>{formatCurrency(advanceApplied)}</strong></div>}
            {advanceLetterLabel && <div className="payment-preview-row"><span>Adelanto aplica a</span><strong>{advanceLetterLabel}</strong></div>}
          </div>
          <div className="payment-preview-col">
            <div className="payment-preview-row"><span>Nuevo saldo</span><strong className={balanceAfter <= 0 ? "amount-good" : "amount-debt"}>{formatCurrency(balanceAfter)}</strong></div>
            {projectedNextPayDate && <div className="payment-preview-row"><span>Próxima fecha de pago</span><strong>{formatDate(projectedNextPayDate)}</strong></div>}
          </div>
        </div>
      </div>

      {error && <p className="error-banner" role="alert">{error}</p>}
      <div className="pending-inline-review__actions">
        <button type="button" className="button primary" disabled={isSaving} onClick={onConfirm}>
          {isSaving ? "Aplicando..." : "Aplicar pago"}
        </button>
      </div>
    </div>
  );
}
