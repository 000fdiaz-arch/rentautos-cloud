import { useMemo, useRef, useState, type RefObject } from "react";
import { formatCurrency } from "../../format";
import type { BankRule, Payment, PaymentIncomeEdit } from "../../types";
import { getBusinessDateKey } from "../../billing";
import { BANK_PAYMENT_METHODS } from "./paymentConstants";
import { PAYMENT_METHODS } from "./paymentConstants";
import {
  buildDailyIncomeGroups,
  buildDeliveredFromPreviousRows,
  buildPendingCashRowsByTeam,
  buildPendingDeliveryRows,
  getDailyIncomeStatus,
  getDailyIncomeReportDate,
  getDailyIncomeDestination,
  getIncomeDate,
  isMoneyDelivered,
  maskAccountNumber
} from "./dailyIncomeRules";

type Props = {
  sectionRef: RefObject<HTMLElement>;
  isOpen: boolean;
  payments: Payment[];
  bankRules: BankRule[];
  onPaymentsChange: (payments: Payment[]) => void;
  currentActor: string;
  readOnly?: boolean;
  isPaymentHistoryLoaded?: boolean;
};

type ShareScope = "full" | "filtered" | "cash" | "pending";

function chunkItems<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return date.toLocaleTimeString("es-PA", { hour: "2-digit", minute: "2-digit" });
}

function formatCommentDate(payment: Payment): string {
  const edits = payment.incomeEdits ?? [];
  const commentEdit = [...edits].reverse().find((edit) => (
    edit.previousComment !== undefined || edit.nextComment !== undefined
  ));
  if (!commentEdit) return "Fecha no registrada";
  const date = new Date(commentEdit.createdAt);
  if (!Number.isFinite(date.getTime())) return "Fecha no registrada";
  return `Colocado el ${date.toLocaleString("es-PA", { dateStyle: "short", timeStyle: "short" })}`;
}

