import { useEffect, useMemo, useRef, useState } from "react";
import RoutePendingCashPanel from "./RoutePendingCashPanel";
import RouteCollectionCard, { type RouteWorkflowView } from "./RouteCollectionCard";
import { PaymentPreviewDialog } from "./payments/PaymentDialogs";
import { changeRouteAssignment, cancelRoutePaymentReport, loadRoutePaymentReports, loadRouteReportReceipts, reportRoutePayment, setRouteCustody, type RoutePaymentReport } from "../cloud/routeReportCloudData";
import {
  ALL_ACTIVE_ROUTE_FILTER,
  activeRouteFilterLabel,
  activeRouteFilterValue,
  compareActiveRouteFilterValues,
  compareActiveRouteItems
} from "../activeRouteOrdering";
import { getBusinessDateKey } from "../billing";
import { buildCloudErrorMessage } from "../app/appShellRules";
import {
  loadCloudActiveRouteItems,
  keepCloudActiveRouteItemAfterPartialPayment,
  removeCloudActiveRouteItemFromSearch,
  saveCloudActiveRouteComment,
  saveCloudActiveRouteZone,
  type ActiveRouteItem
} from "../cloudData";
import { formatCurrency, formatDate } from "../format";
import { supabase } from "../lib/supabase";
import { getActiveRouteReviewItems, hasAcknowledgedPartialRouteDecision, hasPendingPartialRouteDecision, isPendingCashRouteReport, routeRentAmountForDay } from "../routeReviewRules";
import type { Client, CollectionTeam, Payment } from "../types";
import { loadNotifiedPayments, parseNotifiedPayments } from "./payments/paymentStorage";
import type { NotifiedPayment } from "./payments/paymentTypes";
import { fieldManagementLabel, type FieldManagementType } from "./receivables/receivablesTypes";

type Props = {
  paymentsLoading?: boolean;
  currentUserId?: string;
  canReportPayment?: boolean;
  dataOwnerUserId?: string | null;
  clients: Client[];
  payments: Payment[];
  readOnly?: boolean;
  canRemoveFromRoute?: boolean;
  onRegisterPayment?: (input: {
    clientId: string;
    amount: number;
    method: "cash" | "bank";
    team: CollectionTeam;
    fundsReceivedDate?: string;
  }) => Promise<{ kind: "cash" | "bank"; receiptNumber?: string; payment?: Payment }>;
};

const ALL_ACTIVE_ZONE_FILTER = "__all_zones__";
const EMPTY_ACTIVE_ZONE_FILTER = "__empty_zone__";

type ZoneOption = {
  value: string;
  label: string;
  count: number;
};

