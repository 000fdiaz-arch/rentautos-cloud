import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { formatCurrency, formatDate } from "../format";
import { findNextChargeDay, startOfDay } from "../billing";
import type { Payment } from "../types";
import {
  buildCoveredPaymentRows,
  buildReceiptFileName,
  buildRentPaymentBreakdownRows,
  buildZipFileName,
  extractFolio,
  formatDateSpanish,
  formatDateSpanishSingleLine,
  getPartialMissingLabel,
  diffDays,
  findDebtStartDateForReceipt,
  roundMoney,
  type CoveredPaymentRow
} from "./paymentReceiptRules";

type Props = {
  payment: Payment;
  onClose: () => void;
  closeLabel?: string;
  receiptFormat?: ReceiptFormat;
};

export type ReceiptFormat = "standard" | "history";

type ReceiptRenderOptions = {
  format?: ReceiptFormat;
};

const RECEIPT_IMAGE_SCALE = 3;
const HISTORY_RECEIPT_IMAGE_SCALE = 1;
const STANDARD_RECEIPT_RENDER_WIDTH = "760px";
const HISTORY_RECEIPT_RENDER_WIDTH = "528px";

async function renderReceiptCanvasFromPayment(payment: Payment, options: ReceiptRenderOptions = {}): Promise<HTMLCanvasElement> {
  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.left = "-10000px";
  host.style.top = "0";
  host.style.width = options.format === "history" ? HISTORY_RECEIPT_RENDER_WIDTH : STANDARD_RECEIPT_RENDER_WIDTH;
  host.style.pointerEvents = "none";
  host.style.zIndex = "-1";
  host.setAttribute("aria-hidden", "true");
  document.body.appendChild(host);

  const root = createRoot(host);

  try {
    root.render(
      <div className="receipt-page">
        <div className={options.format === "history" ? "receipt-export-frame" : undefined}>
          <div className={options.format === "history" ? "receipt-card receipt-card--history receipt-card--image-export" : "receipt-card"}>
            <ReceiptCardContent payment={payment} format={options.format ?? "standard"} />
          </div>
        </div>
      </div>
    );

    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    if (document.fonts?.ready) {
      await document.fonts.ready;
    }

    const target = host.querySelector(options.format === "history" ? ".receipt-export-frame" : ".receipt-card") as HTMLDivElement | null;
    if (!target) {
      throw new Error("Receipt preview container was not rendered.");
    }

    const html2canvas = (await import("html2canvas")).default;
    return html2canvas(target, {
      scale: options.format === "history" ? HISTORY_RECEIPT_IMAGE_SCALE : RECEIPT_IMAGE_SCALE,
      backgroundColor: "#ffffff",
      useCORS: true,
      width: target.scrollWidth,
      height: target.scrollHeight
    });
  } finally {
    root.unmount();
    document.body.removeChild(host);
  }
}

async function renderReceiptCanvasFromElement(target: HTMLElement): Promise<HTMLCanvasElement> {
  const html2canvas = (await import("html2canvas")).default;
  return html2canvas(target, {
    scale: RECEIPT_IMAGE_SCALE,
    backgroundColor: "#ffffff",
    useCORS: true,
    width: target.scrollWidth,
    height: target.scrollHeight
  });
}

export async function downloadPaymentReceiptImage(payment: Payment, renderedCard?: HTMLElement | null): Promise<void> {
  const { fileName, blob } = renderedCard
    ? await (async () => {
      const canvas = await renderReceiptCanvasFromElement(renderedCard);
      const fileName = buildReceiptFileName(payment);
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((value) => {
          if (value) resolve(value);
          else reject(new Error("No se pudo convertir el recibo a imagen."));
        }, "image/png");
      });
      return { fileName, blob };
    })()
    : await buildPaymentReceiptImageBlob(payment);
  const link = document.createElement("a");
  const href = URL.createObjectURL(blob);
  link.download = fileName;
  link.href = href;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