function formatMoneyDay(dateKey: string): string {
  const date = new Date(`${dateKey}T12:00:00`);
  if (!Number.isFinite(date.getTime())) return dateKey;
  return date.toLocaleDateString("es-PA", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" });
}

function getDeliveryContext(payment: Payment): string {
  const moneyDate = getIncomeDate(payment);
  if (!isMoneyDelivered(payment)) return `Pendiente · dinero del ${formatMoneyDay(moneyDate)}`;
  if (payment.moneyDeliveryDate && payment.moneyDeliveryDate > moneyDate) {
    return `Entregado el ${formatMoneyDay(payment.moneyDeliveryDate)} · dinero del ${formatMoneyDay(moneyDate)}`;
  }
  return `Dinero del ${formatMoneyDay(moneyDate)}`;
}

export default function DailyIncomePanel({
  sectionRef,
  isOpen,
  payments,
  bankRules,
  onPaymentsChange,
  currentActor,
  readOnly = false,
  isPaymentHistoryLoaded = true
}: Props) {
  const [dateKey, setDateKey] = useState(getBusinessDateKey());
  const [search, setSearch] = useState("");
  const [methodFilter, setMethodFilter] = useState("all");
  const [destinationFilter, setDestinationFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [deliveryFilter, setDeliveryFilter] = useState("all");
  const [teamFilter, setTeamFilter] = useState<"all" | "PTY" | "WC">("all");
  const [teamDeliveryMessage, setTeamDeliveryMessage] = useState("");
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [editingPayment, setEditingPayment] = useState<Payment | null>(null);
  const [editAccount, setEditAccount] = useState("");
  const [editComment, setEditComment] = useState("");
  const [editReason, setEditReason] = useState("");
  const [editError, setEditError] = useState("");
  const [showSharePreview, setShowSharePreview] = useState(false);
  const [shareScope, setShareScope] = useState<ShareScope>("full");
  const [shareStatus, setShareStatus] = useState("");
  const shareReportRef = useRef<HTMLDivElement>(null);

  const rawGroups = useMemo(() => buildDailyIncomeGroups(payments, dateKey, bankRules), [payments, dateKey, bankRules]);
  const destinationOptions = useMemo(() => {
    const bankGroups = rawGroups.filter((group) => group.key.startsWith("bank:"));
    return [
      ...(bankGroups.length > 0 ? [{ key: "bank:all", label: "Cuenta bancaria (todas)" }] : []),
      ...bankGroups.map((group) => ({ key: group.key, label: `↳ ${group.label}` })),
      ...rawGroups.filter((group) => !group.key.startsWith("bank:")).map((group) => ({ key: group.key, label: group.label }))
    ];
  }, [rawGroups]);
  const filteredPayments = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return payments.filter((payment) => {
      const status = getDailyIncomeStatus(payment);
      if (methodFilter !== "all" && payment.paymentMethod !== methodFilter) return false;
      const destination = getDailyIncomeDestination(payment, bankRules);
      const destinationKey = destination.key;
      if (destinationFilter === "bank:all" && !destinationKey.startsWith("bank:")) return false;
      if (destinationFilter !== "all" && destinationFilter !== "bank:all" && destinationKey !== destinationFilter) return false;
      if (statusFilter !== "all" && status !== statusFilter) return false;
      if (deliveryFilter !== "all") {
        if (status === "non_cash") return false;
        if (deliveryFilter === "yes" && !isMoneyDelivered(payment)) return false;
        if (deliveryFilter === "no" && isMoneyDelivered(payment)) return false;
      }
      if (teamFilter !== "all" && payment.collectionTeam !== teamFilter) return false;
      if (normalizedSearch && ![
        payment.clientName,
        payment.clientUnit,
        payment.receiptNumber,
        payment.reference ?? "",
        payment.incomeComment ?? "",
        payment.bankAccountNumber ?? "",
        payment.bankGroupCode ?? "",
        payment.collectionTeam ?? "",
        destination.label,
        payment.paymentMethod
      ].some((value) => value.toLowerCase().includes(normalizedSearch))) return false;
      return true;
    });
  }, [payments, bankRules, search, methodFilter, destinationFilter, statusFilter, deliveryFilter, teamFilter]);
  const groups = useMemo(() => buildDailyIncomeGroups(filteredPayments, dateKey, bankRules), [filteredPayments, dateKey, bankRules]);
  const bankGroups = groups.filter((group) => group.key.startsWith("bank:"));
  const nonBankGroups = groups.filter((group) => !group.key.startsWith("bank:"));
  const bankTotal = bankGroups.reduce((sum, group) => sum + group.total, 0);
  const bankPaymentCount = bankGroups.reduce((sum, group) => sum + group.payments.length, 0);
  const pendingDeliveries = useMemo(() => buildPendingDeliveryRows(filteredPayments, dateKey), [filteredPayments, dateKey]);
  const pendingDeliveriesTotal = pendingDeliveries.reduce((sum, payment) => sum + payment.amountReceived, 0);
  const deliveredFromPrevious = useMemo(() => buildDeliveredFromPreviousRows(filteredPayments, dateKey), [filteredPayments, dateKey]);
  const deliveredFromPreviousTotal = deliveredFromPrevious.reduce((sum, payment) => sum + payment.amountReceived, 0);
  const pendingCashByTeam = useMemo(() => buildPendingCashRowsByTeam(payments, dateKey), [payments, dateKey]);
  const pendingCashTeamSummary = (["PTY", "WC"] as const).map((team) => ({
    team,
    payments: pendingCashByTeam[team],
    total: pendingCashByTeam[team].reduce((sum, payment) => sum + payment.amountReceived, 0)
  }));
  const pendingCashTeamTotal = pendingCashTeamSummary.reduce((sum, item) => sum + item.total, 0);
  const unassignedPendingCashTotal = pendingCashByTeam.unassigned.reduce((sum, payment) => sum + payment.amountReceived, 0);
  const receivedTotal = groups.filter((group) => group.status === "received").reduce((sum, group) => sum + group.total, 0);
  const pendingTotal = groups.filter((group) => group.status === "pending").reduce((sum, group) => sum + group.total, 0);
  const nonCashTotal = groups.filter((group) => group.status === "non_cash").reduce((sum, group) => sum + group.total, 0);
  const receivedCount = groups.filter((group) => group.status === "received").reduce((sum, group) => sum + group.payments.length, 0);
  const accountOptions = bankRules.filter((rule) => rule.active);
  const filtersActive = search.trim() !== "" || methodFilter !== "all" || destinationFilter !== "all" || statusFilter !== "all" || deliveryFilter !== "all" || teamFilter !== "all";
  const shareSourcePayments = useMemo(() => {
    if (shareScope === "filtered") return filteredPayments;
    if (shareScope === "cash") return payments.filter((payment) => payment.paymentMethod === "Efectivo");
    if (shareScope === "pending") return payments.filter((payment) => payment.moneyDelivered === false || getDailyIncomeStatus(payment) === "pending");
    return payments;
  }, [filteredPayments, payments, shareScope]);
  const shareGroups = useMemo(() => buildDailyIncomeGroups(shareSourcePayments, dateKey, bankRules), [shareSourcePayments, dateKey, bankRules]);
  const sharePendingDeliveries = useMemo(() => buildPendingDeliveryRows(shareSourcePayments, dateKey), [shareSourcePayments, dateKey]);
  const shareDeliveredFromPrevious = useMemo(() => buildDeliveredFromPreviousRows(shareSourcePayments, dateKey), [shareSourcePayments, dateKey]);
  const shareReceivedGroups = shareGroups.filter((group) => group.status === "received");
  const shareReceivedBankGroups = shareReceivedGroups.filter((group) => group.key.startsWith("bank:"));
  const shareReceivedNonBankGroups = shareReceivedGroups.filter((group) => !group.key.startsWith("bank:"));
  const shareBankPayments = shareReceivedBankGroups.flatMap((group) => group.payments);
  const shareBankTotal = shareReceivedBankGroups.reduce((sum, group) => sum + group.total, 0);
  const shareConsolidatedGroups = [
    ...(shareReceivedBankGroups.length > 0 ? [{
      key: "bank:consolidated",
      label: "Cuenta bancaria",
      status: "received" as const,
      payments: shareBankPayments,
      total: shareBankTotal
    }] : []),
    ...shareReceivedNonBankGroups
  ];
  const shareReceivedTotal = shareReceivedGroups.reduce((sum, group) => sum + group.total, 0);
  const shareCashPendingToday = shareGroups.filter((group) => group.key === "cash-pending").reduce((sum, group) => sum + group.total, 0);
  const shareCashPendingPrevious = sharePendingDeliveries.filter((payment) => payment.paymentMethod === "Efectivo").reduce((sum, payment) => sum + payment.amountReceived, 0);
  const shareCashPendingTotal = shareCashPendingToday + shareCashPendingPrevious;
  const shareCardPendingTotal = shareGroups.filter((group) => group.status === "pending" && group.key !== "cash-pending").reduce((sum, group) => sum + group.total, 0);
  const shareNonCashTotal = shareGroups.filter((group) => group.status === "non_cash").reduce((sum, group) => sum + group.total, 0);
  const sharePreviousDeliveryTotal = shareDeliveredFromPrevious.reduce((sum, payment) => sum + payment.amountReceived, 0);
  const shareCashDeliveredRows = useMemo(() => (
    shareGroups.filter((group) => group.key === "cash").flatMap((group) => group.payments)
  ), [shareGroups]);
  const shareCashPendingRows = useMemo(() => {
    const rows = [
      ...shareGroups.filter((group) => group.key === "cash-pending").flatMap((group) => group.payments),
      ...sharePendingDeliveries.filter((payment) => payment.paymentMethod === "Efectivo")
    ];
    return [...new Map(rows.map((payment) => [payment.id, payment])).values()];
  }, [shareGroups, sharePendingDeliveries]);
  const shareRelevantPayments = useMemo(() => {
    const rows = [...shareGroups.flatMap((group) => group.payments), ...sharePendingDeliveries, ...shareDeliveredFromPrevious];
    return [...new Map(rows.map((payment) => [payment.id, payment])).values()];
  }, [shareGroups, sharePendingDeliveries, shareDeliveredFromPrevious]);
  const shareComments = shareRelevantPayments.filter((payment) => payment.incomeComment);
  const shareSummaryDestinations = shareConsolidatedGroups.slice(0, 7);
  const shareAdditionalDestinationPages = chunkItems(shareConsolidatedGroups.slice(7), 10);
  const shareBankDetailPages = chunkItems(shareReceivedBankGroups, 10);
  const shareCashDeliveredPages = chunkItems(shareCashDeliveredRows, 8);
  const shareCashPendingPages = chunkItems(shareCashPendingRows, 8);
  const shareCommentPages = chunkItems(shareComments, 6);
  const sharePageCount = 1 + shareAdditionalDestinationPages.length + shareBankDetailPages.length + shareCashDeliveredPages.length + shareCashPendingPages.length + shareCommentPages.length;
  const shareScopeLabel: Record<ShareScope, string> = {
    full: "Reporte completo",
    filtered: "Filtros actuales",
    cash: "Solo efectivo",
    pending: "Solo pendientes"
  };

  function clearFilters(): void {
    setSearch("");
    setMethodFilter("all");
    setDestinationFilter("all");
    setStatusFilter("all");
    setDeliveryFilter("all");
    setTeamFilter("all");
    setTeamDeliveryMessage("");
  }

  function toggleStatusFilter(status: "received" | "pending" | "non_cash"): void {
    setStatusFilter((current) => current === status ? "all" : status);
  }

  function buildWhatsAppText(): string {
    const lines = [
      `*REPORTE DE INGRESOS — ${formatMoneyDay(dateKey).toUpperCase()}*`,
      shareScopeLabel[shareScope],
      "",
      `*Total recibido:* ${formatCurrency(shareReceivedTotal)}`
    ];
    for (const group of shareConsolidatedGroups) lines.push(`• ${group.label}: ${formatCurrency(group.total)} (${group.payments.length})`);
    if (shareReceivedBankGroups.length > 0) {
      lines.push("", "*Detalle bancario:*");
      for (const group of shareReceivedBankGroups) lines.push(`• ${group.label}: ${formatCurrency(group.total)} (${group.payments.length})`);
    }
    if (sharePreviousDeliveryTotal > 0) lines.push(`• Entregado hoy de días anteriores: ${formatCurrency(sharePreviousDeliveryTotal)}`);
    if (shareCashDeliveredRows.length > 0) {
      lines.push("", "*Detalle de efectivo entregado:*");
      for (const payment of shareCashDeliveredRows) lines.push(`• ${payment.clientUnit} — ${formatCurrency(payment.amountReceived)} — ${getDeliveryContext(payment)}`);
    }
    lines.push("", `*Efectivo pendiente de entrega:* ${formatCurrency(shareCashPendingTotal)}`);
    lines.push(`• Equipo PTY debe entregar: ${formatCurrency(pendingCashTeamSummary[0].total)} (${pendingCashTeamSummary[0].payments.length})`);
    lines.push(`• Equipo WC debe entregar: ${formatCurrency(pendingCashTeamSummary[1].total)} (${pendingCashTeamSummary[1].payments.length})`);
    if (unassignedPendingCashTotal > 0) lines.push(`• Sin equipo asignado: ${formatCurrency(unassignedPendingCashTotal)}`);
    if (shareCashPendingRows.length > 0) {
      for (const payment of shareCashPendingRows) lines.push(`• ${payment.clientUnit} — ${formatCurrency(payment.amountReceived)} — dinero del ${formatMoneyDay(getIncomeDate(payment))}`);
    }
    if (shareCardPendingTotal > 0) lines.push(`*Tarjetas pendientes:* ${formatCurrency(shareCardPendingTotal)}`);
    if (shareNonCashTotal > 0) lines.push(`*Sin entrada de dinero:* ${formatCurrency(shareNonCashTotal)}`);
    if (shareComments.length > 0) {
      lines.push("", "*Comentarios:*", ...shareComments.map((payment) => `• ${payment.clientUnit}: ${payment.incomeComment}`));
    }
    lines.push("", `Generado: ${new Date().toLocaleString("es-PA")}`);
    return lines.join("\n");
  }

  async function buildSharePageCanvases(): Promise<HTMLCanvasElement[]> {
    if (!shareReportRef.current) throw new Error("No se encontró la vista previa del reporte.");
    const { default: html2canvas } = await import("html2canvas");
    const pages = Array.from(shareReportRef.current.querySelectorAll<HTMLElement>(".income-whatsapp-page"));
    if (pages.length === 0) throw new Error("No se encontraron páginas para generar el reporte.");
    return Promise.all(pages.map((page) => html2canvas(page, {
      scale: 1.5,
      width: 720,
      height: 900,
      windowWidth: 720,
      windowHeight: 900,
      backgroundColor: "#ffffff",
      useCORS: true
    })));
  }

  function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("No se pudo generar la imagen.")), "image/png"));
  }

  function downloadShareBlob(blob: Blob, pageNumber: number, totalPages: number): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `reporte-ingresos-${dateKey}-${String(pageNumber).padStart(2, "0")}-de-${String(totalPages).padStart(2, "0")}.png`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function copyWhatsAppText(): Promise<void> {
    try {
      await navigator.clipboard.writeText(buildWhatsAppText());
      setShareStatus("Resumen copiado. Ya puedes pegarlo en WhatsApp.");
    } catch {
      setShareStatus("No se pudo copiar automáticamente. Selecciona el texto de la vista previa.");
    }
  }

  async function downloadHighResolutionImages(): Promise<void> {
    try {
      setShareStatus("Generando imágenes HD...");
      const blobs = await Promise.all((await buildSharePageCanvases()).map(canvasToPng));
      blobs.forEach((blob, index) => downloadShareBlob(blob, index + 1, blobs.length));
      setShareStatus(`${blobs.length} imagen(es) PNG en alta resolución descargada(s).`);
    } catch (error) {
      setShareStatus(error instanceof Error ? error.message : "No se pudieron generar las imágenes.");
    }
  }

  async function downloadSharePdf(): Promise<void> {
    try {
      setShareStatus("Generando PDF...");
      const canvases = await buildSharePageCanvases();
      const { default: JsPDF } = await import("jspdf");
      const pdf = new JsPDF("p", "mm", "a4");
      canvases.forEach((canvas, index) => {
        if (index > 0) pdf.addPage();
        pdf.addImage(canvas.toDataURL("image/png"), "PNG", 5, 23.5, 200, 250, undefined, "FAST");
      });
      pdf.save(`reporte-ingresos-${dateKey}.pdf`);
      setShareStatus(`PDF generado con ${canvases.length} página(s). Envíalo por WhatsApp como documento para evitar compresión.`);
    } catch (error) {
      setShareStatus(error instanceof Error ? error.message : "No se pudo generar el PDF.");
    }
  }

  async function shareHighResolutionImages(): Promise<void> {
    try {
      setShareStatus("Preparando imágenes HD...");
      const text = buildWhatsAppText();
      const blobs = await Promise.all((await buildSharePageCanvases()).map(canvasToPng));
      const files = blobs.map((blob, index) => new File([blob], `reporte-ingresos-${dateKey}-${String(index + 1).padStart(2, "0")}.png`, { type: "image/png" }));
      if (navigator.share && (!navigator.canShare || navigator.canShare({ files }))) {
        await navigator.share({ title: `Reporte de ingresos ${dateKey}`, text, files });
        setShareStatus("Reporte compartido.");
        return;
      }
      blobs.forEach((blob, index) => downloadShareBlob(blob, index + 1, blobs.length));
      try { await navigator.clipboard.writeText(text); } catch { /* El texto también viaja en el enlace. */ }
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
      setShareStatus(`Se descargaron ${blobs.length} PNG HD y se abrió WhatsApp. Adjunta las imágenes en el orden numerado.`);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setShareStatus("Compartir cancelado.");
        return;
      }
      setShareStatus(error instanceof Error ? error.message : "No se pudo compartir el reporte.");
    }
  }

  function toggleGroup(key: string): void {
    setExpandedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function openEdit(payment: Payment): void {
    setEditingPayment(payment);
    setEditAccount(payment.bankAccountNumber ?? "");
    setEditComment(payment.incomeComment ?? "");
    setEditReason("");
    setEditError("");
  }

  function changeMoneyDelivered(payment: Payment, delivered: boolean): void {
    const previousDelivered = isMoneyDelivered(payment);
    if (previousDelivered === delivered) return;
    const changedAt = new Date().toISOString();
    const audit: PaymentIncomeEdit = {
      id: crypto.randomUUID(),
      createdAt: changedAt,
      actor: currentActor,
      reason: delivered ? "Dinero marcado como entregado" : "Dinero marcado como pendiente de entrega",
      previousMoneyDelivered: previousDelivered,
      nextMoneyDelivered: delivered
    };
    onPaymentsChange(payments.map((row) => row.id === payment.id ? {
      ...row,
      moneyDelivered: delivered,
      moneyDeliveryDate: delivered ? dateKey : undefined,
      moneyDeliveryUpdatedAt: changedAt,
      moneyDeliveryUpdatedBy: currentActor,
      incomeEdits: [...(row.incomeEdits ?? []), audit]
    } : row));
  }

  function filterPendingCashByTeam(team: "PTY" | "WC"): void {
    if (teamFilter === team) {
      clearFilters();
      return;
    }
    setTeamFilter(team);
    setMethodFilter("Efectivo");
    setDeliveryFilter("no");
    setStatusFilter("all");
    setDestinationFilter("all");
    setTeamDeliveryMessage("");
  }

  function markTeamCashDelivered(team: "PTY" | "WC"): void {
    if (readOnly) return;
    const targetIds = new Set(pendingCashByTeam[team].map((payment) => payment.id));
    if (targetIds.size === 0) return;
    const changedAt = new Date().toISOString();
    onPaymentsChange(payments.map((payment) => {
      if (!targetIds.has(payment.id)) return payment;
      const audit: PaymentIncomeEdit = {
        id: crypto.randomUUID(),
        createdAt: changedAt,
        actor: currentActor,
        reason: `Entrega masiva de efectivo · Equipo ${team}`,
        previousMoneyDelivered: false,
        nextMoneyDelivered: true
      };
      return {
        ...payment,
        moneyDelivered: true,
        moneyDeliveryDate: dateKey,
        moneyDeliveryUpdatedAt: changedAt,
        moneyDeliveryUpdatedBy: currentActor,
        incomeEdits: [...(payment.incomeEdits ?? []), audit]
      };
    }));
    setTeamDeliveryMessage(`Equipo ${team}: ${targetIds.size} cobro${targetIds.size === 1 ? "" : "s"} marcado${targetIds.size === 1 ? "" : "s"} como entregado${targetIds.size === 1 ? "" : "s"}.`);
  }

  function saveEdit(): void {
    if (!editingPayment) return;
    const nextAccount = editAccount.trim();
    const previousAccount = editingPayment.bankAccountNumber?.trim() ?? "";
    const nextComment = editComment.trim();
    const previousComment = editingPayment.incomeComment?.trim() ?? "";
    const accountChanged = nextAccount !== previousAccount;
    const commentChanged = nextComment !== previousComment;
    if (!accountChanged && !commentChanged) {
      setEditingPayment(null);
      return;
    }
    if (accountChanged && !editReason.trim()) {
      setEditError("Indica el motivo de la corrección de cuenta.");
      return;
    }
    const matchedRule = accountOptions.find((rule) => rule.accountNumber === nextAccount);
    const audit: PaymentIncomeEdit = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      actor: currentActor,
      reason: editReason.trim() || undefined,
      previousAccountNumber: previousAccount || undefined,
      nextAccountNumber: nextAccount || undefined,
      previousComment: commentChanged ? previousComment || undefined : undefined,
      nextComment: commentChanged ? nextComment || undefined : undefined
    };
    onPaymentsChange(payments.map((payment) => payment.id === editingPayment.id ? {
      ...payment,
      bankAccountNumber: nextAccount || undefined,
      bankGroupCode: matchedRule?.groupCode || (nextAccount === previousAccount ? payment.bankGroupCode : undefined),
      incomeComment: nextComment || undefined,
      incomeEdits: [...(payment.incomeEdits ?? []), audit]
    } : payment));
    setEditingPayment(null);
  }

  function renderPaymentTable(rows: Payment[]) {
    return <div className="income-day-table-wrap">
      <table className="income-day-table">
        <thead><tr><th>Hora</th><th>Unidad / cliente</th><th>Recibo</th><th>Forma</th><th>Equipo</th><th>Referencia</th><th>Comentario</th><th>Dinero entregado</th><th>Monto</th><th /></tr></thead>
        <tbody>{rows.map((payment) => <tr key={payment.id}>
          <td>{formatTime(payment.createdAt)}</td>
          <td><strong>{payment.clientUnit}</strong><small>{payment.clientName}</small></td>
          <td>{payment.receiptNumber}</td>
          <td>{payment.paymentMethod}{payment.bankAccountNumber && <small>{maskAccountNumber(payment.bankAccountNumber)}</small>}</td>
          <td>{payment.collectionTeam || "—"}</td>
          <td className="income-day-reference">{payment.reference || "—"}</td>
          <td>{payment.incomeComment || "—"}{payment.incomeComment && <small>{formatCommentDate(payment)}</small>}{getDailyIncomeStatus(payment) !== "non_cash" && <small className="income-delivery-context">{getDeliveryContext(payment)}</small>}{(payment.incomeEdits?.length ?? 0) > 0 && <small>Última edición: {payment.incomeEdits?.[payment.incomeEdits.length - 1]?.actor}</small>}</td>
          <td>{getDailyIncomeStatus(payment) === "non_cash" ? <span className="income-delivery-badge">No aplica</span> : readOnly ? <span className={`income-delivery-badge ${isMoneyDelivered(payment) ? "income-delivery-badge--yes" : "income-delivery-badge--no"}`}>{isMoneyDelivered(payment) ? "Sí" : "No"}</span> : <select className={`income-delivery-select ${isMoneyDelivered(payment) ? "income-delivery-select--yes" : "income-delivery-select--no"}`} aria-label={`Dinero entregado ${payment.receiptNumber}`} value={isMoneyDelivered(payment) ? "yes" : "no"} onChange={(event) => changeMoneyDelivered(payment, event.target.value === "yes")}><option value="yes">Sí</option><option value="no">No</option></select>}</td>
          <td><strong>{formatCurrency(payment.amountReceived)}</strong></td>
          <td>{!readOnly && <button type="button" className="button ghost small" onClick={() => openEdit(payment)}>Editar</button>}</td>
        </tr>)}</tbody>
      </table>
    </div>;
  }

  async function exportExcel(): Promise<void> {
    const rows = [...bankGroups, ...nonBankGroups].flatMap((group) => group.payments.map((payment) => ({
      Fecha: getIncomeDate(payment),
      "Fecha en que suma": getDailyIncomeReportDate(payment),
      Hora: formatTime(payment.createdAt),
      Estado: getDailyIncomeStatus(payment) === "received" ? "Recibido" : getDailyIncomeStatus(payment) === "pending" ? "Pendiente" : "Sin entrada de dinero",
      Destino: group.key.startsWith("bank:") ? "Cuenta bancaria" : group.label,
      "Detalle del destino": group.label,
      Cuenta: payment.bankAccountNumber ?? "",
      Forma: payment.paymentMethod,
      Equipo: payment.collectionTeam ?? "",
      Recibo: payment.receiptNumber,
      Unidad: payment.clientUnit,
      Cliente: payment.clientName,
      Referencia: payment.reference ?? "",
      Comentario: payment.incomeComment ?? "",
      "Fecha del comentario": payment.incomeComment ? formatCommentDate(payment) : "",
      "Dinero entregado": getDailyIncomeStatus(payment) === "non_cash" ? "No aplica" : isMoneyDelivered(payment) ? "Sí" : "No",
      "Día al que corresponde el dinero": getIncomeDate(payment),
      "Fecha de entrega": payment.moneyDeliveryDate ?? "",
      Monto: payment.amountReceived
    })));
    const xlsx = await import("xlsx");
    const workbook = xlsx.utils.book_new();
    const summary = xlsx.utils.aoa_to_sheet([
      ["Ingresos del día", dateKey],
      ["Destino", "Estado", "Pagos", "Total"],
      ...(bankGroups.length > 0 ? [
        ["Cuenta bancaria", "received", bankPaymentCount, bankTotal],
        ...bankGroups.map((group) => [`  ${group.label}`, group.status, group.payments.length, group.total])
      ] : []),
      ...nonBankGroups.map((group) => [group.label, group.status, group.payments.length, group.total]),
      [],
      ["Efectivo por entregar · PTY", "pending", pendingCashTeamSummary[0].payments.length, pendingCashTeamSummary[0].total],
      ["Efectivo por entregar · WC", "pending", pendingCashTeamSummary[1].payments.length, pendingCashTeamSummary[1].total],
      ["Total efectivo por entregar de equipos", "pending", pendingCashTeamSummary[0].payments.length + pendingCashTeamSummary[1].payments.length, pendingCashTeamTotal],
      ...(unassignedPendingCashTotal > 0 ? [["Efectivo pendiente sin equipo", "pending", pendingCashByTeam.unassigned.length, unassignedPendingCashTotal]] : []),
      [],
      ["Total recibido", receivedTotal],
      ["Pendiente de acreditación", pendingTotal],
      ["Movimientos sin entrada", nonCashTotal]
    ]);
    const detail = xlsx.utils.json_to_sheet(rows);
    xlsx.utils.book_append_sheet(workbook, summary, "Resumen");
    xlsx.utils.book_append_sheet(workbook, detail, "Movimientos");
    xlsx.writeFile(workbook, `ingresos-del-dia-${dateKey}.xlsx`);
  }

  return (
    <section id="payment-panel-income" role="tabpanel" aria-labelledby="payment-tab-income" ref={sectionRef} className="panel income-day-panel" style={{ display: isOpen ? undefined : "none" }}>
      <div className="income-day-header">
        <div>
          <h2>Ingresos del día</h2>
          <p className="hint">Dinero recibido, agrupado por la cuenta o el medio donde cayó.</p>
        </div>
        <div className="income-day-actions">
          <label>Fecha<input type="date" value={dateKey} onChange={(event) => setDateKey(event.target.value)} /></label>
          <button type="button" className="button ghost" onClick={() => void exportExcel()}>Exportar Excel</button>
          <button type="button" className="button primary" onClick={() => { setShareStatus(""); setShowSharePreview(true); }}>Compartir reporte</button>
        </div>
      </div>

      {!isPaymentHistoryLoaded && <p className="hint">El historial completo todavía está cargando; los totales pueden cambiar.</p>}
      <section className="income-team-closing" aria-label="Efectivo pendiente por equipo">
        <div className="income-team-closing-head">
          <div>
            <h3>Efectivo que deben entregar los equipos</h3>
            <p>Incluye todo el efectivo pendiente hasta la fecha seleccionada, aunque se haya cobrado otro día.</p>
          </div>
          <div><span>Total por entregar</span><strong>{formatCurrency(pendingCashTeamTotal)}</strong></div>
        </div>
        <div className="income-team-closing-grid">
          {pendingCashTeamSummary.map((item) => (
            <article key={item.team} className={`income-team-card income-team-card--${item.team.toLowerCase()}${teamFilter === item.team ? " income-team-card--active" : ""}`}>
              <button type="button" className="income-team-card-filter" aria-pressed={teamFilter === item.team} onClick={() => filterPendingCashByTeam(item.team)}>
                <span>Equipo {item.team}</span>
                <strong>{formatCurrency(item.total)}</strong>
                <small>{item.payments.length} cobro{item.payments.length === 1 ? "" : "s"} pendiente{item.payments.length === 1 ? "" : "s"} · Presiona para filtrar</small>
              </button>
              {!readOnly && item.payments.length > 0 ? <button type="button" className="income-team-deliver-all" onClick={() => markTeamCashDelivered(item.team)}>Marcar todo entregado</button> : null}
            </article>
          ))}
        </div>
        {unassignedPendingCashTotal > 0 ? <p className="income-team-unassigned">Atención: {formatCurrency(unassignedPendingCashTotal)} en efectivo pendiente no tiene equipo asignado.</p> : null}
      </section>
      {teamDeliveryMessage ? <p className="income-team-delivery-message" role="status">{teamDeliveryMessage}</p> : null}
      <div className="income-day-kpis">
        <button type="button" className={statusFilter === "received" ? "income-day-kpi--active" : ""} aria-pressed={statusFilter === "received"} onClick={() => toggleStatusFilter("received")}><span>Total recibido</span><strong>{formatCurrency(receivedTotal)}</strong><small>{receivedCount} pago(s) · Ver detalle</small></button>
        <button type="button" className={`income-day-kpi--pending${statusFilter === "pending" ? " income-day-kpi--active" : ""}`} aria-pressed={statusFilter === "pending"} onClick={() => toggleStatusFilter("pending")}><span>Pendiente de acreditación</span><strong>{formatCurrency(pendingTotal)}</strong><small>Principalmente tarjetas · Ver detalle</small></button>
        <button type="button" className={`income-day-kpi--noncash${statusFilter === "non_cash" ? " income-day-kpi--active" : ""}`} aria-pressed={statusFilter === "non_cash"} onClick={() => toggleStatusFilter("non_cash")}><span>Sin entrada de dinero</span><strong>{formatCurrency(nonCashTotal)}</strong><small>Descuentos y referidos · Ver detalle</small></button>
      </div>

      {pendingDeliveries.length > 0 && <section className="income-delivery-pending" aria-label="Pendientes por entregar">
        <div className="income-delivery-pending-header">
          <div><h3>Pendientes por entregar</h3><p>Marcados como “No” en días anteriores.</p></div>
          <strong>{formatCurrency(pendingDeliveriesTotal)}</strong>
        </div>
        <div className="income-day-table-wrap">
          <table className="income-day-table">
            <thead><tr><th>Dinero correspondiente a</th><th>Unidad / cliente</th><th>Recibo</th><th>Forma</th><th>Equipo</th><th>Monto</th><th>Dinero entregado</th></tr></thead>
            <tbody>{pendingDeliveries.map((payment) => <tr key={`pending-delivery-${payment.id}`}>
              <td>{getIncomeDate(payment)}</td>
              <td><strong>{payment.clientUnit}</strong><small>{payment.clientName}</small></td>
              <td>{payment.receiptNumber}</td>
              <td>{payment.paymentMethod}</td>
              <td>{payment.collectionTeam || "—"}</td>
              <td><strong>{formatCurrency(payment.amountReceived)}</strong></td>
              <td>{readOnly ? <span className="income-delivery-badge income-delivery-badge--no">No</span> : <button type="button" className="button primary small" onClick={() => changeMoneyDelivered(payment, true)}>Marcar Sí</button>}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </section>}

      {deliveredFromPrevious.length > 0 && <section className="income-delivery-completed" aria-label="Entregados hoy de días anteriores">
        <div className="income-delivery-pending-header">
          <div><h3>Entregados hoy de días anteriores</h3><p>Se entregaron hoy, pero el dinero pertenece a la fecha indicada.</p></div>
          <strong>{formatCurrency(deliveredFromPreviousTotal)}</strong>
        </div>
        <div className="income-day-table-wrap">
          <table className="income-day-table">
            <thead><tr><th>Dinero correspondiente a</th><th>Unidad / cliente</th><th>Recibo</th><th>Forma</th><th>Equipo</th><th>Monto</th><th>Entrega</th></tr></thead>
            <tbody>{deliveredFromPrevious.map((payment) => <tr key={`completed-delivery-${payment.id}`}>
              <td>{formatMoneyDay(getIncomeDate(payment))}</td>
              <td><strong>{payment.clientUnit}</strong><small>{payment.clientName}</small></td>
              <td>{payment.receiptNumber}</td>
              <td>{payment.paymentMethod}</td>
              <td>{payment.collectionTeam || "—"}</td>
              <td><strong>{formatCurrency(payment.amountReceived)}</strong></td>
              <td><span className="income-delivery-badge income-delivery-badge--yes">Entregado hoy</span></td>
            </tr>)}</tbody>
          </table>
        </div>
      </section>}

      <div className="income-day-filters" aria-label="Filtros de ingresos">
        <label className="income-day-search">Buscar<input type="search" placeholder="Cliente, unidad, recibo o referencia" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        <label>Forma de pago<select value={methodFilter} onChange={(event) => setMethodFilter(event.target.value)}><option value="all">Todas</option>{PAYMENT_METHODS.map((method) => <option key={method} value={method}>{method}</option>)}</select></label>
        <label>Cuenta o destino<select value={destinationFilter} onChange={(event) => setDestinationFilter(event.target.value)}><option value="all">Todos</option>{destinationOptions.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label>
        <label>Estado<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">Todos</option><option value="received">Recibido</option><option value="pending">Pendiente</option><option value="non_cash">Sin entrada de dinero</option></select></label>
        <label>Dinero entregado<select value={deliveryFilter} onChange={(event) => setDeliveryFilter(event.target.value)}><option value="all">Todos</option><option value="yes">Sí</option><option value="no">No</option></select></label>
        <label>Equipo<select value={teamFilter} onChange={(event) => { setTeamFilter(event.target.value as "all" | "PTY" | "WC"); setTeamDeliveryMessage(""); }}><option value="all">Todos</option><option value="PTY">PTY</option><option value="WC">WC</option></select></label>
        <button type="button" className="button ghost" onClick={clearFilters} disabled={!filtersActive}>Limpiar filtros</button>
      </div>

      {groups.length === 0 && <div className="empty-state"><p>No hay movimientos para esta fecha.</p></div>}
      <div className="income-day-groups">
        {bankGroups.length > 0 && (() => {
          const expanded = filtersActive || expandedKeys.has("bank:consolidated");
          return <article className="income-day-group income-day-group--received income-day-bank-consolidated">
            <button type="button" className="income-day-group-summary" onClick={() => toggleGroup("bank:consolidated")} aria-expanded={expanded}>
              <span><strong>Cuenta bancaria</strong><small>{bankPaymentCount} pago(s) en {bankGroups.length} cuenta(s)</small></span>
              <strong>{formatCurrency(bankTotal)}</strong>
              <span aria-hidden="true">{expanded ? "▴" : "▾"}</span>
            </button>
            {expanded && <div className="income-day-bank-accounts">
              {bankGroups.map((group) => {
                const accountExpanded = filtersActive || expandedKeys.has(group.key);
                const rule = group.accountNumber ? accountOptions.find((item) => item.accountNumber === group.accountNumber) : undefined;
                return <section key={group.key} className="income-day-bank-account">
                  <button type="button" className="income-day-bank-account-summary" onClick={() => toggleGroup(group.key)} aria-expanded={accountExpanded}>
                    <span><strong>{group.label}</strong><small>{rule?.groupCode ? `Grupo ${rule.groupCode} · ` : ""}{group.payments.length} pago(s)</small></span>
                    <strong>{formatCurrency(group.total)}</strong>
                    <span aria-hidden="true">{accountExpanded ? "▴" : "▾"}</span>
                  </button>
                  {accountExpanded && renderPaymentTable(group.payments)}
                </section>;
              })}
            </div>}
          </article>;
        })()}
        {nonBankGroups.map((group) => {
          const expanded = filtersActive || expandedKeys.has(group.key);
          return (
            <article key={group.key} className={`income-day-group income-day-group--${group.status}`}>
              <button type="button" className="income-day-group-summary" onClick={() => toggleGroup(group.key)} aria-expanded={expanded}>
                <span><strong>{group.label}</strong><small>{group.payments.length} pago(s)</small></span>
                <strong>{formatCurrency(group.total)}</strong>
                <span aria-hidden="true">{expanded ? "▴" : "▾"}</span>
              </button>
              {expanded && renderPaymentTable(group.payments)}
            </article>
          );
        })}
      </div>

      {editingPayment && <div className="modal-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditingPayment(null); }}>
        <div className="modal income-edit-modal" role="dialog" aria-modal="true" aria-labelledby="income-edit-title">
          <div className="modal-header"><h2 id="income-edit-title">Editar ingreso {editingPayment.receiptNumber}</h2><button type="button" className="modal-close" onClick={() => setEditingPayment(null)}>×</button></div>
          <div className="modal-body income-edit-form">
            {BANK_PAYMENT_METHODS.has(editingPayment.paymentMethod) || editingPayment.paymentMethod === "Tarjeta" ? <label>Cuenta receptora
              <select value={editAccount} onChange={(event) => setEditAccount(event.target.value)}>
                <option value="">Cuenta no identificada</option>
                {editAccount && !accountOptions.some((rule) => rule.accountNumber === editAccount) && <option value={editAccount}>Actual · {maskAccountNumber(editAccount)}</option>}
                {accountOptions.map((rule) => <option key={rule.id} value={rule.accountNumber}>{rule.accountName || "Cuenta bancaria"} · {maskAccountNumber(rule.accountNumber)} · Grupo {rule.groupCode}</option>)}
              </select>
            </label> : null}
            <label>Comentario<textarea rows={3} value={editComment} onChange={(event) => setEditComment(event.target.value)} placeholder="Comentario opcional" /></label>
            {editAccount.trim() !== (editingPayment.bankAccountNumber?.trim() ?? "") && <label>Motivo de la corrección<input value={editReason} onChange={(event) => setEditReason(event.target.value)} placeholder="Obligatorio al cambiar la cuenta" /></label>}
            {editError && <p className="hint error-text">{editError}</p>}
            {(editingPayment.incomeEdits?.length ?? 0) > 0 && <details><summary>Historial de ediciones ({editingPayment.incomeEdits?.length})</summary><ul className="income-edit-audit">{[...(editingPayment.incomeEdits ?? [])].reverse().map((edit) => <li key={edit.id}><strong>{edit.actor}</strong> · {new Date(edit.createdAt).toLocaleString("es-PA")}{edit.reason ? ` · ${edit.reason}` : ""}</li>)}</ul></details>}
            <div className="modal-actions"><button type="button" className="button ghost" onClick={() => setEditingPayment(null)}>Cancelar</button><button type="button" className="button primary" onClick={saveEdit}>Guardar cambios</button></div>
          </div>
        </div>
      </div>}

      {showSharePreview && <div className="modal-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowSharePreview(false); }}>
        <div className="modal income-share-modal" role="dialog" aria-modal="true" aria-labelledby="income-share-title">
          <div className="modal-header"><h2 id="income-share-title">Compartir reporte por WhatsApp</h2><button type="button" className="modal-close" onClick={() => setShowSharePreview(false)}>×</button></div>
          <div className="modal-body income-share-body">
            <label className="income-share-scope">Contenido del reporte<select value={shareScope} onChange={(event) => { setShareScope(event.target.value as ShareScope); setShareStatus(""); }}><option value="full">Reporte completo</option><option value="filtered">Resultado de los filtros actuales</option><option value="cash">Solo efectivo</option><option value="pending">Solo pendientes</option></select></label>
            <div className="income-whatsapp-pages-preview" ref={shareReportRef}>
              <article className="income-whatsapp-card income-whatsapp-page">
                <header><span>RENTAUTOS</span><strong>REPORTE DE INGRESOS</strong><small>{formatMoneyDay(dateKey)} · {shareScopeLabel[shareScope]}</small></header>
                <section className="income-whatsapp-total"><span>Total recibido</span><strong>{formatCurrency(shareReceivedTotal)}</strong><small>{shareReceivedGroups.reduce((sum, group) => sum + group.payments.length, 0)} movimiento(s)</small></section>
                <section className="income-whatsapp-breakdown">
                  <h3>Detalle por destino</h3>
                  {shareReceivedGroups.length === 0 ? <p>Sin ingresos recibidos.</p> : shareSummaryDestinations.map((group) => <div key={`share-${group.key}`}><span>{group.label}<small>{group.payments.length} pago(s)</small></span><strong>{formatCurrency(group.total)}</strong></div>)}
                  {shareConsolidatedGroups.length > 7 && <p className="income-whatsapp-continued">Continúa en la siguiente página…</p>}
                </section>
                <section className="income-whatsapp-alerts">
                  <div><span>Efectivo pendiente</span><strong>{formatCurrency(shareCashPendingTotal)}</strong></div>
                  <div><span>Tarjetas pendientes</span><strong>{formatCurrency(shareCardPendingTotal)}</strong></div>
                  {sharePreviousDeliveryTotal > 0 && <div><span>Entregado hoy de días anteriores</span><strong>{formatCurrency(sharePreviousDeliveryTotal)}</strong></div>}
                </section>
                <footer><span>Cuentas enmascaradas · Sin datos de cédula</span><small>Página 1 de {sharePageCount}</small></footer>
              </article>

              {shareAdditionalDestinationPages.map((destinationPage, pageIndex) => <article className="income-whatsapp-card income-whatsapp-page" key={`share-destinations-page-${pageIndex}`}>
                <header><span>RENTAUTOS</span><strong>DETALLE POR DESTINO</strong><small>{formatMoneyDay(dateKey)} · continuación</small></header>
                <section className="income-whatsapp-breakdown income-whatsapp-page-content">{destinationPage.map((group) => <div key={`share-extra-${group.key}`}><span>{group.label}<small>{group.payments.length} pago(s)</small></span><strong>{formatCurrency(group.total)}</strong></div>)}</section>
                <footer><span>Reporte de ingresos · {shareScopeLabel[shareScope]}</span><small>Página {pageIndex + 2} de {sharePageCount}</small></footer>
              </article>)}

              {shareBankDetailPages.map((bankPage, pageIndex) => {
                const pageNumber = 2 + shareAdditionalDestinationPages.length + pageIndex;
                return <article className="income-whatsapp-card income-whatsapp-page" key={`share-bank-page-${pageIndex}`}>
                  <header><span>RENTAUTOS</span><strong>DETALLE BANCARIO</strong><small>{formatMoneyDay(dateKey)} · por cuenta</small></header>
                  <section className="income-whatsapp-total"><span>Total cuenta bancaria</span><strong>{formatCurrency(shareBankTotal)}</strong><small>{shareBankPayments.length} movimiento(s)</small></section>
                  <section className="income-whatsapp-breakdown income-whatsapp-page-content">{bankPage.map((group) => <div key={`share-bank-${group.key}`}><span>{group.label}<small>{group.payments.length} pago(s)</small></span><strong>{formatCurrency(group.total)}</strong></div>)}</section>
                  <footer><span>Cuentas bancarias enmascaradas</span><small>Página {pageNumber} de {sharePageCount}</small></footer>
                </article>;
              })}

              {shareCashDeliveredPages.map((cashPage, pageIndex) => {
                const pageNumber = 2 + shareAdditionalDestinationPages.length + shareBankDetailPages.length + pageIndex;
                return <article className="income-whatsapp-card income-whatsapp-page" key={`share-delivered-page-${pageIndex}`}>
                  <header><span>RENTAUTOS</span><strong>EFECTIVO ENTREGADO</strong><small>{formatMoneyDay(dateKey)} · detalle</small></header>
                  <section className="income-whatsapp-cash-detail income-whatsapp-page-content"><div className="income-whatsapp-cash-block income-whatsapp-cash-block--delivered"><h4>Total entregado · {formatCurrency(shareCashDeliveredRows.reduce((sum, payment) => sum + payment.amountReceived, 0))}</h4>{cashPage.map((payment) => <p key={`share-cash-delivered-${payment.id}`}><span><strong>{payment.clientUnit}</strong><small>{getDeliveryContext(payment)}</small></span><strong>{formatCurrency(payment.amountReceived)}</strong></p>)}</div></section>
                  <footer><span>Detalle de efectivo entregado</span><small>Página {pageNumber} de {sharePageCount}</small></footer>
                </article>;
              })}

              {shareCashPendingPages.map((cashPage, pageIndex) => {
                const pageNumber = 2 + shareAdditionalDestinationPages.length + shareBankDetailPages.length + shareCashDeliveredPages.length + pageIndex;
                return <article className="income-whatsapp-card income-whatsapp-page" key={`share-pending-page-${pageIndex}`}>
                  <header><span>RENTAUTOS</span><strong>EFECTIVO PENDIENTE</strong><small>{formatMoneyDay(dateKey)} · detalle</small></header>
                  <section className="income-whatsapp-cash-detail income-whatsapp-page-content"><div className="income-whatsapp-cash-block income-whatsapp-cash-block--pending"><h4>Total pendiente · {formatCurrency(shareCashPendingRows.reduce((sum, payment) => sum + payment.amountReceived, 0))}</h4>{cashPage.map((payment) => <p key={`share-cash-pending-${payment.id}`}><span><strong>{payment.clientUnit}</strong><small>Dinero del {formatMoneyDay(getIncomeDate(payment))}</small></span><strong>{formatCurrency(payment.amountReceived)}</strong></p>)}</div></section>
                  <footer><span>Detalle de efectivo pendiente</span><small>Página {pageNumber} de {sharePageCount}</small></footer>
                </article>;
              })}

              {shareCommentPages.map((commentPage, pageIndex) => {
                const pageNumber = 2 + shareAdditionalDestinationPages.length + shareBankDetailPages.length + shareCashDeliveredPages.length + shareCashPendingPages.length + pageIndex;
                return <article className="income-whatsapp-card income-whatsapp-page" key={`share-comments-page-${pageIndex}`}>
                  <header><span>RENTAUTOS</span><strong>COMENTARIOS IMPORTANTES</strong><small>{formatMoneyDay(dateKey)} · observaciones</small></header>
                  <section className="income-whatsapp-comments income-whatsapp-page-content">{commentPage.map((payment) => <p key={`share-comment-${payment.id}`}><strong>{payment.clientUnit}:</strong> {payment.incomeComment}</p>)}</section>
                  <footer><span>Observaciones del reporte</span><small>Página {pageNumber} de {sharePageCount}</small></footer>
                </article>;
              })}
            </div>
            <details className="income-share-text"><summary>Ver texto para WhatsApp</summary><pre>{buildWhatsAppText()}</pre></details>
            {shareStatus && <p className="hint recon-info">{shareStatus}</p>}
            <div className="income-share-actions"><button type="button" className="button ghost" onClick={() => void copyWhatsAppText()}>Copiar texto</button><button type="button" className="button ghost" onClick={() => void downloadHighResolutionImages()}>Descargar imágenes HD</button><button type="button" className="button ghost" onClick={() => void downloadSharePdf()}>Descargar PDF</button><button type="button" className="button primary" onClick={() => void shareHighResolutionImages()}>Compartir imágenes HD</button></div>
          </div>
        </div>
      </div>}
    </section>
  );
}
