import { useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { formatCurrency } from "../../format";
import type { BankRule, CollectionTeam, Payment, PaymentIncomeEdit } from "../../types";
import { getBusinessDateKey } from "../../billing";
import { CASH_TEAM_REQUIRED_MESSAGE, hasCollectionTeam, isPendingCashWithoutTeam } from "../../cashTeamRules";
import { BANK_PAYMENT_METHODS } from "./paymentConstants";
import { PAYMENT_METHODS } from "./paymentConstants";
import {
  buildDailyIncomeGroups,
  buildDeliveredFromPreviousRows,
  buildPendingCashRowsByTeam,
  buildPendingCashRows,
  buildPendingDeliveryRows,
  getDailyIncomeStatus,
  getDailyIncomeReportDate,
  getDailyIncomeDestination,
  getIncomeDate,
  isMoneyDelivered,
  validateCashDeliveryDate,
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
type TeamFilter = "all" | "PTY" | "WC" | "unassigned";
type CashSort = "oldest" | "newest" | "amount_desc" | "amount_asc" | "unit";
type CashFilters = { search: string; team: TeamFilter; sort: CashSort };
const DEFAULT_PENDING_FILTERS: CashFilters = { search: "", team: "all", sort: "oldest" };
const DEFAULT_DELIVERED_FILTERS: CashFilters = { search: "", team: "all", sort: "newest" };

function matchesCashFilters(payment: Payment, filters: CashFilters): boolean {
  if (filters.team === "unassigned" && hasCollectionTeam(payment.collectionTeam)) return false;
  if (filters.team !== "all" && filters.team !== "unassigned" && payment.collectionTeam !== filters.team) return false;
  const query = filters.search.trim().toLocaleLowerCase("es");
  return !query || [payment.clientName, payment.clientUnit, payment.receiptNumber, payment.reference ?? "", payment.incomeComment ?? "", payment.collectionTeam ?? "PAGADO EN CAJA"]
    .some(value => value.toLocaleLowerCase("es").includes(query));
}

function sortCashRows(rows: Payment[], sort: CashSort): Payment[] {
  return [...rows].sort((a, b) => {
    const byDate = getIncomeDate(a).localeCompare(getIncomeDate(b)) || a.createdAt.localeCompare(b.createdAt);
    const order = sort === "amount_desc" ? b.amountReceived - a.amountReceived
      : sort === "amount_asc" ? a.amountReceived - b.amountReceived
      : sort === "unit" ? a.clientUnit.localeCompare(b.clientUnit, "es", { numeric: true })
      : sort === "newest" ? -byDate : byDate;
    return order || a.receiptNumber.localeCompare(b.receiptNumber, "es", { numeric: true }) || a.id.localeCompare(b.id);
  });
}

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
  return date.toLocaleDateString("es", { day: "numeric", month: "long", year: "numeric" });
}

function getDeliveryContext(payment: Payment): string {
  const moneyDate = getIncomeDate(payment);
  if (!isMoneyDelivered(payment)) return `Pendiente · dinero del ${formatMoneyDay(moneyDate)}`;
  if (payment.moneyDeliveryDate) {
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
  const [incomeView, setIncomeView] = useState<"other" | "cash">("cash");
  const [cashStatus, setCashStatus] = useState<"pending" | "delivered">("pending");
  const [deliveryIds, setDeliveryIds] = useState<string[]>([]);
  const [selectedCashIds, setSelectedCashIds] = useState<string[]>([]);
  const [deliveryDate, setDeliveryDate] = useState("");
  const [deliveryReason, setDeliveryReason] = useState("");
  const [deliveryError, setDeliveryError] = useState("");
  const [search, setSearch] = useState("");
  const [methodFilter, setMethodFilter] = useState("all");
  const [destinationFilter, setDestinationFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [deliveryFilter, setDeliveryFilter] = useState("all");
  const [teamFilter, setTeamFilter] = useState<TeamFilter>("all");
  const [pendingFilters, setPendingFilters] = useState<CashFilters>(DEFAULT_PENDING_FILTERS);
  const [deliveredFilters, setDeliveredFilters] = useState<CashFilters>(DEFAULT_DELIVERED_FILTERS);
  const [teamDeliveryMessage, setTeamDeliveryMessage] = useState("");
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [editingPayment, setEditingPayment] = useState<Payment | null>(null);
  const [markPendingAfterEdit, setMarkPendingAfterEdit] = useState(false);
  const [editAccount, setEditAccount] = useState("");
  const [editTeam, setEditTeam] = useState<"" | CollectionTeam>("");
  const [editComment, setEditComment] = useState("");
  const [editReason, setEditReason] = useState("");
  const [editError, setEditError] = useState("");
  const [showSharePreview, setShowSharePreview] = useState(false);
  const [shareScope, setShareScope] = useState<ShareScope>("full");
  const [shareStatus, setShareStatus] = useState("");
  const shareReportRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (isOpen) {
      setIncomeView("cash");
      clearFilters();
    }
  }, [isOpen]);

  useLayoutEffect(() => {
    setSelectedCashIds([]);
  }, [incomeView, dateKey, search, teamFilter, methodFilter, destinationFilter, statusFilter, deliveryFilter, isOpen, pendingFilters.search, pendingFilters.team]);

  const viewPayments = useMemo(() => payments.filter(payment =>
    (payment.paymentMethod === "Efectivo") === (incomeView === "cash")
  ), [payments, incomeView]);
  const rawGroups = useMemo(() => buildDailyIncomeGroups(viewPayments, dateKey, bankRules), [viewPayments, dateKey, bankRules]);
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
    return viewPayments.filter((payment) => {
      if (incomeView === "cash") return matchesCashFilters(payment, isMoneyDelivered(payment) ? deliveredFilters : pendingFilters);
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
      if (teamFilter === "unassigned" && (payment.collectionTeam === "PTY" || payment.collectionTeam === "WC")) return false;
      if (teamFilter !== "all" && teamFilter !== "unassigned" && payment.collectionTeam !== teamFilter) return false;
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
  }, [viewPayments, bankRules, search, methodFilter, destinationFilter, statusFilter, deliveryFilter, teamFilter, incomeView, pendingFilters, deliveredFilters]);
  const groups = useMemo(() => buildDailyIncomeGroups(filteredPayments, dateKey, bankRules), [filteredPayments, dateKey, bankRules]);
  const bankGroups = groups.filter((group) => group.key.startsWith("bank:"));
  const nonBankGroups = groups.filter((group) => !group.key.startsWith("bank:"));
  const bankTotal = bankGroups.reduce((sum, group) => sum + group.total, 0);
  const bankPaymentCount = bankGroups.reduce((sum, group) => sum + group.payments.length, 0);
  const pendingDeliveries = useMemo(() => buildPendingDeliveryRows(filteredPayments, dateKey), [filteredPayments, dateKey]);
  const pendingDeliveriesTotal = pendingDeliveries.reduce((sum, payment) => sum + payment.amountReceived, 0);
  const cashPendingRows = useMemo(() => sortCashRows(buildPendingCashRows(filteredPayments, dateKey), pendingFilters.sort), [filteredPayments, dateKey, pendingFilters.sort]);
  const cashDeliveredRows = sortCashRows(groups.filter(group => group.key === "cash").flatMap(group => group.payments), deliveredFilters.sort);
  const selectedCashSet = useMemo(() => new Set(selectedCashIds), [selectedCashIds]);
  const selectedCashRows = cashPendingRows.filter(payment => selectedCashSet.has(payment.id));
  const selectedCashTotal = selectedCashRows.reduce((sum, payment) => sum + payment.amountReceived, 0);
  const allPendingSelected = cashPendingRows.length > 0 && selectedCashRows.length === cashPendingRows.length;
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
  const deliveryPayments = payments.filter(payment => deliveryIds.includes(payment.id));
  const isDeliveryCorrection = deliveryPayments.some(isMoneyDelivered);
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
  const sharePendingByTeam = buildPendingCashRowsByTeam(shareSourcePayments, dateKey);
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
    setCashStatus("pending");
    setSearch("");
    setMethodFilter("all");
    setDestinationFilter("all");
    setStatusFilter("all");
    setDeliveryFilter("all");
    setTeamFilter("all");
    setPendingFilters(DEFAULT_PENDING_FILTERS);
    setDeliveredFilters(DEFAULT_DELIVERED_FILTERS);
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
    if (shareSourcePayments.some(payment => payment.paymentMethod === "Efectivo")) {
      lines.push("", `*Efectivo pendiente de entrega:* ${formatCurrency(shareCashPendingTotal)}`);
      for (const team of ["PTY", "WC", "unassigned"] as const) {
        const rows = sharePendingByTeam[team];
        if (rows.length > 0) lines.push(`• ${team === "unassigned" ? "PAGADO EN CAJA — pendiente" : `Equipo ${team} debe entregar`}: ${formatCurrency(rows.reduce((sum, payment) => sum + payment.amountReceived, 0))} (${rows.length})`);
      }
    }
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
    setMarkPendingAfterEdit(false);
    setEditAccount(payment.bankAccountNumber ?? "");
    setEditTeam(payment.collectionTeam ?? "");
    setEditComment(payment.incomeComment ?? "");
    setEditReason(isPendingCashWithoutTeam(payment) ? "Asignación de equipo a efectivo pendiente" : "");
    setEditError("");
  }

  function changeMoneyDelivered(payment: Payment, delivered: boolean): void {
    if (readOnly) return;
    if (payment.paymentMethod === "Efectivo" && delivered) {
      openDelivery([payment]);
      return;
    }
    const previousDelivered = isMoneyDelivered(payment);
    if (previousDelivered === delivered) return;
    if (payment.paymentMethod === "Efectivo" && !delivered && !hasCollectionTeam(payment.collectionTeam)) {
      openEdit(payment);
      setMarkPendingAfterEdit(true);
      setEditReason("Asignación de equipo para dejar el efectivo pendiente");
      setEditError(CASH_TEAM_REQUIRED_MESSAGE);
      return;
    }
    const changedAt = new Date().toISOString();
    const audit: PaymentIncomeEdit = {
      id: crypto.randomUUID(),
      createdAt: changedAt,
      actor: currentActor,
      reason: delivered ? "Dinero marcado como entregado" : "Dinero marcado como pendiente de entrega",
      previousMoneyDelivered: previousDelivered,
      nextMoneyDelivered: delivered,
      previousMoneyDeliveryDate: previousDelivered ? getDailyIncomeReportDate(payment) : undefined,
      nextMoneyDeliveryDate: delivered ? dateKey : undefined
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
    setPendingFilters({ ...DEFAULT_PENDING_FILTERS, team: pendingFilters.team === team ? "all" : team });
    setTeamDeliveryMessage("");
  }

  function markTeamCashDelivered(team: "PTY" | "WC"): void {
    if (readOnly) return;
    openDelivery(pendingCashByTeam[team]);
  }

  function openDelivery(rows: Payment[]): void {
    if (readOnly || rows.length === 0) return;
    setDeliveryIds(rows.map(payment => payment.id));
    setDeliveryDate(rows.length === 1 && isMoneyDelivered(rows[0])
      ? getDailyIncomeReportDate(rows[0]) : dateKey);
    setDeliveryReason("");
    setDeliveryError("");
  }

  function saveDelivery(): void {
    if (readOnly || deliveryIds.length === 0) return;
    if (deliveryPayments.length !== deliveryIds.length) {
      setDeliveryError("La lista de recibos cambió. Cierra esta ventana y vuelve a seleccionar la entrega.");
      return;
    }
    const error = validateCashDeliveryDate(deliveryPayments, deliveryDate, getBusinessDateKey());
    if (error) { setDeliveryError(error); return; }
    if (isDeliveryCorrection && !deliveryReason.trim()) {
      setDeliveryError("Indica el motivo de la corrección de fecha.");
      return;
    }
    const changedAt = new Date().toISOString();
    onPaymentsChange(payments.map((payment) => {
      if (!deliveryIds.includes(payment.id)) return payment;
      if (isMoneyDelivered(payment) && getDailyIncomeReportDate(payment) === deliveryDate) return payment;
      const audit: PaymentIncomeEdit = {
        id: crypto.randomUUID(),
        createdAt: changedAt,
        actor: currentActor,
        reason: deliveryReason.trim() || "Entrega de efectivo",
        previousMoneyDelivered: isMoneyDelivered(payment),
        nextMoneyDelivered: true,
        previousMoneyDeliveryDate: isMoneyDelivered(payment) ? getDailyIncomeReportDate(payment) : undefined,
        nextMoneyDeliveryDate: deliveryDate
      };
      return {
        ...payment,
        moneyDelivered: true,
        moneyDeliveryDate: deliveryDate,
        moneyDeliveryUpdatedAt: changedAt,
        moneyDeliveryUpdatedBy: currentActor,
        incomeEdits: [...(payment.incomeEdits ?? []), audit]
      };
    }));
    setTeamDeliveryMessage(`Entrega registrada para el ${formatMoneyDay(deliveryDate)} · ${deliveryIds.length} recibo(s).`);
    setDeliveryIds([]);
    setSelectedCashIds([]);
  }

  function saveEdit(): void {
    if (readOnly || !editingPayment) return;
    const nextAccount = editAccount.trim();
    const previousAccount = editingPayment.bankAccountNumber?.trim() ?? "";
    const previousTeam = editingPayment.collectionTeam ?? "";
    const nextTeam = editTeam;
    if (isPendingCashWithoutTeam({ ...editingPayment, moneyDelivered: markPendingAfterEdit ? false : editingPayment.moneyDelivered, collectionTeam: nextTeam || undefined })) {
      setEditError(CASH_TEAM_REQUIRED_MESSAGE);
      return;
    }
    const teamChanged = nextTeam !== previousTeam;
    const enteredComment = editComment.trim();
    const previousComment = editingPayment.incomeComment?.trim() ?? "";
    const routeComment = previousTeam ? `Cobro en Ruta · Equipo ${previousTeam}` : "";
    const nextComment = teamChanged && enteredComment === routeComment && nextTeam
      ? `Cobro en Ruta · Equipo ${nextTeam}`
      : enteredComment;
    const accountChanged = nextAccount !== previousAccount;
    const commentChanged = nextComment !== previousComment;
    if (!accountChanged && !teamChanged && !commentChanged && !markPendingAfterEdit) {
      setEditingPayment(null);
      return;
    }
    if ((accountChanged || teamChanged) && !editReason.trim()) {
      setEditError("Indica el motivo de la corrección.");
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
      nextComment: commentChanged ? nextComment || undefined : undefined,
      previousCollectionTeam: teamChanged ? previousTeam || undefined : undefined,
      nextCollectionTeam: teamChanged ? nextTeam || undefined : undefined,
      ...(markPendingAfterEdit ? {
        previousMoneyDelivered: isMoneyDelivered(editingPayment), nextMoneyDelivered: false,
        previousMoneyDeliveryDate: getDailyIncomeReportDate(editingPayment)
      } : {})
    };
    onPaymentsChange(payments.map((payment) => payment.id === editingPayment.id ? {
      ...payment,
      bankAccountNumber: nextAccount || undefined,
      bankGroupCode: matchedRule?.groupCode || (nextAccount === previousAccount ? payment.bankGroupCode : undefined),
      collectionTeam: nextTeam || undefined,
      incomeComment: nextComment || undefined,
      ...(markPendingAfterEdit ? {
        moneyDelivered: false, moneyDeliveryDate: undefined,
        moneyDeliveryUpdatedAt: audit.createdAt, moneyDeliveryUpdatedBy: currentActor
      } : {}),
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
          <td>{!readOnly && <><button type="button" className="button ghost small" onClick={() => openEdit(payment)}>Editar</button>{payment.paymentMethod === "Efectivo" && isMoneyDelivered(payment) && <button type="button" className="button ghost small" onClick={() => openDelivery([payment])}>Cambiar fecha de entrega</button>}</>}</td>
        </tr>)}</tbody>
      </table>
    </div>;
  }

  function renderCashFilters(zone: "pending" | "delivered") {
    const label = zone === "pending" ? "Falta entregar" : "Ya entregado";
    const filters = zone === "pending" ? pendingFilters : deliveredFilters;
    const setFilters = zone === "pending" ? setPendingFilters : setDeliveredFilters;
    const defaults = zone === "pending" ? DEFAULT_PENDING_FILTERS : DEFAULT_DELIVERED_FILTERS;
    const active = filters.search !== "" || filters.team !== "all" || filters.sort !== defaults.sort;
    return <div className="income-zone-filters" role="group" aria-label={`Filtros de ${label}`}>
      <div className="income-zone-filter-fields">
        <label>Buscar<input type="search" aria-label={`Buscar en ${label}`} placeholder="Unidad, cliente o recibo" value={filters.search} onChange={event => setFilters(current => ({ ...current, search: event.target.value }))} /></label>
        <label>Ordenar<select aria-label={`Ordenar ${label}`} value={filters.sort} onChange={event => setFilters(current => ({ ...current, sort: event.target.value as CashSort }))}>
          <option value="oldest">Cobro más antiguo</option><option value="newest">Cobro más reciente</option><option value="amount_desc">Mayor monto primero</option><option value="amount_asc">Menor monto primero</option><option value="unit">Por unidad</option>
        </select></label>
        <button type="button" className="button ghost small" aria-label={`Limpiar filtros de ${label}`} disabled={!active} onClick={() => setFilters(defaults)}>Limpiar</button>
      </div>
      <div className="income-zone-team-filters" role="group" aria-label={`Equipo de ${label}`}>
        {([['all', 'Todos'], ['PTY', 'PTY'], ['WC', 'WC'], ['unassigned', 'PAGADO EN CAJA']] as const).map(([value, name]) => <button key={value} type="button" className={`income-zone-team-filter income-zone-team-filter--${value.toLowerCase()}`} aria-pressed={filters.team === value} onClick={() => setFilters(current => ({ ...current, team: value }))}>{name}</button>)}
      </div>
    </div>;
  }

  function renderCashReceipts(rows: Payment[]) {
    return <div className="income-cash-receipts">{rows.map(payment => <article className={`income-cash-receipt${hasCollectionTeam(payment.collectionTeam) ? ` income-cash-receipt--${payment.collectionTeam.toLowerCase()}` : ""}${isPendingCashWithoutTeam(payment) ? " income-cash-receipt--no-team" : ""}${!isMoneyDelivered(payment) && selectedCashSet.has(payment.id) ? " income-cash-receipt--selected" : ""}`} key={payment.id} aria-label={`Recibo ${payment.receiptNumber}`}>
      {!readOnly && !isMoneyDelivered(payment) && <label className="income-cash-select"><input type="checkbox" aria-label={`Seleccionar recibo ${payment.receiptNumber}`} checked={selectedCashSet.has(payment.id)} onChange={event => {
        const checked = event.target.checked;
        setSelectedCashIds(current => checked ? [...new Set([...current, payment.id])] : current.filter(id => id !== payment.id));
      }} />{selectedCashSet.has(payment.id) ? "Seleccionado" : "Seleccionar"}</label>}
      <div className="income-cash-receipt-main">
        <div><strong>{payment.clientUnit} · {payment.clientName}</strong><small>Recibo {payment.receiptNumber}</small>{hasCollectionTeam(payment.collectionTeam) ? <span className={`income-team-badge income-team-badge--${payment.collectionTeam.toLowerCase()}`}>EQUIPO {payment.collectionTeam}</span> : <span className="income-no-team-badge">PAGADO EN CAJA</span>}</div>
        <strong className="income-cash-amount">{formatCurrency(payment.amountReceived)}</strong>
      </div>
      <div className="income-cash-receipt-dates"><span>Cobrado: {formatMoneyDay(getIncomeDate(payment))}</span>{isMoneyDelivered(payment) && <span>Entregado: {formatMoneyDay(getDailyIncomeReportDate(payment))}</span>}</div>
      {payment.incomeComment && <p className="income-cash-comment">{payment.incomeComment}</p>}
      {!readOnly && <div className="income-cash-receipt-actions">
        {isPendingCashWithoutTeam(payment) && <button type="button" className="button primary small" onClick={() => openEdit(payment)}>Asignar equipo</button>}
        <button type="button" className={`button ${isMoneyDelivered(payment) ? "ghost" : "primary"} small`} onClick={() => openDelivery([payment])}>{isMoneyDelivered(payment) ? "Cambiar fecha de entrega" : "Registrar entrega"}</button>
        <details className="income-cash-more"><summary>Más opciones</summary><div>
          <button type="button" className="button ghost small" onClick={() => openEdit(payment)}>Editar datos</button>
          {isMoneyDelivered(payment) && <button type="button" className="button ghost small" onClick={() => changeMoneyDelivered(payment, false)}>Dejar pendiente</button>}
        </div></details>
      </div>}
    </article>)}</div>;
  }

  async function exportExcel(): Promise<void> {
    const exportGroups = [...bankGroups, ...nonBankGroups, ...(incomeView === "cash" && pendingDeliveries.length > 0 ? [{
      key: "cash-pending-previous", label: "Efectivo pendiente de días anteriores", payments: pendingDeliveries
    }] : [])];
    const rows = exportGroups.flatMap((group) => group.payments.map((payment) => ({
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
      ["Ingresos del día", dateKey, incomeView === "cash" ? "Efectivo" : "Bancos y otros medios"],
      ["Destino", "Estado", "Pagos", "Total"],
      ...(bankGroups.length > 0 ? [
        ["Cuenta bancaria", "received", bankPaymentCount, bankTotal],
        ...bankGroups.map((group) => [`  ${group.label}`, group.status, group.payments.length, group.total])
      ] : []),
      ...nonBankGroups.map((group) => [group.label, group.status, group.payments.length, group.total]),
      [],
      ...(incomeView === "cash" ? [
      ["Efectivo por entregar · PTY", "pending", pendingCashTeamSummary[0].payments.length, pendingCashTeamSummary[0].total],
      ["Efectivo por entregar · WC", "pending", pendingCashTeamSummary[1].payments.length, pendingCashTeamSummary[1].total],
      ["Total efectivo por entregar de equipos", "pending", pendingCashTeamSummary[0].payments.length + pendingCashTeamSummary[1].payments.length, pendingCashTeamTotal],
      ...(unassignedPendingCashTotal > 0 ? [["PAGADO EN CAJA — pendiente", "pending", pendingCashByTeam.unassigned.length, unassignedPendingCashTotal]] : [])
      ] : []),
      [],
      ["Total recibido", receivedTotal],
      [incomeView === "cash" ? "Efectivo pendiente de entrega" : "Pendiente de acreditación", pendingTotal + (incomeView === "cash" ? pendingDeliveriesTotal : 0)],
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
          <p className="hint">{incomeView === "cash" ? "Revisa cuánto falta entregar y registra el efectivo que ya recibiste." : "Consulta los pagos recibidos en bancos y otros medios."}</p>
        </div>
        <div className="income-day-actions">
          <label>Día que estás revisando<input type="date" value={dateKey} onChange={(event) => setDateKey(event.target.value)} /></label>
          <details className="income-report-options"><summary>Reportes y descargas</summary><div>
            <button type="button" className="button ghost small" onClick={() => void exportExcel()}>Exportar Excel</button>
            <button type="button" className="button ghost small" onClick={() => { setShareStatus(""); setShareScope("filtered"); setShowSharePreview(true); }}>Compartir reporte</button>
          </div></details>
        </div>
      </div>

      {!isPaymentHistoryLoaded && <p className="hint">El historial completo todavía está cargando; los totales pueden cambiar.</p>}
      <div className="income-view-tabs" role="tablist" aria-label="Tipo de ingreso">
        {(["cash", "other"] as const).map((view, index) => <button key={view} type="button" role="tab"
          id={`income-view-${view}`} aria-controls="income-view-panel" aria-selected={incomeView === view}
          tabIndex={incomeView === view ? 0 : -1}
          onClick={() => { setIncomeView(view); clearFilters(); }}
          onKeyDown={event => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const next = event.key === "Home" ? "cash" : event.key === "End" ? "other" : index === 0 ? "other" : "cash";
            setIncomeView(next); clearFilters(); document.getElementById(`income-view-${next}`)?.focus();
          }}>{view === "cash" ? "Efectivo" : "Bancos y otros medios"}</button>)}
      </div>
      <div id="income-view-panel" role="tabpanel" aria-labelledby={`income-view-${incomeView}`}>
      {teamDeliveryMessage ? <p className="income-team-delivery-message" role="status">{teamDeliveryMessage}</p> : null}
      {incomeView === "cash" && <>
        <div className="income-cash-summary" role="tablist" aria-label="Estado del efectivo">
          {(["pending", "delivered"] as const).map((status, index) => <button key={status} type="button" role="tab"
            className={`income-cash-summary-${status}`} id={`cash-status-tab-${status}`}
            aria-label={status === "pending" ? "Falta entregar" : "Ya entregado"}
            aria-controls={`cash-status-panel-${status}`} aria-selected={cashStatus === status}
            tabIndex={cashStatus === status ? 0 : -1}
            onClick={() => setCashStatus(status)}
            onKeyDown={event => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              const next = event.key === "Home" ? "pending" : event.key === "End" ? "delivered" : index === 0 ? "delivered" : "pending";
              setCashStatus(next);
              document.getElementById(`cash-status-tab-${next}`)?.focus();
            }}>
            <span>{status === "pending" ? "◷ Falta entregar" : "✓ Ya entregado"}</span>
            <strong>{formatCurrency(status === "pending" ? cashPendingRows.reduce((sum, payment) => sum + payment.amountReceived, 0) : receivedTotal)}</strong>
            <small>{status === "pending" ? `${cashPendingRows.length} recibo(s) pendientes` : `${cashDeliveredRows.length} recibo(s) entregados`}</small>
          </button>)}
        </div>
        <div id="cash-status-panel-pending" className="income-cash-status-panel" role="tabpanel" aria-labelledby="cash-status-tab-pending" hidden={cashStatus !== "pending"}>
        {pendingCashByTeam.unassigned.length > 0 && <article className="income-other-cash income-missing-team-alert" aria-label="Efectivo pendiente PAGADO EN CAJA">
          <div><h4>PAGADO EN CAJA</h4><p>{pendingCashByTeam.unassigned.length} {pendingCashByTeam.unassigned.length === 1 ? "recibo pendiente necesita" : "recibos pendientes necesitan"} un equipo. Selecciona PTY o WC en cada recibo.</p></div>
          <strong>{formatCurrency(unassignedPendingCashTotal)}</strong>
          <button type="button" className="button ghost small" onClick={() => {
            setPendingFilters({ ...DEFAULT_PENDING_FILTERS, team: "unassigned" });
            requestAnimationFrame(() => document.getElementById("income-cash-pending")?.scrollIntoView({ behavior: "smooth", block: "start" }));
          }}>Ver estos recibos</button>
        </article>}
        <details className="income-cash-teams">
          <summary>Ver pendientes y entregas por equipo</summary>
          <section className="income-team-closing" aria-label="Efectivo pendiente por equipo">
        <div className="income-team-closing-head">
          <div>
            <h3>Falta entregar por equipo</h3>
            <p>Todos los recibos pendientes hasta el día elegido. Puedes registrar juntos los de un equipo.</p>
          </div>
          <div><span>Total por entregar</span><strong>{formatCurrency(pendingCashTeamTotal + unassignedPendingCashTotal)}</strong></div>
        </div>
        <div className="income-team-closing-grid">
          {pendingCashTeamSummary.map((item) => (
            <article key={item.team} className={`income-team-card income-team-card--${item.team.toLowerCase()}${pendingFilters.team === item.team ? " income-team-card--active" : ""}`}>
              <button type="button" className="income-team-card-filter" aria-pressed={pendingFilters.team === item.team} onClick={() => filterPendingCashByTeam(item.team)}>
                <span className={`income-team-badge income-team-badge--${item.team.toLowerCase()}`}>EQUIPO {item.team}</span>
                <strong>{formatCurrency(item.total)}</strong>
                <small>{item.payments.length} recibo(s) pendientes · Ver recibos del equipo</small>
              </button>
              {!readOnly && item.payments.length > 0 ? <button type="button" className="income-team-deliver-all" disabled={!isPaymentHistoryLoaded} onClick={() => markTeamCashDelivered(item.team)}>Registrar entrega del equipo {item.team}</button> : null}
            </article>
          ))}
        </div>
          </section>
        </details>
        <section id="income-cash-pending" className="income-cash-list income-cash-list--pending" aria-label="Falta entregar">
          <header className="income-zone-heading"><div><h3><span aria-hidden="true">◷ </span>Falta entregar</h3><p>Efectivo pendiente hasta el {formatMoneyDay(dateKey)}.</p></div><strong>{formatCurrency(cashPendingRows.reduce((sum, payment) => sum + payment.amountReceived, 0))}<small>{cashPendingRows.length} recibo(s) en esta lista</small></strong></header>
          {renderCashFilters("pending")}
          {!readOnly && cashPendingRows.length > 0 && <div className="income-cash-selection" aria-label="Seleccionar recibos para entregar">
            <p>Marca los recibos cuyo efectivo ya recibiste. Puedes elegir varios o todos los de esta lista.</p>
            <div className="income-cash-selection-actions">
              <button type="button" className="button ghost small" onClick={() => setSelectedCashIds(allPendingSelected ? [] : cashPendingRows.map(payment => payment.id))}>{allPendingSelected ? "Quitar selección de todos" : "Seleccionar todos"}</button>
              <span role="status">{selectedCashRows.length} {selectedCashRows.length === 1 ? "recibo seleccionado" : "recibos seleccionados"} · {formatCurrency(selectedCashTotal)}</span>
              <button type="button" className="button primary small" disabled={selectedCashRows.length === 0} onClick={() => openDelivery(selectedCashRows)}>Registrar entrega de los seleccionados</button>
            </div>
          </div>}
          {cashPendingRows.length ? renderCashReceipts(cashPendingRows) : <p className="income-cash-empty">{pendingFilters.search || pendingFilters.team !== "all" ? "No hay recibos pendientes con estos filtros." : "No hay efectivo pendiente hasta el día elegido."}</p>}
        </section>
        </div>
        <div id="cash-status-panel-delivered" className="income-cash-status-panel" role="tabpanel" aria-labelledby="cash-status-tab-delivered" hidden={cashStatus !== "delivered"}>
        <section className="income-cash-list income-cash-list--delivered" aria-label="Ya entregado">
          <header className="income-zone-heading"><div><h3><span aria-hidden="true">✓ </span>Ya entregado</h3><p>Entregas del {formatMoneyDay(dateKey)}.</p></div><strong>{formatCurrency(cashDeliveredRows.reduce((sum, payment) => sum + payment.amountReceived, 0))}<small>{cashDeliveredRows.length} recibo(s) en esta lista</small></strong></header>
          {renderCashFilters("delivered")}
          {cashDeliveredRows.length ? renderCashReceipts(cashDeliveredRows) : <p className="income-cash-empty">{deliveredFilters.search || deliveredFilters.team !== "all" ? "No hay entregas con estos filtros." : "Todavía no hay entregas registradas para este día."}</p>}
        </section>
        </div>
      </>}
      {incomeView === "other" && <>
      <div className="income-day-kpis">
        <button type="button" className={statusFilter === "received" ? "income-day-kpi--active" : ""} aria-pressed={statusFilter === "received"} onClick={() => toggleStatusFilter("received")}><span>Total recibido · otros medios</span><strong>{formatCurrency(receivedTotal)}</strong><small>{receivedCount} pago(s) · Ver detalle</small></button>
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
          <div><h3>Entregados en esta fecha de días anteriores</h3><p>Se entregaron en la fecha seleccionada, pero se cobraron en la fecha indicada.</p></div>
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
              <td><span className="income-delivery-badge income-delivery-badge--yes">Entregado en esta fecha</span>{!readOnly && payment.paymentMethod === "Efectivo" && <button type="button" className="button ghost small" onClick={() => openDelivery([payment])}>Cambiar fecha de entrega</button>}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </section>}

      <div className="income-day-filters" aria-label="Filtros de ingresos">
        <label className="income-day-search">Buscar<input type="search" placeholder="Cliente, unidad, recibo o referencia" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        <label>Forma de pago<select value={methodFilter} onChange={(event) => setMethodFilter(event.target.value)}><option value="all">Todas</option>{PAYMENT_METHODS.filter(method => method !== "Efectivo").map((method) => <option key={method} value={method}>{method}</option>)}</select></label>
        <label>Cuenta o destino<select value={destinationFilter} onChange={(event) => setDestinationFilter(event.target.value)}><option value="all">Todos</option>{destinationOptions.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label>
        <label>Estado<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">Todos</option><option value="received">Recibido</option><option value="pending">Pendiente</option><option value="non_cash">Sin entrada de dinero</option></select></label>
        <label>Dinero entregado<select value={deliveryFilter} onChange={(event) => setDeliveryFilter(event.target.value)}><option value="all">Todos</option><option value="yes">Sí</option><option value="no">No</option></select></label>
        <label>Equipo<select value={teamFilter} onChange={(event) => { setTeamFilter(event.target.value as TeamFilter); setTeamDeliveryMessage(""); }}><option value="all">Todos</option><option value="PTY">PTY</option><option value="WC">WC</option><option value="unassigned">PAGADO EN CAJA</option></select></label>
        <button type="button" className="button ghost" onClick={clearFilters} disabled={!filtersActive}>Limpiar filtros</button>
      </div>

      {groups.length === 0 && pendingDeliveries.length === 0 && <div className="empty-state"><p>No hay movimientos para esta fecha y estos filtros.</p></div>}
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

      </>}
      </div>
      {deliveryIds.length > 0 && <div className="modal-overlay">
        <div className="modal income-edit-modal" role="dialog" aria-modal="true" aria-labelledby="cash-delivery-title">
          <div className="modal-header"><h2 id="cash-delivery-title">{isDeliveryCorrection ? "Cambiar fecha de entrega" : "Registrar entrega de efectivo"}</h2><button type="button" className="modal-close" aria-label="Cerrar entrega" onClick={() => setDeliveryIds([])}>×</button></div>
          <form className="modal-body income-edit-form" onSubmit={event => { event.preventDefault(); saveDelivery(); }}>
            <p>{deliveryPayments.length} recibo(s) · {formatCurrency(deliveryPayments.reduce((sum, payment) => sum + payment.amountReceived, 0))}</p>
            <p className="hint">Elige el día en que recibiste este dinero. Aparecerá como entregado en ese día.</p>
            <ul className="income-edit-audit">{deliveryPayments.map(payment => <li key={payment.id}>{payment.receiptNumber} · {payment.clientUnit} · Cobro: {getIncomeDate(payment)}{isMoneyDelivered(payment) ? ` · Entrega actual: ${getDailyIncomeReportDate(payment)}` : " · Pendiente"}</li>)}</ul>
            <label>Fecha de entrega<input autoFocus type="date" required min={deliveryPayments.map(getIncomeDate).sort().slice(-1)[0]} max={getBusinessDateKey()} value={deliveryDate} onChange={event => setDeliveryDate(event.target.value)} /></label>
            <label>{isDeliveryCorrection ? "Motivo de la corrección" : "Observación (opcional)"}<input required={isDeliveryCorrection} value={deliveryReason} onChange={event => setDeliveryReason(event.target.value)} /></label>
            {deliveryError && <p role="alert" className="hint error-text">{deliveryError}</p>}
            <div className="modal-actions"><button type="button" className="button ghost" onClick={() => setDeliveryIds([])}>Cancelar</button><button type="submit" className="button primary">Guardar entrega</button></div>
          </form>
        </div>
      </div>}
      {editingPayment && <div className="modal-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditingPayment(null); }}>
        <div className="modal income-edit-modal" role="dialog" aria-modal="true" aria-labelledby="income-edit-title">
          <div className="modal-header"><h2 id="income-edit-title">{markPendingAfterEdit ? "Asignar equipo y dejar pendiente" : isPendingCashWithoutTeam(editingPayment) ? "Asignar equipo" : "Editar ingreso"} · {editingPayment.receiptNumber}</h2><button type="button" className="modal-close" onClick={() => setEditingPayment(null)}>×</button></div>
          <div className="modal-body income-edit-form">
            {BANK_PAYMENT_METHODS.has(editingPayment.paymentMethod) || editingPayment.paymentMethod === "Tarjeta" ? <label>Cuenta receptora
              <select value={editAccount} onChange={(event) => setEditAccount(event.target.value)}>
                <option value="">Cuenta no identificada</option>
                {editAccount && !accountOptions.some((rule) => rule.accountNumber === editAccount) && <option value={editAccount}>Actual · {maskAccountNumber(editAccount)}</option>}
                {accountOptions.map((rule) => <option key={rule.id} value={rule.accountNumber}>{rule.accountName || "Cuenta bancaria"} · {maskAccountNumber(rule.accountNumber)} · Grupo {rule.groupCode}</option>)}
              </select>
            </label> : null}
            <label>Equipo{(markPendingAfterEdit || (editingPayment.paymentMethod === "Efectivo" && !isMoneyDelivered(editingPayment))) ? " (obligatorio)" : ""}
              <select required={markPendingAfterEdit || (editingPayment.paymentMethod === "Efectivo" && !isMoneyDelivered(editingPayment))} value={editTeam} onChange={(event) => setEditTeam(event.target.value as "" | CollectionTeam)}>
                <option value="">PAGADO EN CAJA — selecciona PTY o WC</option>
                <option value="PTY">PTY</option>
                <option value="WC">WC</option>
              </select>
            </label>
            <label>Comentario<textarea rows={3} value={editComment} onChange={(event) => setEditComment(event.target.value)} placeholder="Comentario opcional" /></label>
            {(editAccount.trim() !== (editingPayment.bankAccountNumber?.trim() ?? "") || editTeam !== (editingPayment.collectionTeam ?? "")) && <label>Motivo de la corrección<input value={editReason} onChange={(event) => setEditReason(event.target.value)} placeholder="Obligatorio al cambiar cuenta o equipo" /></label>}
            {editError && <p className="hint error-text">{editError}</p>}
            {(editingPayment.incomeEdits?.length ?? 0) > 0 && <details><summary>Historial de ediciones ({editingPayment.incomeEdits?.length})</summary><ul className="income-edit-audit">{[...(editingPayment.incomeEdits ?? [])].reverse().map((edit) => <li key={edit.id}><strong>{edit.actor}</strong> · {new Date(edit.createdAt).toLocaleString("es-PA")}{edit.reason ? ` · ${edit.reason}` : ""}{(edit.previousMoneyDeliveryDate || edit.nextMoneyDeliveryDate) && <small> · Entrega: {edit.previousMoneyDeliveryDate || "Pendiente"} → {edit.nextMoneyDeliveryDate || "Pendiente"}</small>}</li>)}</ul></details>}
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