export async function buildPaymentReceiptImageBlob(payment: Payment, options: ReceiptRenderOptions = {}): Promise<{ fileName: string; blob: Blob }> {
  const canvas = await renderReceiptCanvasFromPayment(payment, options);
  const fileName = buildReceiptFileName(payment);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => {
      if (value) resolve(value);
      else reject(new Error("No se pudo convertir el recibo a imagen."));
    }, "image/png");
  });
  return { fileName, blob };
}

export async function copyPaymentReceiptImage(payment: Payment, options: ReceiptRenderOptions = {}): Promise<void> {
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
    throw new Error("El navegador no permite copiar imagenes al portapapeles.");
  }

  // Se inicia durante el clic para conservar el permiso mientras se renderiza.
  const receiptBlob = buildPaymentReceiptImageBlob(payment, options).then(({ blob }) => blob);
  await navigator.clipboard.write([
    new ClipboardItem({
      "image/png": receiptBlob
    })
  ]);
}

export async function copyHistoryPaymentReceiptImage(payment: Payment): Promise<void> {
  await copyPaymentReceiptImage(payment, { format: "history" });
}

export async function downloadPaymentsReceiptsZip(payments: Payment[], options: ReceiptRenderOptions = {}): Promise<void> {
  if (payments.length === 0) {
    throw new Error("No hay pagos seleccionados.");
  }

  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  const namesCount = new Map<string, number>();

  for (const payment of payments) {
    const { fileName, blob } = await buildPaymentReceiptImageBlob(payment, options);
    const currentCount = namesCount.get(fileName) ?? 0;
    namesCount.set(fileName, currentCount + 1);

    const finalName =
      currentCount === 0
        ? fileName
        : fileName.replace(/\.png$/i, `-${currentCount + 1}.png`);

    zip.file(finalName, blob);
  }

  const zipBlob = await zip.generateAsync({ type: "blob" });
  const downloadName = buildZipFileName(payments);
  const link = document.createElement("a");
  const href = URL.createObjectURL(zipBlob);
  link.download = downloadName;
  link.href = href;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

function ReceiptCardContent({ payment, format = "standard" }: { payment: Payment; format?: ReceiptFormat }) {
  const weeklyDayLabel =
    payment.weeklyChargeDay === "monday"
      ? "Lunes"
      : payment.weeklyChargeDay === "tuesday"
      ? "Martes"
      : payment.weeklyChargeDay === "wednesday"
      ? "Miercoles"
      : payment.weeklyChargeDay === "thursday"
      ? "Jueves"
      : payment.weeklyChargeDay === "friday"
      ? "Viernes"
      : payment.weeklyChargeDay === "saturday"
      ? "Sabado"
      : "";

  const frequencyLabel =
    payment.frequency === "daily"
      ? "Diario"
      : payment.frequency === "weekly"
      ? `Semanal${weeklyDayLabel ? ` (${weeklyDayLabel})` : ""}`
      : payment.frequency === "biweekly"
      ? "Quincenal"
      : "Mensual";
  const installmentsFromDebt = Math.max(0, payment.installmentsFromDebt ?? payment.installmentsDeducted ?? 0);
  const installmentsFromAdvance = Math.max(
    0,
    payment.installmentsFromAdvance ??
      (payment.rentAmount > 0 ? Math.floor((payment.advanceApplied ?? 0) / payment.rentAmount) : 0)
  );
  const installmentsTotalInPayment = Math.max(
    0,
    payment.installmentsTotalInPayment ?? installmentsFromDebt + installmentsFromAdvance
  );
  const installmentsPaidIncludingAdvance = Math.max(0, payment.installmentsPaidAfter + installmentsFromAdvance);
  const paymentDate = startOfDay(new Date(payment.dateApplied + "T12:00:00"));
  const advanceApplied = Math.max(0, payment.advanceApplied ?? 0);
  const advanceBalanceAfter = roundMoney(Math.max(0, payment.advanceBalanceAfter ?? advanceApplied));
  const minimalClient = {
    balance: payment.balanceAfter,
    rentAmount: payment.rentAmount,
    frequency: payment.frequency,
    weeklyChargeDay: payment.weeklyChargeDay,
    monthlyChargeDay: payment.monthlyChargeDay,
    chargeFirstSunday: payment.chargeFirstSunday,
    firstSundayChargedAt: payment.firstSundayChargedAt,
    advanceBalance: advanceBalanceAfter,
    // campos requeridos por la firma
    id: "", unitId: "", name: "", installmentsAgreed: 0,
    installmentsRemaining: 0, installmentsPaid: payment.installmentsPaidAfter,
    otherCharges: [], savings: 0, status: "activo" as const, createdAt: ""
  };
  const minimalClientWithoutAdvance = {
    ...minimalClient,
    advanceBalance: 0
  };
  const otherChargesApplied = payment.otherChargesApplied ?? [];
  const otherChargesDueAfter = payment.otherChargesDueAfter ?? [];
  const otherChargesDueTotal = otherChargesDueAfter.reduce((sum, charge) => sum + charge.amount, 0);
  const moroseBalanceToday = Math.max(0, payment.balanceAfter);
  const hasMoroseBalance = moroseBalanceToday > 0;
  const normalizedRent = roundMoney(Math.max(0, payment.rentAmount));
  const nextChargeDate = normalizedRent > 0 ? findNextChargeDay(minimalClientWithoutAdvance, paymentDate) : null;
  const nextPaymentDate = normalizedRent > 0 ? findNextChargeDay(minimalClient, paymentDate) : null;
  const debtStartDate = normalizedRent > 0 && hasMoroseBalance ? findDebtStartDateForReceipt(payment, paymentDate) : null;
  const badgeDate = hasMoroseBalance ? debtStartDate : nextPaymentDate;
  const badgeDaysDelta = badgeDate ? diffDays(paymentDate, badgeDate) : null;
  const isDailyPlan = payment.frequency === "daily";
  const badgeTone =
    hasMoroseBalance
      ? "danger"
      : badgeDate === null
      ? "neutral"
      : badgeDaysDelta !== null && badgeDaysDelta < 0
      ? "danger"
      : isDailyPlan
      ? (badgeDaysDelta === 0 ? "warning" : "success")
      : (badgeDaysDelta !== null && badgeDaysDelta <= 3 ? "warning" : "success");
  const badgeLabel = hasMoroseBalance ? "Pago vencido desde" : "Proximo pago";
  const badgeText = badgeDate ? `${badgeLabel}: ${formatDate(badgeDate)}` : `${badgeLabel}: por definir`;
  const advanceAppliedToNextInstallment = normalizedRent > 0 ? roundMoney(Math.min(advanceBalanceAfter, normalizedRent)) : 0;
  const advanceRemainingForNextInstallment = normalizedRent > 0
    ? roundMoney(Math.max(0, normalizedRent - advanceAppliedToNextInstallment))
    : 0;
  const hasAdvancePanel = advanceApplied > 0 && normalizedRent > 0;
  const hasAdvancePendingForNextInstallment = hasAdvancePanel && advanceRemainingForNextInstallment > 0;
  const appliedToCurrentRent = roundMoney(Math.max(0, payment.appliedToRent));
  const hasPartialForOneAccount =
    hasMoroseBalance &&
    normalizedRent > 0 &&
    roundMoney(moroseBalanceToday % normalizedRent) > 0;
  const saldoParaBajarCuenta = hasPartialForOneAccount
    ? roundMoney(moroseBalanceToday % normalizedRent)
    : 0;
  const saldoParaBajarHoy = hasMoroseBalance
    ? (
      hasPartialForOneAccount
        ? saldoParaBajarCuenta
        : roundMoney(Math.min(moroseBalanceToday, normalizedRent > 0 ? normalizedRent : moroseBalanceToday))
    )
    : 0;
  const saldoCorriente =
    hasMoroseBalance
      ? roundMoney(Math.max(0, moroseBalanceToday - saldoParaBajarCuenta))
      : 0;
  const saldoCorrienteCuotas =
    normalizedRent > 0
      ? Math.floor((saldoCorriente + Number.EPSILON) / normalizedRent)
      : 0;
  const saldoCorrienteCuotasLabel =
    saldoCorrienteCuotas > 0
      ? ` (${saldoCorrienteCuotas === 1 ? "1 cta" : `${saldoCorrienteCuotas} ctas`})`
      : "";
  const saldoParaBajarCuentaLabel = hasPartialForOneAccount ? " (1 cuota parcial)" : "";
  const totalPendienteRenta = roundMoney(Math.max(0, moroseBalanceToday));
  const totalPendienteCuotas = normalizedRent > 0 ? Math.ceil((totalPendienteRenta + Number.EPSILON) / normalizedRent) : 0;
  const totalPendienteCuotasLabel =
    totalPendienteCuotas > 0
      ? ` (${totalPendienteCuotas === 1 ? "1 cta" : `${totalPendienteCuotas} ctas`})`
      : "";
  const totalPending = Math.max(0, moroseBalanceToday + otherChargesDueTotal);
  const hasPending = totalPending > 0;
  const travelFundBalance = roundMoney(Math.max(0, payment.travelFundAvailableSnapshot ?? 0));
  const hasTravelFundBalance = travelFundBalance > 0;
  const folio = payment.reference ? extractFolio(payment.reference) : "";
  const isPendingCardSettlement =
    payment.paymentMethod === "Tarjeta" &&
    (payment.reference ?? "").toUpperCase().includes("TARJETA-PENDIENTE-CONCILIACION");

  if (format === "history") {
    const coveredRows = buildCoveredPaymentRows(payment);
    const partialRow = coveredRows.find((row) => row.status === "partial");
    const missingForPartial = partialRow?.amount && normalizedRent > 0
      ? roundMoney(Math.max(0, normalizedRent - partialRow.amount))
      : saldoParaBajarCuenta;
    const rentPendingAmount = roundMoney(Math.max(0, moroseBalanceToday));
    const otherChargesPendingAmount = roundMoney(Math.max(0, otherChargesDueTotal));
    const rentPendingInstallments = normalizedRent > 0 ? Math.ceil((rentPendingAmount + Number.EPSILON) / normalizedRent) : 0;
    const rentPendingInstallmentsLabel = rentPendingInstallments === 1 ? "1 cta" : `${rentPendingInstallments} ctas`;
    const rentPartialPendingAmount = hasPartialForOneAccount ? roundMoney(saldoParaBajarCuenta) : 0;
    const rentCompletePendingAmount = roundMoney(Math.max(0, rentPendingAmount - rentPartialPendingAmount));
    const rentCompletePendingInstallments = normalizedRent > 0
      ? Math.floor((rentCompletePendingAmount + Number.EPSILON) / normalizedRent)
      : 0;
    const rentCompletePendingLabel = rentCompletePendingInstallments === 1 ? "1 cta" : `${rentCompletePendingInstallments} ctas`;
    const shouldShowPartialMissing = partialRow && missingForPartial > 0 && Math.abs(missingForPartial - rentPendingAmount) > 0.009;
    const partialFuturePendingAmount = !hasPending && partialRow && missingForPartial > 0 ? missingForPartial : 0;
    const rentBreakdownQueue = buildRentPaymentBreakdownRows(payment);
    const takeRentAmountForCycle = (row: CoveredPaymentRow): number => {
      const index = rentBreakdownQueue.findIndex((item) => item.label === row.dateLabel);
      if (index >= 0) {
        const [match] = rentBreakdownQueue.splice(index, 1);
        return roundMoney(match?.amount ?? 0);
      }
      return row.status === "complete" ? normalizedRent : roundMoney(row.amount ?? 0);
    };
    const coverageRows: Array<{ label: string; status: "complete" | "partial" | "applied"; amount: number; value: string }> = coveredRows.map((row) => {
      const amount = takeRentAmountForCycle(row);
      return {
        label: row.dateLabel,
        status: row.status,
        amount,
        value: row.status === "complete"
          ? "Pagado completo"
          : "Abono parcial"
      };
    });
    rentBreakdownQueue.forEach((row) => {
      coverageRows.push({
        label: row.label,
        status: "partial",
        amount: row.amount,
        value: "Abono parcial"
      });
    });
    otherChargesApplied
      .filter((charge) => charge.amount > 0)
      .forEach((charge) => {
        coverageRows.push({
          label: charge.label,
          status: "applied",
          amount: charge.amount,
          value: "Aplicado"
        });
      });

    return (
      <>
        <div className="receipt-history-brand">
          <div className="receipt-history-number">{payment.receiptNumber}</div>
          <div className="receipt-history-logo" aria-label="flotapp">
            <span className="receipt-history-logo-icon" aria-hidden="true">
              <span className="receipt-history-logo-car" />
            </span>
            <span>flotapp</span>
          </div>
        </div>

        <div className="receipt-history-hero">
          <div className="receipt-history-hidden-installments">
            {payment.installmentsRemainingAfter}
          </div>
          <div className="receipt-history-unit">Unidad {payment.clientUnit}</div>
          <div className="receipt-history-plan">Plan {frequencyLabel.toLowerCase()}: {formatCurrency(payment.rentAmount)}</div>
        </div>

        <div className="receipt-history-panel receipt-history-panel--compact">
          <div className="receipt-history-icon receipt-history-icon--blue">D</div>
          <div>
            <div className="receipt-history-label">Fecha de pago</div>
            <div className="receipt-history-date">{formatDateSpanishSingleLine(paymentDate)}</div>
          </div>
        </div>

        <div className="receipt-history-panel receipt-history-panel--amount">
          <div className="receipt-history-icon receipt-history-icon--money">$</div>
          <div>
            <div className="receipt-history-label">Monto pagado</div>
            <div className="receipt-history-amount">{formatCurrency(payment.amountReceived)}</div>
          </div>
        </div>

        {isPendingCardSettlement && (
          <div className="receipt-history-note receipt-history-note--warning">
            Pago en tarjeta pendiente de conciliacion bancaria.
          </div>
        )}

        <div className="receipt-history-panel receipt-history-cover">
          <div className="receipt-history-section-title">Este pago cubre</div>
          {coverageRows.length > 0 ? coverageRows.map((row, index) => (
            <div key={`${row.label}-${index}`} className="receipt-history-cover-row">
              <span className={`receipt-history-status receipt-history-status--${row.status}`}>
                {row.status === "complete" ? "OK" : row.status === "applied" ? "$" : "-"}
              </span>
              <span className="receipt-history-cover-main">
                <span className="receipt-history-cover-date">{row.label}</span>
                <span className={`receipt-history-cover-state receipt-history-cover-state--${row.status}`}>{row.value}</span>
              </span>
              <strong className={`receipt-history-cover-value receipt-history-cover-value--${row.status}`}>
                {formatCurrency(row.amount)}
              </strong>
            </div>
          )) : (
            <div className="receipt-history-cover-row">
              <span className="receipt-history-status receipt-history-status--partial">-</span>
              <span className="receipt-history-cover-main">
                <span className="receipt-history-cover-date">Pago aplicado</span>
                <span className="receipt-history-cover-state receipt-history-cover-state--partial">Aplicado al recibo</span>
              </span>
              <strong className="receipt-history-cover-value receipt-history-cover-value--partial">
                {formatCurrency(payment.amountReceived)}
              </strong>
            </div>
          )}
        </div>

        {shouldShowPartialMissing && rentPendingAmount <= 0 && (
          <div className="receipt-history-alert receipt-history-alert--warning">
            <span>{getPartialMissingLabel(partialRow, payment)}</span>
            <strong>{formatCurrency(missingForPartial)}</strong>
          </div>
        )}

        {hasPending ? (
          <>
            {rentPendingAmount > 0 && (
              <div className="receipt-history-rent-pending">
                <div className="receipt-history-rent-pending-title">Saldo renta pendiente</div>
                {rentPartialPendingAmount > 0 && (
                  <div className="receipt-history-rent-pending-row">
                    <span>Saldo bajar 1 cta <em>(1 cuota parcial)</em></span>
                    <strong>{formatCurrency(rentPartialPendingAmount)}</strong>
                  </div>
                )}
                {rentCompletePendingAmount > 0 && (
                  <div className="receipt-history-rent-pending-row">
                    <span>Saldo corriente <em>({rentCompletePendingLabel})</em></span>
                    <strong>{formatCurrency(rentCompletePendingAmount)}</strong>
                  </div>
                )}
                <div className="receipt-history-rent-pending-row receipt-history-rent-pending-row--total">
                  <span>Total pendiente de renta <em>({rentPendingInstallmentsLabel})</em></span>
                  <strong>{formatCurrency(rentPendingAmount)}</strong>
                </div>
              </div>
            )}
            {otherChargesPendingAmount > 0 && (
              <div className="receipt-history-alert receipt-history-alert--other">
                <span>Otros cargos pendientes</span>
                <strong>{formatCurrency(otherChargesPendingAmount)}</strong>
              </div>
            )}
            {hasTravelFundBalance && (
              <div className="receipt-history-alert receipt-history-alert--travel">
                <span>Fondo de viaje</span>
                <strong>{formatCurrency(travelFundBalance)}</strong>
              </div>
            )}
          </>
        ) : (
          <>
            <div className={`receipt-history-alert ${partialFuturePendingAmount > 0 ? "receipt-history-alert--pending" : "receipt-history-alert--ok"}`}>
              <span>Saldo pendiente</span>
              <strong>{formatCurrency(partialFuturePendingAmount)}</strong>
            </div>
            {hasTravelFundBalance && (
              <div className="receipt-history-alert receipt-history-alert--travel">
                <span>Fondo de viaje</span>
                <strong>{formatCurrency(travelFundBalance)}</strong>
              </div>
            )}
          </>
        )}

        {!hasPending && (
          <div className="receipt-history-next-date">
            <span>Proxima fecha de pago</span>
            <strong>{nextPaymentDate ? formatDateSpanishSingleLine(nextPaymentDate) : "Por definir"}</strong>
          </div>
        )}

        <div className="receipt-history-panel receipt-history-panel--paid">
          <span>Cuotas pagadas</span>
          <strong>{installmentsPaidIncludingAdvance}</strong>
        </div>

        <div className="receipt-history-powered" aria-label="Powered by flotapp">
          <span className="receipt-history-logo-icon" aria-hidden="true">
            <span className="receipt-history-logo-car" />
          </span>
          <span>Powered by <strong>flotapp</strong></span>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="receipt-header">
        <div className="receipt-brand-sub receipt-brand-sub--title">COMPROBANTE DE PAGO</div>
        <div className="receipt-header-top">
          <div className="receipt-top-left-mini">
            <div className="receipt-summary-compact-line"><strong>{payment.clientUnit}</strong></div>
            <div className="receipt-summary-compact-line">{frequencyLabel}, {formatCurrency(payment.rentAmount)}</div>
            <div className="receipt-summary-compact-line">{installmentsPaidIncludingAdvance} Cuotas Pagadas</div>
          </div>
          <div className="receipt-top-action">
            <div className={`receipt-next-payment-badge receipt-next-payment-badge--${badgeTone}`} title={badgeText}>
              <span className="receipt-next-payment-badge-icon" aria-hidden="true">📅</span>
              <span>{badgeText}</span>
            </div>
            {hasPending && (
              <>
                <span className="receipt-top-action-label">Hoy para bajar 1 cuenta</span>
                <strong>{formatCurrency(saldoParaBajarHoy)}</strong>
                <span className="receipt-top-action-note">No cancela el total.</span>
              </>
            )}
          </div>
          <div className="receipt-top-right-meta">
            <div className="receipt-number receipt-number--right">{payment.receiptNumber}</div>
            <div className="receipt-date">{formatDateSpanish(payment.dateApplied)}</div>
          </div>
        </div>
        {isPendingCardSettlement && (
          <div className="receipt-brand-sub" style={{ color: "#a05a00", fontWeight: 700 }}>
            PAGO EN TARJETA PENDIENTE DE CONCILIACION BANCARIA
          </div>
        )}

        <div className="receipt-dual-grid">
          <div className="receipt-section receipt-section--panel">
            <div className="receipt-simple-title">PAGOS APLICADOS</div>
            <div className="receipt-subrow">
              <span>Pagaste hoy</span>
              <span>{formatCurrency(payment.amountReceived)}</span>
            </div>
            <div className="receipt-subrow">
              <span>{advanceApplied > 0 ? "Aplicado a saldo actual" : "Aplicado a renta"}</span>
              <span>{formatCurrency(appliedToCurrentRent)}</span>
            </div>
            {hasAdvancePanel && (
              <div className="receipt-subrow">
                <span>
                  Aplicado a proxima letra
                  {nextChargeDate ? ` (${formatDate(nextChargeDate)})` : ""}
                </span>
                <span>{formatCurrency(advanceApplied)}</span>
              </div>
            )}
            {hasAdvancePendingForNextInstallment && (
              <div className="receipt-subrow receipt-subrow--debt">
                <span>
                  Faltante de esa letra
                  {nextChargeDate ? ` (${formatDate(nextChargeDate)})` : ""}
                </span>
                <span>{formatCurrency(advanceRemainingForNextInstallment)}</span>
              </div>
            )}
            {hasAdvancePanel && (
              <div className="receipt-subrow">
                <span>Aplicado a renta (total)</span>
                <span>{formatCurrency(appliedToCurrentRent + advanceApplied)}</span>
              </div>
            )}
            {otherChargesApplied.map((charge, index) => (
              <div key={`paid-${charge.id ?? charge.label}-${index}`} className="receipt-subrow">
                <span>Aplicado a {charge.label.toUpperCase()}</span>
                <span>{formatCurrency(charge.amount)}</span>
              </div>
            ))}
          </div>

          <div className="receipt-section receipt-section--panel">
            <div className="receipt-simple-title">DATOS DEL CLIENTE</div>
            <div className="receipt-row">
              <span>Cliente</span>
              <span><strong>{payment.clientName.toUpperCase()}</strong></span>
            </div>
            <div className="receipt-row">
              <span>Metodo</span>
              <span>{payment.paymentMethod}</span>
            </div>
            {folio && (
              <div className="receipt-row">
                <span>Folio</span>
                <span className="receipt-reference">{folio}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {hasAdvancePanel && (
        <div className="receipt-advance-panel">
          <div className="receipt-advance-title">PAGO ADELANTADO</div>
          {nextChargeDate && (
            <div className="receipt-advance-row">
              <span>Proxima letra</span>
              <strong>{formatDate(nextChargeDate)}</strong>
            </div>
          )}
          <div className="receipt-advance-row">
            <span>Abonado acumulado a esa letra</span>
            <strong>{formatCurrency(advanceAppliedToNextInstallment)}</strong>
          </div>
          {hasAdvancePendingForNextInstallment ? (
            <div className="receipt-advance-row receipt-advance-row--pending">
              <span>Faltan para completarla</span>
              <strong>{formatCurrency(advanceRemainingForNextInstallment)}</strong>
            </div>
          ) : (
            <div className="receipt-advance-row receipt-advance-row--ok">
              <span>Estado de esa letra</span>
              <strong>PAGADA</strong>
            </div>
          )}
        </div>
      )}

      <div className={`receipt-top-balance-grid ${otherChargesDueAfter.length === 0 ? "receipt-top-balance-grid--single" : ""}`}>
        <div className={`receipt-overdue-banner ${hasPending ? "" : "receipt-overdue-banner--ok"}`}>
          <span className="receipt-overdue-icon">{hasPending ? "!" : <strong>✓</strong>}</span>
          <div className="receipt-overdue-content">
            <div className="receipt-overdue-title">{hasPending ? "PAGO PENDIENTE HOY" : "ESTAS AL DIA"}</div>
            <div className="receipt-overdue-sub">
              {hasPending ? (
                <>
                  <div className="receipt-overdue-grid">
                    {hasPartialForOneAccount && (
                      <div className="receipt-overdue-row">
                        <span>{`Saldo bajar 1 cta${saldoParaBajarCuentaLabel}`}</span>
                        <strong>{formatCurrency(saldoParaBajarCuenta)}</strong>
                      </div>
                    )}
                    <div className="receipt-overdue-row receipt-overdue-row--next">
                      <span>{`Saldo corriente${saldoCorrienteCuotasLabel}`}</span>
                      <strong>{formatCurrency(saldoCorriente)}</strong>
                    </div>
                    <div className="receipt-overdue-row receipt-overdue-row--total">
                      <span>{`Total pendiente de renta${totalPendienteCuotasLabel}`}</span>
                      <strong>{formatCurrency(totalPendienteRenta)}</strong>
                    </div>
                  </div>
                </>
              ) : "No tienes saldo pendiente."}
            </div>
          </div>
        </div>

        {hasPending && otherChargesDueAfter.length > 0 && (
          <div className="receipt-overdue-other-band receipt-overdue-other-band--separate">
            <div className="receipt-overdue-other-title">OTROS CARGOS</div>
            {otherChargesDueAfter.map((charge, index) => (
              <div key={`top-due-${charge.id ?? charge.label}-${index}`} className="receipt-overdue-other-row">
                <span>{charge.label.toUpperCase()}</span>
                <strong>{formatCurrency(charge.amount)}</strong>
              </div>
            ))}
            <div className="receipt-overdue-other-row receipt-overdue-other-row--total">
              <span>Total otros cargos</span>
              <strong>{formatCurrency(otherChargesDueTotal)}</strong>
            </div>
          </div>
        )}
      </div>

      {hasTravelFundBalance && (
        <div className="receipt-savings-box">
          <div className="receipt-savings-value">{`Fondo de viaje: ${formatCurrency(travelFundBalance)}`}</div>
        </div>
      )}

      <div className="receipt-reminders-box">
        <div className="receipt-reminders-title">Recordatorios</div>
        <ul className="receipt-reminders-list" aria-label="Recordatorios importantes">
          <li className="receipt-reminder-item">
            <span className="receipt-reminder-icon" aria-hidden="true">*</span>
            <span>
              <strong className="receipt-reminder-highlight">TODOS SUS PAGOS DEBEN VENIR CON LOS CENTAVOS DE SU UNIDAD.</strong>
            </span>
          </li>
          <li className="receipt-reminder-item">
            <span className="receipt-reminder-icon" aria-hidden="true">*</span>
            <span>
              En el banco, escribe tu <strong className="receipt-reminder-highlight">numero de unidad</strong> en el comentario.
            </span>
          </li>
          <li className="receipt-reminder-item">
            <span className="receipt-reminder-icon" aria-hidden="true">*</span>
            <span>
              Para transferencias, usa solo <strong className="receipt-reminder-highlight">ACH EXPRESS</strong>.
            </span>
          </li>
          <li className="receipt-reminder-item">
            <span className="receipt-reminder-icon" aria-hidden="true">*</span>
            <span>
              Manten <strong className="receipt-reminder-highlight">saldo positivo</strong> en Panapass y <strong className="receipt-reminder-highlight">paga a tiempo</strong> para evitar multas y recargos.
            </span>
          </li>
        </ul>
      </div>

      <div className="receipt-footer">
        Emitido por Administracion
      </div>
      <div className="receipt-installments-corner">
        <strong>{payment.installmentsRemainingAfter}</strong>
      </div>
    </>
  );
}

export default function PaymentReceipt({ payment, onClose, closeLabel = "Registrar otro pago", receiptFormat = "standard" }: Props) {
  const [isDownloading, setIsDownloading] = useState(false);
  const cardRef = useRef<HTMLDivElement | null>(null);

  async function handleDownload(): Promise<void> {
    setIsDownloading(true);
    try {
      await downloadPaymentReceiptImage(payment, cardRef.current);
    } catch {
      // silently fail - user still sees the receipt on screen
    } finally {
      setIsDownloading(false);
    }
  }

  return (
    <div className="receipt-page">
      <div className="receipt-actions-bar">
        <button type="button" className="button primary" onClick={handleDownload} disabled={isDownloading}>
          {isDownloading ? "Generando imagen..." : "Descargar imagen"}
        </button>
        <button type="button" className="button ghost" onClick={onClose}>
          {closeLabel}
        </button>
      </div>

      <div ref={cardRef} className={receiptFormat === "history" ? "receipt-card receipt-card--history" : "receipt-card"}>
        <ReceiptCardContent payment={payment} format={receiptFormat} />
      </div>
    </div>
  );
}