function normalizeZoneName(value: string | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

function activeZoneFilterValue(value: string | undefined): string {
  const normalized = normalizeZoneName(value);
  return normalized ? normalized.toLocaleLowerCase("es") : EMPTY_ACTIVE_ZONE_FILTER;
}

function toTimestamp(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function firstName(value: string): string {
  return value.trim().split(/\s+/)[0] || value;
}

function managementTone(value: FieldManagementType | undefined): "collect" | "remove" | "desist" | "seize" {
  if (value === "cobrar_o_quitar") return "remove";
  if (value === "desiste") return "desist";
  if (value === "quitar") return "seize";
  return "collect";
}

function formatPublishedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${formatDate(date)} ${date.toLocaleTimeString("es-PA", { hour: "numeric", minute: "2-digit" })}`;
}

function canvasToJpegBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }
      reject(new Error("No se pudo crear la imagen."));
    }, "image/jpeg", 0.94);
  });
}

function routeImageFileName(routeLabel: string, zoneLabel?: string): string {
  const date = new Date().toISOString().slice(0, 10);
  const route = `${routeLabel}${zoneLabel ? `-${zoneLabel}` : ""}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `cobro-en-ruta-${route || "sin-ruta"}-${date}.jpg`;
}

export default function RouteSearchPage({
  paymentsLoading = false,
  currentUserId,
  canReportPayment = false,
  dataOwnerUserId,
  clients,
  payments,
  readOnly = true,
  canRemoveFromRoute = false,
  onRegisterPayment
}: Props) {
  const businessDateKey = getBusinessDateKey();
  const [items, setItems] = useState<ActiveRouteItem[]>([]);
  const [reports, setReports] = useState<RoutePaymentReport[]>([]);
  const [workflowView, setWorkflowView] = useState<RouteWorkflowView>("work");
  const [reviewMethod, setReviewMethod] = useState<"cash" | "bank" | "mixed">("cash");
  const [custodyTarget, setCustodyTarget] = useState<ActiveRouteItem | null>(null);
  const [custodySaving, setCustodySaving] = useState(false);
  const [custodyError, setCustodyError] = useState("");
  const [receiptPreview, setReceiptPreview] = useState<Payment | null>(null);
  const [receiptOptions, setReceiptOptions] = useState<Payment[]>([]);
  const [receiptLoading, setReceiptLoading] = useState<string | null>(null);
  const [receiptError, setReceiptError] = useState("");
  const [completedCash, setCompletedCash] = useState<{ unit: string; amount: number; receipt: string; payment?: Payment } | null>(null);
  const [reportTarget, setReportTarget] = useState<ActiveRouteItem | null>(null);
  const [reportAmount, setReportAmount] = useState("");
  const [reportMethod, setReportMethod] = useState<"" | "cash" | "bank" | "mixed">("");
  const [reportCashAmount, setReportCashAmount] = useState("");
  const [reportBankAmount, setReportBankAmount] = useState("");
  const [reportSaving, setReportSaving] = useState(false);
  const [reportError, setReportError] = useState("");
  const [reportsError, setReportsError] = useState("");
  const [reportsReady, setReportsReady] = useState(false);

  async function reloadReports(): Promise<void> {
    if (!dataOwnerUserId) return;
    try {
      setReports(await loadRoutePaymentReports(dataOwnerUserId));
      setReportsError("");
      setReportsReady(true);
    } catch (cause) {
      setReportsReady(false);
      setReportsError(buildCloudErrorMessage("No se pudieron cargar los reportes de pago.", cause));
    }
  }

  async function submitReport(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const cashAmount = reportMethod === "mixed" ? Number(reportCashAmount) : reportMethod === "cash" ? Number(reportAmount) : 0;
    const bankAmount = reportMethod === "mixed" ? Number(reportBankAmount) : reportMethod === "bank" ? Number(reportAmount) : 0;
    const amount = cashAmount + bankAmount;
    if (!canReportPayment || !dataOwnerUserId || !reportTarget || reportSaving || !reportMethod) return;
    if (![cashAmount, bankAmount].every((part) => Number.isFinite(part) && part >= 0 && Math.abs(part * 100 - Math.round(part * 100)) < 0.00001)
      || amount <= 0 || amount > 9999999999.99 || (reportMethod === "mixed" && (cashAmount <= 0 || bankAmount <= 0))) {
      setReportError("Indica un monto mayor a cero, con hasta dos decimales.");
      return;
    }
    setReportSaving(true);
    setReportError("");
    try {
      await reportRoutePayment(dataOwnerUserId, reportTarget, cashAmount, bankAmount);
      setRouteActionMessage(`${reportTarget.unitId} pasó a En revisión.`);
      setReportTarget(null);
      await reloadReports();
    } catch (cause) {
      setReportError(buildCloudErrorMessage("No se pudo reportar el pago.", cause, { includeRawFallback: true }));
    } finally { setReportSaving(false); }
  }

  async function returnReport(report: RoutePaymentReport): Promise<void> {
    if (!canReportPayment || reportSaving) return;
    setReportSaving(true);
    try {
      await cancelRoutePaymentReport(report.id);
      setRouteActionMessage(`Reporte de ${report.snapshot.unitId} devuelto. La unidad aparecerá en Trabajo si sigue activa.`);
      await reloadReports();
    } catch (cause) {
      setReportsError(buildCloudErrorMessage("No se pudo devolver el reporte.", cause, { includeRawFallback: true }));
    } finally { setReportSaving(false); }
  }
  const [changingRoute, setChangingRoute] = useState<string | null>(null);
  const [changeRouteError, setChangeRouteError] = useState("");
  async function changeTeam(item: ActiveRouteItem, route: "WC" | "PTY"): Promise<void> {
    if (!canReportPayment || !dataOwnerUserId || changingRoute || route === item.routeAssignment) return;
    setChangingRoute(item.clientId);
    setChangeRouteError("");
    setRouteActionMessage("");
    try {
      await changeRouteAssignment(dataOwnerUserId, item, route);
      setItems(current => current.map(row => row.clientId === item.clientId && row.publishedAt === item.publishedAt
        ? { ...row, routeAssignment: route } : row));
      setRouteActionMessage(item.unitId + " cambió a " + route + ".");
    } catch (cause) {
      setChangeRouteError(buildCloudErrorMessage("No se pudo cambiar la ruta.", cause, { includeRawFallback: true }));
    } finally { setChangingRoute(null); }
  }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [routeFilter, setRouteFilter] = useState(ALL_ACTIVE_ROUTE_FILTER);
  const [zoneFilter, setZoneFilter] = useState(ALL_ACTIVE_ZONE_FILTER);
  const [zoneFilterLabel, setZoneFilterLabel] = useState("");
  const [zoneDrafts, setZoneDrafts] = useState<Record<string, string>>({});
  const [zoneSavingByClient, setZoneSavingByClient] = useState<Record<string, boolean>>({});
  const [zoneError, setZoneError] = useState("");
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [commentSavingByClient, setCommentSavingByClient] = useState<Record<string, boolean>>({});
  const [commentError, setCommentError] = useState("");
  const [removeTarget, setRemoveTarget] = useState<ActiveRouteItem | null>(null);
  const [removeSaving, setRemoveSaving] = useState(false);
  const [removeError, setRemoveError] = useState("");
  const [partialDecisionSavingByClient, setPartialDecisionSavingByClient] = useState<Record<string, boolean>>({});
  const [routeActionMessage, setRouteActionMessage] = useState("");
  const [lastRefreshAt, setLastRefreshAt] = useState("");
  const [sharing, setSharing] = useState(false);
  const [shareMessage, setShareMessage] = useState("");
  const [bankNotices, setBankNotices] = useState<NotifiedPayment[]>(() => loadNotifiedPayments());
  const [paymentTarget, setPaymentTarget] = useState<ActiveRouteItem | null>(null);
  const [paymentReport, setPaymentReport] = useState<RoutePaymentReport | null>(null);
  const [registeredReportIds, setRegisteredReportIds] = useState<string[]>([]);
  const paymentSubmitLock = useRef(false);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "bank">("cash");
  const [paymentTeam, setPaymentTeam] = useState<"" | CollectionTeam>("");
  const [paymentSaving, setPaymentSaving] = useState(false);
  const [paymentError, setPaymentError] = useState("");
  const [paymentMessage, setPaymentMessage] = useState("");
  const shareSheetRefs = useRef(new Map<string, HTMLDivElement>());

  const currentBalanceByClient = useMemo(
    () => new Map(clients.map((client) => [client.id, Math.max(0, client.balance)] as const)),
    [clients]
  );

  function currentBalance(item: ActiveRouteItem): number {
    return currentBalanceByClient.get(item.clientId) ?? item.overdueBalance;
  }

  async function reload(): Promise<void> {
    if (!dataOwnerUserId) {
      setItems([]);
      setLoading(false);
      setError("No hay dataset asignado para consultar la ruta.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const nextItems = await loadCloudActiveRouteItems(dataOwnerUserId);
      setItems(nextItems);
      setLastRefreshAt(new Date().toLocaleTimeString("es-PA", { hour: "numeric", minute: "2-digit" }));
    } catch (loadError) {
      console.error("No se pudo cargar la vista buscador.", loadError);
      setError("No se pudo cargar Cobro en Ruta.");
    } finally {
      setLoading(false);
    }
  }

  async function reloadBankNotices(): Promise<void> {
    if (!dataOwnerUserId || !supabase) {
      setBankNotices(loadNotifiedPayments());
      return;
    }
    const { data, error: noticesError } = await supabase
      .from("notified_payments_cloud")
      .select("data")
      .eq("user_id", dataOwnerUserId);
    if (noticesError) {
      console.warn("No se pudieron actualizar los pagos bancarios en hold.", noticesError);
      setBankNotices(loadNotifiedPayments());
      return;
    }
    setBankNotices(parseNotifiedPayments((data ?? []).map((row) => row.data)));
  }

  useEffect(() => {
    void reload();
    void reloadBankNotices();
    setReports([]);
    setReportsReady(false);
    void reloadReports();
  }, [dataOwnerUserId]);

  useEffect(() => {
    if (!dataOwnerUserId || !supabase) return;
    const client = supabase;
    const channel = client
      .channel(`route-search-${dataOwnerUserId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "route_payment_reports", filter: `user_id=eq.${dataOwnerUserId}` }, () => {
        void reloadReports();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "active_route_items_cloud", filter: `user_id=eq.${dataOwnerUserId}` }, () => {
        void reload();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "notified_payments_cloud", filter: `user_id=eq.${dataOwnerUserId}` }, () => {
        void reloadBankNotices();
      })
      .subscribe();
    return () => {
      void client.removeChannel(channel);
    };
  }, [dataOwnerUserId]);

  const workItems = useMemo(() => (
    items
      .filter((item) => !item.removedAt)
      .filter((item) => !item.inCustody)
      .filter((item) => !hasPendingPartialRouteDecision(payments, item, businessDateKey))
      .filter((item) => item.releaseAmount <= 0 || routeRentAmountForDay(payments, item, businessDateKey) < item.releaseAmount)
      .filter((item) => {
        const currentReports = reports.filter((report) => report.client_id === item.clientId && report.published_at === item.publishedAt);
        if (currentReports.some((report) => report.status === "review")) return false;
        return currentReports.length === 0 || hasAcknowledgedPartialRouteDecision(payments, item, businessDateKey);
      })
  ), [businessDateKey, items, payments, reports]);
  const custodyItems = useMemo(() => items.filter((item) => item.inCustody), [items]);

  const partialReviewItems = useMemo(() => (
    getActiveRouteReviewItems(items, payments, businessDateKey).map((item) => ({
      ...item,
      report: reports.find((report) => report.client_id === item.clientId && report.published_at === item.publishedAt)
    }))
  ), [items, payments, businessDateKey, reports]);

  const activeItems = useMemo<Array<ActiveRouteItem & { report?: RoutePaymentReport }>>(() => (
    workflowView === "work" ? workItems : workflowView === "custody" ? custodyItems : workflowView === "partial" ? partialReviewItems : reports.filter((report) => report.status === workflowView)
      .map((report) => ({ ...report.snapshot, inCustody: items.some((item) => item.clientId === report.client_id && item.publishedAt === report.published_at && item.inCustody), report }))
  ), [workflowView, workItems, partialReviewItems, reports, custodyItems, items]);
  const pendingCashCount = reports.filter(isPendingCashRouteReport).length;
  const reviewCounts = { cash: reports.filter((report) => report.status === "review" && report.method === "cash").length, bank: reports.filter((report) => report.status === "review" && report.method === "bank").length, mixed: reports.filter((report) => report.status === "review" && report.method === "mixed").length };

  function openWorkflow(view: RouteWorkflowView): void {
    setWorkflowView(view); setQuery(""); setCompletedCash(null); setRouteActionMessage("");
    if (view === "review") setReviewMethod(pendingCashCount > 0 ? "cash" : reviewCounts.bank > 0 ? "bank" : reviewCounts.mixed > 0 ? "mixed" : "cash");
    setRouteFilter(ALL_ACTIVE_ROUTE_FILTER); setZoneFilter(ALL_ACTIVE_ZONE_FILTER); setZoneFilterLabel("");
  }

  const bankNoticesByClient = useMemo(() => {
    const grouped = new Map<string, NotifiedPayment[]>();
    bankNotices.filter((notice) => notice.paymentMethod === "bank").forEach((notice) => {
      grouped.set(notice.clientId, [...(grouped.get(notice.clientId) ?? []), notice]);
    });
    return grouped;
  }, [bankNotices]);

  const routeFilterOptions = useMemo(() => (
    Array.from(new Set(activeItems.map((item) => activeRouteFilterValue(item.routeAssignment))))
      .sort(compareActiveRouteFilterValues)
  ), [activeItems]);

  const zoneOptionsByRoute = useMemo(() => {
    const byRoute = new Map<string, Map<string, ZoneOption>>();
    activeItems.forEach((item) => {
      const routeValue = activeRouteFilterValue(item.routeAssignment);
      const zoneValue = activeZoneFilterValue(item.zone);
      const routeZones = byRoute.get(routeValue) ?? new Map<string, ZoneOption>();
      const current = routeZones.get(zoneValue);
      routeZones.set(zoneValue, {
        value: zoneValue,
        label: zoneValue === EMPTY_ACTIVE_ZONE_FILTER ? "Sin zona" : (current?.label ?? normalizeZoneName(item.zone)),
        count: (current?.count ?? 0) + 1
      });
      byRoute.set(routeValue, routeZones);
    });
    return new Map(Array.from(byRoute.entries()).map(([routeValue, zones]) => [
      routeValue,
      Array.from(zones.values()).sort((left, right) => {
        if (left.value === EMPTY_ACTIVE_ZONE_FILTER) return -1;
        if (right.value === EMPTY_ACTIVE_ZONE_FILTER) return 1;
        return left.label.localeCompare(right.label, "es", { numeric: true, sensitivity: "base" });
      })
    ]));
  }, [activeItems]);

  const selectedRouteItems = useMemo(() => (
    routeFilter === ALL_ACTIVE_ROUTE_FILTER
      ? []
      : activeItems.filter((item) => activeRouteFilterValue(item.routeAssignment) === routeFilter)
  ), [activeItems, routeFilter]);

  const zoneFilterOptions = useMemo(() => {
    if (routeFilter === ALL_ACTIVE_ROUTE_FILTER) return [];
    let options = zoneOptionsByRoute.get(routeFilter) ?? [];
    options = options.some((option) => option.value === EMPTY_ACTIVE_ZONE_FILTER)
      ? options
      : [{ value: EMPTY_ACTIVE_ZONE_FILTER, label: "Sin zona", count: 0 }, ...options];
    if (zoneFilter !== ALL_ACTIVE_ZONE_FILTER && !options.some((option) => option.value === zoneFilter)) {
      options = [...options, { value: zoneFilter, label: zoneFilterLabel || zoneFilter, count: 0 }];
    }
    return options;
  }, [routeFilter, zoneFilter, zoneFilterLabel, zoneOptionsByRoute]);

  useEffect(() => {
    if (routeFilter !== ALL_ACTIVE_ROUTE_FILTER && !routeFilterOptions.includes(routeFilter)) {
      setRouteFilter(ALL_ACTIVE_ROUTE_FILTER);
    }
  }, [routeFilter, routeFilterOptions]);

  useEffect(() => {
    if (routeFilter === ALL_ACTIVE_ROUTE_FILTER) {
      setZoneFilter(ALL_ACTIVE_ZONE_FILTER);
      setZoneFilterLabel("");
    }
  }, [routeFilter]);

  const visibleItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return activeItems
      .filter((item) => workflowView !== "review" || item.report?.method === reviewMethod)
      .filter((item) => routeFilter === ALL_ACTIVE_ROUTE_FILTER || activeRouteFilterValue(item.routeAssignment) === routeFilter)
      .filter((item) => zoneFilter === ALL_ACTIVE_ZONE_FILTER || activeZoneFilterValue(item.zone) === zoneFilter)
      .filter((item) => {
        if (!normalizedQuery) return true;
        return [
          item.unitId,
          item.clientName,
          item.clientCedula ?? "",
          item.whatsAppPhone ?? "",
          item.routeAssignment ?? "",
          item.zone ?? "",
          item.comment ?? ""
        ].some((value) => value.toLowerCase().includes(normalizedQuery));
      })
      .sort((left, right) => (workflowView === "review" ? Number(isPendingCashRouteReport(right.report)) - Number(isPendingCashRouteReport(left.report)) : 0) || compareActiveRouteItems(left, right));
  }, [activeItems, query, routeFilter, zoneFilter, workflowView, reviewMethod]);

  const selectedZoneLabel = useMemo(() => {
    if (zoneFilter === ALL_ACTIVE_ZONE_FILTER) return "";
    return zoneFilterOptions.find((option) => option.value === zoneFilter)?.label ?? zoneFilterLabel;
  }, [zoneFilter, zoneFilterLabel, zoneFilterOptions]);

  const publishedAt = useMemo(() => {
    const timestamps = items.map((item) => toTimestamp(item.publishedAt)).filter((value) => value > 0);
    if (timestamps.length === 0) return "";
    return formatPublishedAt(new Date(Math.max(...timestamps)).toISOString());
  }, [items]);

  const visibleRouteGroups = useMemo(() => {
    const groups = new Map<string, ActiveRouteItem[]>();
    visibleItems.filter((item) => !item.report).forEach((item) => {
      const routeValue = activeRouteFilterValue(item.routeAssignment);
      const current = groups.get(routeValue) ?? [];
      current.push(item);
      groups.set(routeValue, current);
    });
    return Array.from(groups.entries())
      .sort(([left], [right]) => compareActiveRouteFilterValues(left, right))
      .map(([routeValue, routeItems]) => ({
        routeValue,
        routeLabel: activeRouteFilterLabel(routeValue),
        zoneLabel: selectedZoneLabel,
        items: routeItems
      }));
  }, [selectedZoneLabel, visibleItems]);

  async function commitZone(item: ActiveRouteItem): Promise<void> {
    const draft = zoneDrafts[item.clientId];
    if (draft === undefined || zoneSavingByClient[item.clientId] || !dataOwnerUserId) return;
    const normalizedDraft = normalizeZoneName(draft);
    const routeZones = zoneOptionsByRoute.get(activeRouteFilterValue(item.routeAssignment)) ?? [];
    const matchingZone = routeZones.find((option) => (
      option.value !== EMPTY_ACTIVE_ZONE_FILTER && option.value === activeZoneFilterValue(normalizedDraft)
    ));
    const nextZone = normalizedDraft ? (matchingZone?.label ?? normalizedDraft) : undefined;
    const previousZone = item.zone;
    setZoneDrafts((current) => {
      const next = { ...current };
      delete next[item.clientId];
      return next;
    });
    if (activeZoneFilterValue(previousZone) === activeZoneFilterValue(nextZone)) return;

    setZoneError("");
    setZoneSavingByClient((current) => ({ ...current, [item.clientId]: true }));
    setItems((current) => current.map((currentItem) => (
      currentItem.clientId === item.clientId ? { ...currentItem, zone: nextZone } : currentItem
    )));
    try {
      await saveCloudActiveRouteZone({
        userId: dataOwnerUserId,
        clientId: item.clientId,
        routeAssignment: item.routeAssignment,
        zone: nextZone
      });
    } catch (saveError) {
      console.error("No se pudo guardar la zona de Ruta en calle.", saveError);
      setItems((current) => current.map((currentItem) => (
        currentItem.clientId === item.clientId ? { ...currentItem, zone: previousZone } : currentItem
      )));
      setZoneError("No se pudo guardar la zona. Se restauro el valor anterior.");
      void reload();
    } finally {
      setZoneSavingByClient((current) => ({ ...current, [item.clientId]: false }));
    }
  }

  async function commitComment(item: ActiveRouteItem): Promise<void> {
    const draft = commentDrafts[item.clientId];
    if (draft === undefined || commentSavingByClient[item.clientId] || !dataOwnerUserId || readOnly) return;
    const nextComment = draft.trim().slice(0, 25);
    const previousComment = item.comment;
    setCommentDrafts((current) => {
      const next = { ...current };
      delete next[item.clientId];
      return next;
    });
    if ((previousComment ?? "") === nextComment) return;

    setCommentError("");
    setCommentSavingByClient((current) => ({ ...current, [item.clientId]: true }));
    setItems((current) => current.map((currentItem) => (
      currentItem.clientId === item.clientId ? { ...currentItem, comment: nextComment || undefined } : currentItem
    )));
    try {
      await saveCloudActiveRouteComment({
        userId: dataOwnerUserId,
        clientId: item.clientId,
        comment: nextComment || undefined
      });
    } catch (saveError) {
      console.error("No se pudo guardar el comentario de Ruta en calle.", saveError);
      setItems((current) => current.map((currentItem) => (
        currentItem.clientId === item.clientId ? { ...currentItem, comment: previousComment } : currentItem
      )));
      setCommentError("No se pudo guardar el comentario. Se restauro el valor anterior.");
      void reload();
    } finally {
      setCommentSavingByClient((current) => ({ ...current, [item.clientId]: false }));
    }
  }

  async function confirmRemoveFromRoute(): Promise<void> {
    if (!removeTarget || !dataOwnerUserId || !canRemoveFromRoute || removeSaving) return;
    setRemoveSaving(true);
    setRemoveError("");
    try {
      await removeCloudActiveRouteItemFromSearch({
        userId: dataOwnerUserId,
        clientId: removeTarget.clientId
      });
      const removedAt = new Date().toISOString();
      setItems((current) => current.map((item) => (
        item.clientId === removeTarget.clientId
          ? { ...item, removedAt, removedReason: "route_editor_removed" }
          : item
      )));
      setRouteActionMessage(`${removeTarget.unitId} fue retirada de Ruta en calle.`);
      setRemoveTarget(null);
    } catch (saveError) {
      console.error("No se pudo sacar la unidad de Ruta en calle.", saveError);
      setRemoveError(buildCloudErrorMessage("No se pudo sacar la unidad de la ruta.", saveError, { includeRawFallback: true }));
    } finally {
      setRemoveSaving(false);
    }
  }

  async function keepInRouteAfterPartialPayment(item: ActiveRouteItem, confirmedRentAmount: number): Promise<void> {
    if (!dataOwnerUserId || !canRemoveFromRoute || partialDecisionSavingByClient[item.clientId]) return;
    setPartialDecisionSavingByClient((current) => ({ ...current, [item.clientId]: true }));
    setError("");
    try {
      await keepCloudActiveRouteItemAfterPartialPayment({
        userId: dataOwnerUserId,
        clientId: item.clientId,
        confirmedRentAmount
      });
      const partialDecisionAt = new Date().toISOString();
      setItems((current) => current.map((currentItem) => (
        currentItem.clientId === item.clientId
          ? { ...currentItem, partialDecisionRentAmount: confirmedRentAmount, partialDecisionAt }
          : currentItem
      )));
      setRouteActionMessage(`${item.unitId} quedó marcada: Debe pagar más.`);
    } catch (saveError) {
      console.error("No se pudo guardar la decision del pago parcial.", saveError);
      setError(buildCloudErrorMessage("No se pudo guardar la decision.", saveError, { includeRawFallback: true }));
    } finally {
      setPartialDecisionSavingByClient((current) => ({ ...current, [item.clientId]: false }));
    }
  }

  function openPaymentDialog(item: ActiveRouteItem, report?: RoutePaymentReport): void {
    setPaymentTarget(item);
    setPaymentReport(report ?? null);
    setPaymentAmount(report ? String(report.amount) : item.releaseAmount > 0 ? String(item.releaseAmount) : "");
    setPaymentMethod("cash");
    setPaymentTeam("");
    setPaymentError("");
  }

  async function submitRoutePayment(): Promise<void> {
    if (!paymentTarget || !onRegisterPayment || readOnly || paymentSubmitLock.current) return;
    const amount = Number.parseFloat(paymentAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setPaymentError("Indica un monto mayor a cero.");
      return;
    }
    if (!paymentTeam) {
      setPaymentError("Selecciona el equipo PTY o WC.");
      return;
    }
    paymentSubmitLock.current = true;
    setPaymentSaving(true);
    setPaymentError("");
    try {
      if (paymentReport) {
        if (!dataOwnerUserId || registeredReportIds.includes(paymentReport.id)) throw new Error("Este reporte ya fue registrado. Actualiza la ruta.");
        const latestReports = await loadRoutePaymentReports(dataOwnerUserId);
        setReports(latestReports);
        const latest = latestReports.find((report) => report.id === paymentReport.id);
        if (!latest || latest.status !== "review" || latest.method !== "cash" || latest.confirmed_cash_amount > 0
          || latest.amount !== amount || paymentMethod !== "cash") {
          throw new Error("El reporte cambió o ya fue confirmado. Cierra esta ventana y actualiza la ruta.");
        }
      }
      const result = await onRegisterPayment({
        clientId: paymentTarget.clientId,
        amount,
        method: paymentMethod,
        team: paymentTeam,
        ...(paymentReport ? { fundsReceivedDate: getBusinessDateKey(new Date(paymentReport.reported_at)) } : {})
      });
      if (result.kind === "bank") {
        setBankNotices(loadNotifiedPayments());
        setPaymentMessage(`Pago bancario de ${formatCurrency(amount)} en hold · Equipo ${paymentTeam}.`);
      } else {
        setPaymentMessage(`Pago en efectivo registrado en ${result.receiptNumber ?? "recibo"} · pendiente de entrega.`);
        setCompletedCash({ unit: paymentTarget.unitId, amount, receipt: result.receiptNumber ?? "Recibo", payment: result.payment });
        if (paymentReport) setRegisteredReportIds((current) => [...current, paymentReport.id]);
      }
      setPaymentTarget(null);
      if (paymentReport) await reloadReports();
    } catch (saveError) {
      console.error("No se pudo registrar el pago desde Ruta en calle.", saveError);
      setPaymentError(buildCloudErrorMessage("No se pudo registrar el pago.", saveError, { includeRawFallback: true }));
    } finally {
      paymentSubmitLock.current = false;
      setPaymentSaving(false);
    }
  }

  async function changeCustody(): Promise<void> {
    if (!custodyTarget || !dataOwnerUserId || !canReportPayment || custodySaving) return;
    setCustodySaving(true); setCustodyError("");
    try {
      await setRouteCustody(dataOwnerUserId, custodyTarget, !custodyTarget.inCustody);
      setRouteActionMessage(custodyTarget.inCustody ? `${custodyTarget.unitId} salió de custodia. Aparecerá en Trabajo si tiene cobros pendientes y no está en revisión.` : `${custodyTarget.unitId} pasó a Vehículo en custodia.`);
      setCustodyTarget(null);
      await reload();
    } catch (cause) { setCustodyError(buildCloudErrorMessage("No se pudo cambiar la custodia.", cause, { includeRawFallback: true })); }
    finally { setCustodySaving(false); }
  }

  async function openReportReceipt(report: RoutePaymentReport): Promise<void> {
    if (!dataOwnerUserId || receiptLoading) return;
    setReceiptLoading(report.id); setReceiptError("");
    try {
      const cached = payments.find(payment => payment.id === report.confirmed_payment_id);
      const receipts = cached ? [cached] : await loadRouteReportReceipts(dataOwnerUserId, report);
      if (!receipts.length) throw new Error("No se encontró un recibo asociado a este reporte.");
      if (receipts.length === 1) setReceiptPreview(receipts[0]);
      else setReceiptOptions(receipts);
    } catch (cause) { setReceiptError(buildCloudErrorMessage("No se pudo abrir el recibo.", cause, { includeRawFallback: true })); }
    finally { setReceiptLoading(null); }
  }

  async function nextPendingCash(): Promise<void> {
    if (!dataOwnerUserId || receiptLoading || paymentSaving) return;
    setReceiptLoading("next"); setReceiptError("");
    try {
      const latest = await loadRoutePaymentReports(dataOwnerUserId);
      setReports(latest);
      const next = latest.find(report => isPendingCashRouteReport(report) && !registeredReportIds.includes(report.id));
      openWorkflow("review"); setReviewMethod("cash");
      if (next) openPaymentDialog(next.snapshot, next);
      else setRouteActionMessage("No quedan pagos en efectivo pendientes de recibo.");
    } catch (cause) { setReceiptError(buildCloudErrorMessage("No se pudieron cargar los pendientes.", cause)); }
    finally { setReceiptLoading(null); }
  }

  async function shareRouteImage(): Promise<void> {
    if (visibleRouteGroups.length === 0 || sharing) return;
    setSharing(true);
    setShareMessage("");
    try {
      if (document.fonts?.ready) await document.fonts.ready;
      const { default: html2canvas } = await import("html2canvas");
      const generatedImages: Array<{ blob: Blob; file: File }> = [];
      for (const group of visibleRouteGroups) {
        const shareSheet = shareSheetRefs.current.get(group.routeValue);
        if (!shareSheet) throw new Error(`No se encontro la hoja de ${group.routeLabel}.`);
        const canvas = await html2canvas(shareSheet, {
          backgroundColor: "#f4f7fb",
          scale: 1.5,
          useCORS: true,
          logging: false
        });
        const blob = await canvasToJpegBlob(canvas);
        const fileName = routeImageFileName(group.routeLabel, group.zoneLabel);
        generatedImages.push({ blob, file: new File([blob], fileName, { type: "image/jpeg" }) });
      }
      const files = generatedImages.map(({ file }) => file);
      const caption = visibleRouteGroups
        .map((group) => `Ruta ${group.routeLabel}${group.zoneLabel ? ` · Zona ${group.zoneLabel}` : ""} · ${group.items.length} cliente${group.items.length === 1 ? "" : "s"}`)
        .join("\n");
      const shareData: ShareData = {
        title: "Cobro en Ruta",
        text: caption,
        files
      };

      if (typeof navigator.share === "function" && (!navigator.canShare || navigator.canShare({ files }))) {
        try {
          await navigator.share(shareData);
          setShareMessage(`${files.length === 1 ? "Imagen compartida" : `${files.length} imagenes compartidas`} por ruta.`);
          return;
        } catch (shareError) {
          if (shareError instanceof DOMException && shareError.name === "AbortError") return;
          console.warn("No se pudo abrir el menu de compartir; se descargara la imagen.", shareError);
        }
      }

      generatedImages.forEach(({ blob, file }, index) => {
        const url = URL.createObjectURL(blob);
        window.setTimeout(() => {
          const anchor = document.createElement("a");
          anchor.href = url;
          anchor.download = file.name;
          document.body.appendChild(anchor);
          anchor.click();
          anchor.remove();
          window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
        }, index * 150);
      });
      let captionCopied = false;
      try {
        await navigator.clipboard.writeText(caption);
        captionCopied = true;
      } catch (clipboardError) {
        console.warn("No se pudo copiar la leyenda de las rutas.", clipboardError);
      }
      setShareMessage(
        `${files.length === 1 ? "Imagen descargada" : `${files.length} imagenes descargadas`}.` +
        (captionCopied ? " La leyenda quedo copiada para pegarla en WhatsApp." : " Ya puedes enviarlas por WhatsApp.")
      );
    } catch (shareError) {
      console.error("No se pudo generar la imagen de Cobro en Ruta.", shareError);
      setShareMessage("No se pudo generar la imagen. Intenta nuevamente.");
    } finally {
      setSharing(false);
    }
  }

  return (
    <section className="route-search-page route-search-page--compact">
      <header className="route-search-header">
        <div>
          <h1>Cobro en Ruta</h1>
          <p>{visibleItems.length} unidades · {workflowView === "work" ? "Trabajo" : workflowView === "review" ? "En revisión" : workflowView === "partial" ? "Pagos parciales a revisar" : workflowView === "custody" ? "Vehículo en custodia" : "Pagos confirmados"}{publishedAt ? ` | Publicada ${publishedAt}` : ""}</p>
        </div>
        <div className="route-search-header-actions">
          {workflowView === "work" ? <button
            type="button"
            className="button primary small route-search-share-button"
            onClick={() => void shareRouteImage()}
            disabled={loading || sharing || visibleItems.length === 0}
          >
            {sharing ? "Creando fotos..." : "Compartir por ruta"}
          </button> : null}
          <button type="button" className="button ghost small" onClick={() => { void reload(); void reloadReports(); void reloadBankNotices(); }} disabled={loading || sharing}>
            {loading ? "Actualizando..." : "Actualizar"}
          </button>
        </div>
      </header>

      <details className="route-collection-cash-summary"><summary>Efectivo pendiente de entrega</summary><RoutePendingCashPanel payments={payments} dateKey={businessDateKey} loading={paymentsLoading} /></details>
      <div className="route-search-workflow-tabs" aria-label="Estado de las unidades">
        {([['work', 'Trabajo', workItems.length], ['review', 'En revisión', reports.filter((r) => r.status === 'review').length], ['partial', 'Pagos parciales a revisar', partialReviewItems.length], ['confirmed', 'Pagos confirmados', reports.filter((r) => r.status === 'confirmed').length], ['custody', 'Vehículo en custodia', custodyItems.length]] as const).map(([view, label, count]) => (
          <button type="button" key={view} className={`button ${workflowView === view ? 'primary' : 'ghost'}`} aria-pressed={workflowView === view}
            onClick={() => openWorkflow(view)}>
            {label} ({count})
          </button>
        ))}
      </div>
      {workflowView === "review" ? <div className="route-search-filters route-collection-methods" aria-label="Filtrar pagos en revisión">
        {([["cash", "Efectivo pendiente"], ["bank", "Banca"], ["mixed", "Mixtos"]] as const).map(([method, label]) => <button key={method} type="button" className={reviewMethod === method ? "is-active" : ""} aria-pressed={reviewMethod === method} onClick={() => { setReviewMethod(method); setQuery(""); }}>{label} ({reviewCounts[method]})</button>)}
      </div> : null}
      {reportsError ? <p className="error-text" role="alert">{reportsError}</p> : null}

      <label className="route-search-box">
        <span>Buscar</span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Unidad, cliente, cedula, telefono o zona..."
          autoComplete="off"
        />
      </label>

      {completedCash ? <div className="route-collection-success" role="status">
        <div><strong>Recibo generado · {completedCash.unit}</strong><p>{formatCurrency(completedCash.amount)} · {completedCash.receipt}</p></div>
        {completedCash.payment ? <button type="button" className="button ghost" onClick={() => setReceiptPreview(completedCash.payment!)}>Ver recibo</button> : null}
        <button type="button" className="button primary" disabled={receiptLoading !== null} onClick={() => void nextPendingCash()}>Siguiente pendiente</button>
      </div> : null}
      {receiptError ? <p className="error-text" role="alert">{receiptError}</p> : null}
      {lastRefreshAt ? <p className="route-search-refresh">Ultima actualizacion: {lastRefreshAt}</p> : null}
      {error ? <p className="error-text">{error}</p> : null}
      {changeRouteError ? <p className="error-text" role="alert">{changeRouteError}</p> : null}
      {zoneError ? <p className="error-text" role="alert">{zoneError}</p> : null}
      {commentError ? <p className="error-text" role="alert">{commentError}</p> : null}
      {shareMessage ? <p className="route-search-share-message" role="status">{shareMessage}</p> : null}
      {paymentMessage ? <p className="route-search-payment-message" role="status">{paymentMessage}</p> : null}
      {routeActionMessage ? <p className="route-search-action-message" role="status">{routeActionMessage}</p> : null}
      <details className="route-collection-filters"><summary>Filtrar por ruta y zona{routeFilter !== ALL_ACTIVE_ROUTE_FILTER ? ' · ' + activeRouteFilterLabel(routeFilter) + (zoneFilterLabel ? ' · ' + zoneFilterLabel : '') : ''}</summary>
      {routeFilterOptions.length > 0 ? (
        <div className="route-search-filter-block">
          <span className="route-search-filter-label">Ruta</span>
          <div className="route-search-filters" aria-label="Filtrar por ruta">
            <button
              type="button"
              className={routeFilter === ALL_ACTIVE_ROUTE_FILTER ? "is-active" : ""}
              onClick={() => {
                setRouteFilter(ALL_ACTIVE_ROUTE_FILTER);
                setZoneFilter(ALL_ACTIVE_ZONE_FILTER);
                setZoneFilterLabel("");
              }}
            >
              Todas
            </button>
            {routeFilterOptions.map((option) => (
              <button
                key={option}
                type="button"
                className={routeFilter === option ? "is-active" : ""}
                onClick={() => {
                  setRouteFilter(option);
                  setZoneFilter(ALL_ACTIVE_ZONE_FILTER);
                  setZoneFilterLabel("");
                }}
              >
                {activeRouteFilterLabel(option)}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {routeFilter !== ALL_ACTIVE_ROUTE_FILTER ? (
        <div className="route-search-filter-block route-search-zone-filter-block">
          <span className="route-search-filter-label">Zona</span>
          <div className="route-search-filters route-search-zone-filters" aria-label="Filtrar por zona">
            <button
              type="button"
              className={zoneFilter === ALL_ACTIVE_ZONE_FILTER ? "is-active" : ""}
              onClick={() => {
                setZoneFilter(ALL_ACTIVE_ZONE_FILTER);
                setZoneFilterLabel("");
              }}
            >
              Todas ({selectedRouteItems.length})
            </button>
            {zoneFilterOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className={zoneFilter === option.value ? "is-active" : ""}
                onClick={() => {
                  setZoneFilter(option.value);
                  setZoneFilterLabel(option.label);
                }}
              >
                {option.label} ({option.count})
              </button>
            ))}
          </div>
        </div>
      ) : null}

      </details>
      {loading && visibleItems.length === 0 ? (
        <div className="route-search-empty">Cargando ruta...</div>
      ) : visibleItems.length === 0 ? (
        <div className="route-search-empty">{workflowView === "work" ? "No hay unidades pendientes con estos filtros." : workflowView === "review" ? "No hay pagos reportados pendientes de confirmar con estos filtros." : workflowView === "partial" ? "No hay pagos parciales pendientes de decisión con estos filtros." : workflowView === "custody" ? "No hay vehículos en custodia con estos filtros." : "No hay pagos confirmados con estos filtros."}</div>
      ) : (
        <div className="route-search-list">
          {visibleItems.map((item) => {
            const activeRoute = items.find(active => active.clientId === item.clientId && active.publishedAt === item.publishedAt);
            const paidRent = routeRentAmountForDay(payments, item, businessDateKey);
            return <RouteCollectionCard key={workflowView + '-' + (item.report?.id ?? item.clientId)} item={item} view={workflowView}
              paidRent={paidRent} balance={currentBalance(item)} canReport={canReportPayment} canEdit={!readOnly}
              canRemove={canRemoveFromRoute} canRegister={!readOnly && Boolean(onRegisterPayment) && (!item.report || (isPendingCashRouteReport(item.report) && !registeredReportIds.includes(item.report.id)))}
              hasPendingReport={reports.some(report => report.status === "review" && report.client_id === item.clientId && report.published_at === item.publishedAt)}
              hasActiveRoute={Boolean(activeRoute && !activeRoute.removedAt)} reportDisabled={!reportsReady}
              saving={reportSaving || paymentSaving || custodySaving || Boolean(partialDecisionSavingByClient[item.clientId]) || removeSaving}
              receiptLoading={receiptLoading === item.report?.id}
              zone={zoneDrafts[item.clientId] ?? item.zone ?? ""} zoneSaving={Boolean(zoneSavingByClient[item.clientId]) || !dataOwnerUserId}
              zoneOptions={(zoneOptionsByRoute.get(activeRouteFilterValue(item.routeAssignment)) ?? []).filter(option => option.value !== EMPTY_ACTIVE_ZONE_FILTER).map(option => option.label)}
              comment={commentDrafts[item.clientId] ?? item.comment ?? ""} commentSaving={Boolean(commentSavingByClient[item.clientId]) || !dataOwnerUserId}
              changingRoute={changingRoute !== null}
              canReturnReport={Boolean(item.report?.status === "review" && canReportPayment && (item.report.reported_by === currentUserId || canRemoveFromRoute))}
              bankNotices={!item.report ? bankNoticesByClient.get(item.clientId) ?? [] : []}
              onReport={() => { setReportTarget(item); setReportAmount(""); setReportMethod(""); setReportCashAmount(""); setReportBankAmount(""); setReportError(""); }}
              onRegister={() => openPaymentDialog(item, item.report)}
              onReceipt={() => { if (item.report) void openReportReceipt(item.report); }}
              onCustody={() => { if (activeRoute) { setCustodyTarget(activeRoute); setCustodyError(""); } }}
              onRemove={() => { setRemoveTarget(item); setRemoveError(""); }}
              onKeep={() => void keepInRouteAfterPartialPayment(item, paidRent)}
              onReturnReport={() => { if (item.report) void returnReport(item.report); }}
              onZone={value => { setZoneError(""); setZoneDrafts(current => ({ ...current, [item.clientId]: value })); }} onSaveZone={() => void commitZone(item)}
              onComment={value => { setCommentError(""); setCommentDrafts(current => ({ ...current, [item.clientId]: value.slice(0, 25) })); }} onSaveComment={() => void commitComment(item)}
              onRoute={route => void changeTeam(item, route)} />;
          })}
        </div>
      )}

      <PaymentPreviewDialog payment={receiptPreview} onClose={() => setReceiptPreview(null)} />
      {receiptOptions.length > 0 ? <div className="modal-overlay route-search-payment-overlay"><div className="modal route-search-payment-modal" role="dialog" aria-modal="true" aria-label="Recibos del pago">
        <h2>Recibos del pago</h2><p>Este reporte tiene más de un recibo asociado.</p>
        {receiptOptions.map(payment => <button className="button ghost" type="button" key={payment.id} onClick={() => { setReceiptOptions([]); setReceiptPreview(payment); }}>{payment.receiptNumber}</button>)}
        <button type="button" className="button ghost" onClick={() => setReceiptOptions([])}>Cerrar</button>
      </div></div> : null}
      {custodyTarget ? <div className="modal-overlay route-search-payment-overlay"><div className="modal route-search-payment-modal" role="dialog" aria-modal="true" aria-labelledby="route-custody-title">
        <h2 id="route-custody-title">{custodyTarget.inCustody ? "Sacar de custodia" : "Vehículo en custodia"}</h2>
        <p>{custodyTarget.unitId} · {custodyTarget.clientName}</p>
        <p>{custodyTarget.inCustody ? "La unidad volverá a Trabajo si tiene cobros pendientes y no está en revisión." : "La unidad saldrá de Trabajo y quedará en la lista de custodia."} Se conservan los pagos y el historial. Los saldos y los cobros automáticos siguen igual.</p>
        {custodyError ? <p className="error-text" role="alert">{custodyError}</p> : null}
        <div className="modal-actions"><button type="button" className="button ghost" disabled={custodySaving} onClick={() => setCustodyTarget(null)}>Cancelar</button><button type="button" className="button primary" disabled={custodySaving} onClick={() => void changeCustody()}>{custodySaving ? "Guardando…" : "Confirmar"}</button></div>
      </div></div> : null}
      {reportTarget ? (
        <div className="modal-overlay route-search-payment-overlay">
          <form className="modal route-search-payment-modal" role="dialog" aria-modal="true" aria-labelledby="route-report-title" onSubmit={(event) => void submitReport(event)}>
            <div className="modal-header"><div><h2 id="route-report-title">Reportar pago</h2><p>{reportTarget.unitId} · {reportTarget.clientName}</p></div></div>
            <div className="route-search-payment-form">
              <label><span>Cómo pagó</span><select value={reportMethod} onChange={(event) => setReportMethod(event.target.value as "" | "cash" | "bank" | "mixed")} required autoFocus disabled={reportSaving}>
                <option value="">Seleccionar</option><option value="cash">Efectivo</option><option value="bank">Banca</option><option value="mixed">Mixto (efectivo + banca)</option>
              </select></label>
              {reportMethod === "mixed" ? <>
                <label><span>Cuánto en efectivo ($)</span><input type="number" min="0.01" max="9999999999.99" step="0.01" inputMode="decimal" value={reportCashAmount} onChange={(event) => setReportCashAmount(event.target.value)} required disabled={reportSaving} /></label>
                <label><span>Cuánto por banca ($)</span><input type="number" min="0.01" max="9999999999.99" step="0.01" inputMode="decimal" value={reportBankAmount} onChange={(event) => setReportBankAmount(event.target.value)} required disabled={reportSaving} /></label>
                <strong aria-live="polite">Total reportado: {formatCurrency((Number(reportCashAmount) || 0) + (Number(reportBankAmount) || 0))}</strong>
              </> : <label><span>Cuánto pagó ($)</span><input type="number" min="0.01" max="9999999999.99" step="0.01" inputMode="decimal" value={reportAmount} onChange={(event) => setReportAmount(event.target.value)} required disabled={reportSaving} /></label>}
              <p className="hint">Se moverá a En revisión. El saldo cambia cuando se aplique el pago.</p>
              {reportError ? <p className="error-text" role="alert">{reportError}</p> : null}
            </div>
            <div className="modal-actions"><button type="button" className="button ghost" disabled={reportSaving} onClick={() => setReportTarget(null)}>Cancelar</button><button type="submit" className="button primary" disabled={reportSaving}>{reportSaving ? "Enviando..." : "Enviar a revisión"}</button></div>
          </form>
        </div>
      ) : null}
      {paymentTarget ? (
        <div className="modal-overlay route-search-payment-overlay" onMouseDown={() => !paymentSaving && setPaymentTarget(null)}>
          <div className="modal route-search-payment-modal" role="dialog" aria-modal="true" aria-labelledby="route-payment-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2 id="route-payment-title">Registrar pago</h2>
                <p>{paymentTarget.unitId} · {paymentTarget.clientName}</p>
              </div>
              <button type="button" className="button ghost small" onClick={() => setPaymentTarget(null)} disabled={paymentSaving}>Cerrar</button>
            </div>
            <div className="route-search-payment-form">
              <label>
                <span>Monto pagado</span>
                <input type="number" min="0.01" step="0.01" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} readOnly={Boolean(paymentReport)} disabled={paymentSaving} autoFocus />
              </label>
              <label>
                <span>Cómo pagó</span>
                <select value={paymentMethod} disabled={Boolean(paymentReport) || paymentSaving} onChange={(event) => setPaymentMethod(event.target.value as "cash" | "bank")}>
                  <option value="cash">Efectivo</option>
                  <option value="bank">Banca</option>
                </select>
              </label>
              <label>
                <span>Equipo</span>
                <select value={paymentTeam} disabled={paymentSaving} onChange={(event) => setPaymentTeam(event.target.value as "" | CollectionTeam)}>
                  <option value="">Seleccionar</option>
                  <option value="PTY">PTY</option>
                  <option value="WC">WC</option>
                </select>
              </label>
              {paymentMethod === "cash" ? (
                <p className="hint">Se generará el recibo y el efectivo quedará pendiente de entrega.</p>
              ) : (
                <p className="hint">Quedará en hold hasta que el banco confirme el movimiento.</p>
              )}
              {paymentError ? <p className="error-text" role="alert">{paymentError}</p> : null}
            </div>
            <div className="modal-actions">
              <button type="button" className="button ghost" onClick={() => setPaymentTarget(null)} disabled={paymentSaving}>Cancelar</button>
              <button type="button" className="button primary" onClick={() => void submitRoutePayment()} disabled={paymentSaving}>
                {paymentSaving ? "Guardando..." : paymentMethod === "cash" ? "Generar recibo" : "Colocar en hold"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {removeTarget ? (
        <div className="modal-overlay route-search-payment-overlay" onMouseDown={() => !removeSaving && setRemoveTarget(null)}>
          <div className="modal route-search-remove-modal" role="dialog" aria-modal="true" aria-labelledby="route-remove-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2 id="route-remove-title">Sacar de ruta</h2>
                <p>{removeTarget.unitId} · {removeTarget.clientName}</p>
              </div>
            </div>
            <div className="route-search-remove-copy">
              <p>La unidad dejará de aparecer en la lista activa de cobro en ruta.</p>
              {removeError ? <p className="error-text" role="alert">{removeError}</p> : null}
            </div>
            <div className="modal-actions">
              <button type="button" className="button ghost" onClick={() => setRemoveTarget(null)} disabled={removeSaving}>Cancelar</button>
              <button type="button" className="button route-search-remove-confirm" onClick={() => void confirmRemoveFromRoute()} disabled={removeSaving}>
                {removeSaving ? "Sacando..." : "Sí, sacar de ruta"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="route-share-stage" aria-hidden="true">
        {visibleRouteGroups.map((group) => (
          <div
            className="route-share-sheet"
            key={group.routeValue}
            ref={(element) => {
              if (element) shareSheetRefs.current.set(group.routeValue, element);
              else shareSheetRefs.current.delete(group.routeValue);
            }}
          >
            <header className="route-share-sheet-header">
              <div>
                <span className="route-share-eyebrow">RENT AUTOS</span>
                <h2>Cobro en Ruta</h2>
                <p>Ruta {group.routeLabel}{group.zoneLabel ? ` · Zona ${group.zoneLabel}` : ""}</p>
              </div>
              <div className="route-share-summary">
                <strong>{group.items.length}</strong>
                <span>cliente{group.items.length === 1 ? "" : "s"}</span>
              </div>
            </header>
            <div className="route-share-meta-line">
              <span>Generada {formatPublishedAt(new Date().toISOString())}</span>
              {publishedAt ? <span>Ruta publicada {publishedAt}</span> : null}
            </div>
            <div className="route-share-grid">
              {group.items.map((item) => {
                const itemManagementTone = managementTone(item.managementType);
                return (
                  <article className={`route-share-card route-share-card--${itemManagementTone} ${item.urgency && item.urgency !== "normal" ? `route-share-card--${item.urgency}` : ""}`} key={item.clientId}>
                  <div className="route-share-card-title">
                    <div>
                      <strong>{item.unitId}</strong>
                      <span>{item.clientName}</span>
                    </div>
                    <b>{item.routeAssignment || "Sin ruta"}</b>
                  </div>
                  <div className="route-share-card-amounts">
                    <div>
                      <small>Min. liberar</small>
                      <strong>{item.releaseAmount > 0 ? formatCurrency(item.releaseAmount) : "Monto pendiente"}</strong>
                    </div>
                    <div>
                      <small>Saldo vencido</small>
                      <strong>{formatCurrency(currentBalance(item))}</strong>
                    </div>
                  </div>
                  <div className="route-share-tags">
                    {item.zone ? <span>Zona {item.zone}</span> : <span>Sin zona</span>}
                    <span>{item.daysLate > 0 ? `${item.daysLate} dias de atraso` : "Sin atraso"}</span>
                    <span>{fieldManagementLabel(item.managementType)}</span>
                    {item.urgency && item.urgency !== "normal" ? (
                      <span>{item.urgency === "very_urgent" ? "Muy urgente" : "Urgente"}</span>
                    ) : null}
                  </div>
                  {item.comment ? <p>{item.comment}</p> : null}
                  </article>
                );
              })}
            </div>
            <footer>Ruta {group.routeLabel}{group.zoneLabel ? ` · Zona ${group.zoneLabel}` : ""} · {group.items.length} cliente{group.items.length === 1 ? "" : "s"}</footer>
          </div>
        ))}
      </div>
    </section>
  );
}
