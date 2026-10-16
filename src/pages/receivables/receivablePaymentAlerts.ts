import { formatCurrency } from "../../format";
import { PLAN_LABEL, WEEKDAY_LABEL, type ReceivableRow } from "../../receivables";

export type ExpectedPaymentAlertKind = "missing" | "partial";

export type ExpectedPaymentAlert = {
  kind: ExpectedPaymentAlertKind;
  title: string;
  message: string;
  calculationLabel: string;
  overdueInstallments: number;
  installmentAmount: number;
  totalOverdueAmount: number;
  amountAppliedToOldestInstallment: number;
  amountMissingFromOldestInstallment: number;
  fullUnpaidInstallments: number;
  fullUnpaidAmount: number;
};

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function normalizedOperationalStatus(row: ReceivableRow): string {
  return (row.operationalStatus ?? "activo")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function plural(value: number, singular: string, pluralLabel: string): string {
  return value === 1 ? singular : pluralLabel;
}

function planPaymentLabel(row: ReceivableRow, count: number): string {
  if (row.plan === "daily") return `${count} ${plural(count, "pago diario", "pagos diarios")}`;
  if (row.plan === "weekly") return `${count} ${plural(count, "letra semanal", "letras semanales")}`;
  if (row.plan === "biweekly") return `${count} ${plural(count, "letra quincenal", "letras quincenales")}`;
  return `${count} ${plural(count, "letra mensual", "letras mensuales")}`;
}

function planOpening(row: ReceivableRow): string {
  if (row.plan === "weekly" && row.weeklyChargeDay) {
    return `Paga cada ${WEEKDAY_LABEL[row.weeklyChargeDay].toLowerCase()}.`;
  }
  if (row.plan === "daily") return "Cliente con pago diario.";
  if (row.plan === "biweekly") return "Cliente con pago quincenal.";
  return `Cliente con pago ${PLAN_LABEL[row.plan].toLowerCase()}.`;
}

/**
 * Interpreta el saldo vencido ya calculado por Cuentas por cobrar.
 * No modifica saldos ni pagos. Un residuo menor que la letra representa una
 * letra parcialmente cubierta bajo la aplicación existente a deuda antigua.
 */
export function expectedPaymentAlertForRow(row: ReceivableRow): ExpectedPaymentAlert | null {
  const operationalStatus = normalizedOperationalStatus(row);
  const isCollectibleClient = row.hasActiveClient && (operationalStatus === "activo" || operationalStatus === "provisional_rental");
  if (!isCollectibleClient || row.daysLate <= 0 || row.overdueBalance <= 0 || row.rentAmount <= 0) return null;

  const installmentCents = Math.max(1, Math.round(row.rentAmount * 100));
  const overdueCents = Math.max(0, Math.round(row.overdueBalance * 100));
  const remainderCents = overdueCents % installmentCents;
  const isPartial = remainderCents > 0;
  const missingCents = isPartial ? remainderCents : Math.min(installmentCents, overdueCents);
  const appliedCents = isPartial ? installmentCents - missingCents : 0;
  const overdueInstallments = Math.max(1, Math.ceil(overdueCents / installmentCents));
  const fullUnpaidInstallments = isPartial ? Math.floor(overdueCents / installmentCents) : overdueInstallments;
  const amountMissingFromOldestInstallment = roundMoney(missingCents / 100);
  const amountAppliedToOldestInstallment = roundMoney(appliedCents / 100);
  const fullUnpaidAmount = roundMoney((fullUnpaidInstallments * installmentCents) / 100);
  const delayLabel = `${row.daysLate} ${plural(row.daysLate, "día", "días")} de atraso`;
  const opening = planOpening(row);

  if (isPartial) {
    return {
      kind: "partial",
      title: "Una letra parcialmente cubierta",
      message: `${opening} Lleva ${delayLabel}.`,
      calculationLabel: `${formatCurrency(row.rentAmount)} de letra − ${formatCurrency(amountAppliedToOldestInstallment)} abonado = ${formatCurrency(amountMissingFromOldestInstallment)} pendiente`,
      overdueInstallments,
      installmentAmount: row.rentAmount,
      totalOverdueAmount: row.overdueBalance,
      amountAppliedToOldestInstallment,
      amountMissingFromOldestInstallment,
      fullUnpaidInstallments,
      fullUnpaidAmount
    };
  }

  return {
    kind: "missing",
    title: `${planPaymentLabel(row, overdueInstallments)} sin cubrir`,
    message: `${opening} Lleva ${delayLabel}.`,
    calculationLabel: `${planPaymentLabel(row, overdueInstallments)} por ${formatCurrency(row.rentAmount)} = ${formatCurrency(row.overdueBalance)} vencido`,
    overdueInstallments,
    installmentAmount: row.rentAmount,
    totalOverdueAmount: row.overdueBalance,
    amountAppliedToOldestInstallment,
    amountMissingFromOldestInstallment,
    fullUnpaidInstallments,
    fullUnpaidAmount
  };
}
