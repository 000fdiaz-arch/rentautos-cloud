import { useState } from "react";
import { createRoot } from "react-dom/client";
import { formatCurrency, formatDate } from "../format";
import { getDebtStartDate, startOfDay } from "../billing";
import type { Payment } from "../types";

type Props = {
  payment: Payment;
  onClose: () => void;
  closeLabel?: string;
};

function formatDateSpanish(dateStr: string): string {
  const parts = dateStr.split("-");
  if (parts.length !== 3) return dateStr;
  const months = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  const month = parseInt(parts[1], 10) - 1;
  return `${parseInt(parts[2], 10)} ${months[month] ?? ""} ${parts[0]}`;
}

function sanitizeFileToken(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

function formatFileDateParts(dateStr: string): string {
  const parts = dateStr.split("-");
  if (parts.length !== 3) return dateStr.replace(/-/g, "_");
  const [yyyy, mm, dd] = parts;
  return `${dd}_${mm}_${yyyy}`;
}

function buildReceiptFileName(payment: Payment): string {
  const unit = sanitizeFileToken(payment.clientUnit || "UNIDAD");
  const datePart = formatFileDateParts(payment.dateApplied);
  return `${unit}-${datePart}.png`;
}

function buildZipFileName(payments: Payment[]): string {
  if (payments.length === 0) {
    return "recibos-pagos.png.zip";
  }
  const sortedDates = payments.map((payment) => payment.dateApplied).sort((a, b) => a.localeCompare(b));
  const fromDate = formatFileDateParts(sortedDates[0] ?? "");
  const toDate = formatFileDateParts(sortedDates[sortedDates.length - 1] ?? "");
  if (fromDate === toDate) {
    return `recibos-${fromDate}-${payments.length}.png.zip`;
  }
  return `recibos-${fromDate}-a-${toDate}-${payments.length}.png.zip`;
}

async function renderReceiptCanvasFromPayment(payment: Payment): Promise<HTMLCanvasElement> {
  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.left = "-10000px";
  host.style.top = "0";
  host.style.width = "760px";
  host.style.opacity = "0";
  host.style.pointerEvents = "none";
  document.body.appendChild(host);

  const root = createRoot(host);

  try {
    root.render(
      <div className="receipt-page">
        <div className="receipt-card">
          <ReceiptCardContent payment={payment} />
        </div>
      </div>
    );

    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    const target = host.querySelector(".receipt-card") as HTMLDivElement | null;
    if (!target) {
      throw new Error("Receipt preview container was not rendered.");
    }

    const html2canvas = (await import("html2canvas")).default;
    return html2canvas(target, {
      scale: 2,
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

export async function downloadPaymentReceiptImage(payment: Payment): Promise<void> {
  const { fileName, blob } = await buildPaymentReceiptImageBlob(payment);
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

export async function buildPaymentReceiptImageBlob(payment: Payment): Promise<{ fileName: string; blob: Blob }> {
  const canvas = await renderReceiptCanvasFromPayment(payment);
  const fileName = buildReceiptFileName(payment);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => {
      if (value) resolve(value);
      else reject(new Error("No se pudo convertir el recibo a imagen."));
    }, "image/png");
  });
  return { fileName, blob };
}

export async function downloadPaymentsReceiptsZip(payments: Payment[]): Promise<void> {
  if (payments.length === 0) {
    throw new Error("No hay pagos seleccionados.");
  }

  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  const namesCount = new Map<string, number>();

  for (const payment of payments) {
    const { fileName, blob } = await buildPaymentReceiptImageBlob(payment);
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

function ReceiptCardContent({ payment }: { payment: Payment }) {
  // Cuotas vencidas reales despues del pago
  const overdueAfter = payment.rentAmount > 0
    ? Math.max(0, Math.ceil(payment.balanceAfter / payment.rentAmount))
    : 0;

  // "Debe desde" con la misma logica de Modulo 1
  const paymentDate = startOfDay(new Date(payment.dateApplied + "T12:00:00"));
  const minimalClient = {
    balance: payment.balanceAfter,
    rentAmount: payment.rentAmount,
    frequency: payment.frequency,
    weeklyChargeDay: payment.weeklyChargeDay,
    monthlyChargeDay: payment.monthlyChargeDay,
    // campos requeridos por la firma pero no usados en el calculo
    id: "", unitId: "", name: "", installmentsAgreed: 0,
    installmentsRemaining: 0, installmentsPaid: 0,
    otherCharges: [], advanceBalance: 0, savings: 0, createdAt: ""
  } as Parameters<typeof getDebtStartDate>[0];

  const debtStartDate = getDebtStartDate(minimalClient, paymentDate);
  const otherChargesApplied = payment.otherChargesApplied ?? [];
  const otherChargesDueAfter = payment.otherChargesDueAfter ?? [];
  const otherChargesAppliedTotal = otherChargesApplied.reduce((sum, charge) => sum + charge.amount, 0);
  const otherChargesDueTotal = otherChargesDueAfter.reduce((sum, charge) => sum + charge.amount, 0);
  const advanceApplied = Math.max(0, payment.advanceApplied ?? 0);
  const rentDueTotal = Math.max(0, payment.balanceAfter);
  const totalPending = Math.max(0, rentDueTotal + otherChargesDueTotal);
  const hasPending = totalPending > 0;
  const debtSinceLabel = debtStartDate ? formatDate(debtStartDate) : null;

  return (
    <>
      <div className="receipt-header">
        <div>
          <div className="receipt-brand">COBRAPP</div>
          <div className="receipt-brand-sub">Comprobante de pago</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="receipt-number">{payment.receiptNumber}</div>
          <div className="receipt-date">{formatDateSpanish(payment.dateApplied)}</div>
        </div>
      </div>

      <div className={`receipt-overdue-banner ${hasPending ? "" : "receipt-overdue-banner--ok"}`}>
        <span className="receipt-overdue-icon">{hasPending ? "!" : "OK"}</span>
        <div>
          <div className="receipt-overdue-title">{hasPending ? "TIENES SALDO PENDIENTE" : "ESTAS AL DIA"}</div>
          <div className="receipt-overdue-sub">
            {hasPending ? (
              <>
                {overdueAfter > 0 && (
                  <> Cuotas atrasadas: {formatCurrency(rentDueTotal)} ({overdueAfter} {overdueAfter === 1 ? "cuota" : "cuotas"}).</>
                )}
                {otherChargesDueTotal > 0 && (
                  <> Otros cargos: {formatCurrency(otherChargesDueTotal)}.</>
                )}
                <> Total pendiente: {formatCurrency(totalPending)}.</>
              </>
            ) : "No tienes saldo pendiente."}
          </div>
        </div>
      </div>

      <div className="receipt-section">
        <div className="receipt-simple-title">Resumen rapido</div>
        <div className="receipt-row">
          <span>Pagaste hoy</span>
          <span>{formatCurrency(payment.amountReceived)}</span>
        </div>
        <div className="receipt-row">
          <span>Se uso en cuota</span>
          <span>{formatCurrency(payment.appliedToRent)}</span>
        </div>
        <div className="receipt-row">
          <span>Cuotas pagadas hoy</span>
          <span>{payment.installmentsDeducted > 0 ? payment.installmentsDeducted : 0}</span>
        </div>
        {otherChargesAppliedTotal > 0 && (
          <div className="receipt-row">
            <span>Se pago en cargos extra</span>
            <span>{formatCurrency(otherChargesAppliedTotal)}</span>
          </div>
        )}
        {advanceApplied > 0 && (
          <div className="receipt-row">
            <span>Se dejo como pago adelantado</span>
            <span>{formatCurrency(advanceApplied)}</span>
          </div>
        )}
        <div className="receipt-row">
          <span>Debes en cargos extra</span>
          <span className={otherChargesDueTotal > 0 ? "receipt-value-debt" : "receipt-value-good"}>{formatCurrency(otherChargesDueTotal)}</span>
        </div>
        <div className="receipt-row">
          <span>Te falta por pagar</span>
          <span className={hasPending ? "receipt-value-debt" : "receipt-value-good"}>{formatCurrency(totalPending)}</span>
        </div>
      </div>

      <div className="receipt-section">
        <div className="receipt-simple-title">Que pagaste hoy</div>
        <div className="receipt-subrow">
          <span>Cuota</span>
          <span>{formatCurrency(payment.appliedToRent)}</span>
        </div>
        {otherChargesApplied.map((charge) => (
          <div key={`paid-${charge.label}`} className="receipt-subrow">
            <span>Cargo extra: {charge.label}</span>
            <span>{formatCurrency(charge.amount)}</span>
          </div>
        ))}
        {payment.centavosAhorro > 0 && (
          <div className="receipt-subrow">
            <span>Ahorro de siniestros</span>
            <span>{formatCurrency(payment.centavosAhorro)}</span>
          </div>
        )}
        {advanceApplied > 0 && (
          <div className="receipt-subrow">
            <span>Pago adelantado</span>
            <span>{formatCurrency(advanceApplied)}</span>
          </div>
        )}
        {payment.appliedToRent <= 0 && otherChargesApplied.length === 0 && payment.centavosAhorro <= 0 && (
          <div className="receipt-subrow">
            <span>Sin aplicacion de pago</span>
            <span>{formatCurrency(0)}</span>
          </div>
        )}
      </div>

      <div className="receipt-section">
        <div className="receipt-simple-title">Que te falta</div>
        <div className="receipt-subrow">
          <span>Cuotas restantes</span>
          <span>{payment.installmentsRemainingAfter}</span>
        </div>
        <div className="receipt-subrow">
          <span>Cuotas atrasadas</span>
          <span className={overdueAfter > 0 ? "receipt-value-debt" : "receipt-value-good"}>{overdueAfter}</span>
        </div>
        <div className="receipt-subrow">
          <span>Saldo de cuotas</span>
          <span className={payment.balanceAfter > 0 ? "receipt-value-debt" : "receipt-value-good"}>{formatCurrency(payment.balanceAfter)}</span>
        </div>
        <div className="receipt-subrow">
          <span>Total cargos extra pendientes</span>
          <span className={otherChargesDueTotal > 0 ? "receipt-value-debt" : "receipt-value-good"}>{formatCurrency(otherChargesDueTotal)}</span>
        </div>
        {otherChargesDueAfter.map((charge) => (
          <div key={`due-${charge.label}`} className="receipt-subrow receipt-subrow--debt">
            <span>Debes por {charge.label}</span>
            <span>{formatCurrency(charge.amount)}</span>
          </div>
        ))}
        <div className="receipt-subrow">
          <span>Total pendiente</span>
          <span className={hasPending ? "receipt-value-debt" : "receipt-value-good"}>{formatCurrency(totalPending)}</span>
        </div>
        {hasPending && debtSinceLabel && (
          <div className="receipt-subrow">
            <span>Debe desde</span>
            <span>{debtSinceLabel}</span>
          </div>
        )}
      </div>

      <div className="receipt-section">
        <div className="receipt-simple-title">Datos del pago</div>
        <div className="receipt-row">
          <span>Fecha aplicada</span>
          <span>{formatDateSpanish(payment.dateApplied)}</span>
        </div>
        <div className="receipt-row">
          <span>Unidad</span>
          <span><strong>{payment.clientUnit}</strong></span>
        </div>
        <div className="receipt-row">
          <span>Cliente</span>
          <span><strong>{payment.clientName.toUpperCase()}</strong></span>
        </div>
        {payment.clientCedula && (
          <div className="receipt-row">
            <span>Cedula</span>
            <span>{payment.clientCedula}</span>
          </div>
        )}
        <div className="receipt-row">
          <span>Forma de pago</span>
          <span>{payment.paymentMethod}</span>
        </div>
        {payment.reference && (
          <div className="receipt-row">
            <span>Referencia</span>
            <span className="receipt-reference">{payment.reference}</span>
          </div>
        )}
      </div>

      <div className="receipt-reminders-box">
        <div className="receipt-reminders-title">Recordatorios rapidos</div>
        <ul className="receipt-reminders-list" aria-label="Recordatorios importantes">
          <li className="receipt-reminder-item">
            <span className="receipt-reminder-icon" aria-hidden="true">*</span>
            <span>
              Coloca <strong className="receipt-reminder-highlight">centavos</strong> para identificar tu unidad al pagar.
            </span>
          </li>
          <li className="receipt-reminder-item">
            <span className="receipt-reminder-icon" aria-hidden="true">*</span>
            <span>
              Escribe el <strong className="receipt-reminder-highlight">numero de tu unidad</strong> en los comentarios del banco.
            </span>
          </li>
          <li className="receipt-reminder-item">
            <span className="receipt-reminder-icon" aria-hidden="true">*</span>
            <span>
              Si pagas por transferencia, usa solo <strong className="receipt-reminder-highlight">ACH EXPRESS</strong>.
            </span>
          </li>
          <li className="receipt-reminder-item">
            <span className="receipt-reminder-icon" aria-hidden="true">*</span>
            <span>
              Manten <strong className="receipt-reminder-highlight">saldo positivo</strong> en tu Panapass.
            </span>
          </li>
          <li className="receipt-reminder-item">
            <span className="receipt-reminder-icon" aria-hidden="true">*</span>
            <span>
              Pagar <strong className="receipt-reminder-highlight">a tiempo</strong> evita multas y cargos adicionales.
            </span>
          </li>
        </ul>
      </div>

      <div className="receipt-total-row">
        <span>Total pagado</span>
        <span>{formatCurrency(payment.amountReceived)}</span>
      </div>

      <div className="receipt-footer">
        Emitido por Administracion
      </div>
    </>
  );
}

export default function PaymentReceipt({ payment, onClose, closeLabel = "Registrar otro pago" }: Props) {
  const [isDownloading, setIsDownloading] = useState(false);

  async function handleDownload(): Promise<void> {
    setIsDownloading(true);
    try {
      await downloadPaymentReceiptImage(payment);
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

      <div className="receipt-card">
        <ReceiptCardContent payment={payment} />
      </div>
    </div>
  );
}
