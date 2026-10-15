import { useEffect, useMemo, useRef, useState } from "react";
import RoutePendingCashPanel from "./RoutePendingCashPanel";
import RouteCollectionCard, { type RouteWorkflowView } from "./RouteCollectionCard";
import RouteManagedList from "./RouteManagedList";
import RouteTeamSummary from "./RouteTeamSummary";
import { PaymentPreviewDialog } from "./payments/PaymentDialogs";
import { applyRouteReportDelta, changeRouteAssignment, cancelRoutePaymentReport, loadRoutePaymentReport, loadRoutePaymentReportForItem, loadRoutePaymentReports, loadRoutePaymentReportsPage, loadRouteReportReceipts, reportRoutePayment, routeReportDeltaFromPayload, setRouteCustody, setRouteInactiveStatus, type RouteBankConfirmationResult, type RoutePaymentReport, type RouteReportDelta } from "../cloud/routeReportCloudData";
import {
  ALL_ACTIVE_ROUTE_FILTER,
  EMPTY_ACTIVE_ROUTE_FILTER,
  activeRouteFilterLabel,
  activeRouteFilterValue,
  compareActiveRouteFilterValues,
  compareActiveRouteItems
} from "../activeRouteOrdering";
import { getBusinessDateKey } from "../billing";
import { buildCloudErrorMessage } from "../app/appShellRules";
import {
  loadCloudActiveRouteItems,
  loadCloudActiveRouteItem,
  activeRouteDeltaFromPayload,
  applyActiveRouteDelta,
  keepCloudActiveRouteItemAfterPartialPayment,
  removeCloudActiveRouteItemFromSearch,
  saveCloudActiveRouteComment,
  saveCloudActiveRouteZone,
  changeCloudActiveRouteDelta,
  type ActiveRouteItem,
  type ActiveRouteDelta
} from "../cloudData";
import { formatCurrency, formatDate } from "../format";
import { supabase } from "../lib/supabase";
import { buildRouteReviewIndex, getActiveRouteReviewItems, getRouteWorkItems, isPendingCashRouteReport, routeRentAmountForDay } from "../routeReviewRules";
import { compareRouteWorkItemsByUrgency } from "../routeTimeUrgency";
import { buildRouteDeltaIdentityMap, buildRouteManagedActions, routeDeltaForActor, routeDeltaFromName, routeDeltaLabel, ROUTE_DELTAS, type RouteDeltaIdentityMap, type RouteDeltaKey } from "../routeDeltaTracking";
import { isDelta1OnlyRouteClient } from "../routeDeltaAssignmentRules";
import type { Client, CollectionTeam, Payment } from "../types";
import { loadNotifiedPayments, parseNotifiedPayments } from "./payments/paymentStorage";
import type { NotifiedPayment } from "./payments/paymentTypes";
import { normalizeRouteAssignment, ROUTE_ASSIGNMENT_OPTIONS } from "./receivables/receivablesPageRules";
import { fieldManagementLabel, type FieldManagementType } from "./receivables/receivablesTypes";
import { confirmRouteCapture, confirmRouteRun, loadRouteCaptureEvents, loadRouteRuns, submitRouteRun, type RouteCaptureEvent, type RouteRun } from "../cloud/routeCaptureCloudData";

export type RouteSearchPageProps = {
  renderManagementFields?: (item: ActiveRouteItem) => React.ReactNode;
  paymentsLoading?: boolean;
  currentUserId?: string;
  currentUserEmail?: string;
  initialRouteFilter?: string;
  canReportPayment?: boolean;
  canConfirmBankPayment?: boolean;
  canConfirmCaptures?: boolean;
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
    reportId?: string;
    fundsReceivedDate?: string;
  }) => Promise<{ kind: "cash" | "bank"; receiptNumber?: string; payment?: Payment }>;
  onConfirmBankPayment?: (input: {
    reportId: string;
  }) => Promise<RouteBankConfirmationResult>;
};

const ALL_ACTIVE_ZONE_FILTER = "__all_zones__";
const EMPTY_ACTIVE_ZONE_FILTER = "__empty_zone__";
const ROUTE_REPORT_PAGE_SIZE = 200;
type AssignedDelta = "delta1" | "delta2" | "delta3";
type PtyAssignedDelta = "delta1" | "delta3";

type ZoneOption = {
  value: string;
  label: string;
  count: number;
};

type RouteDisplayItem = ActiveRouteItem & {
  report?: RoutePaymentReport;
  reviewKind?: "partial" | "notified";
};

function deltaForDisplayItem(item: RouteDisplayItem, view: RouteWorkflowView, captureByRouteItem: Map<string, RouteCaptureEvent>, identities: RouteDeltaIdentityMap): RouteDeltaKey | null {
  if (item.report) return routeDeltaForActor(item.report.reported_by, item.report.reporter_name, identities);
  if (view === "custody") {
    const capture = captureByRouteItem.get(`${item.clientId}\u0000${item.publishedAt}`);
    return routeDeltaForActor(capture?.reported_by, capture?.reporter_name, identities);
  }
  if (view === "work" && item.routeInactiveAt) return routeDeltaForActor(item.routeInactiveBy, undefined, identities);
  return null;
}

function isAssignedDelta(value: RouteDeltaKey | null): value is AssignedDelta {
  return value === "delta1" || value === "delta2" || value === "delta3";
}

function matchesAssignedDelta(item: ActiveRouteItem, delta: AssignedDelta | null): boolean {
  if (!delta) return true;
  const expectedRoute = delta === "delta2" ? "WC" : "PTY";
  return activeRouteFilterValue(item.routeAssignment) === expectedRoute && item.assignedDelta === delta;
}

function normalizeZoneName(value: string | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

function activeZoneFilterValue(value: string | undefined): string {
  const normalized = normalizeZoneName(value);
  return normalized ? normalized.toLocaleLowerCase("es") : EMPTY_ACTIVE_ZONE_FILTER;
}

function asCollectionTeam(value: string | undefined): CollectionTeam | "" {
  const normalized = (value ?? "").trim().toUpperCase();
  return normalized === "PTY" || normalized === "WC" ? normalized : "";
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
  renderManagementFields,
  paymentsLoading = false,
  currentUserId,
  currentUserEmail,
  initialRouteFilter,
  canReportPayment = false,
  canConfirmBankPayment = false,
  canConfirmCaptures = false,
  dataOwnerUserId,
  clients,
  payments,
  readOnly = true,
  canRemoveFromRoute = false,
  onRegisterPayment,
  onConfirmBankPayment
}: RouteSearchPageProps) {
  const preferredRouteFilter = initialRouteFilter
    ? activeRouteFilterValue(initialRouteFilter)
    : null;
  const operatorCollectionTeam = asCollectionTeam(initialRouteFilter);
  const signedInDelta = routeDeltaFromName(currentUserEmail);
  const signedInAssignedDelta = isAssignedDelta(signedInDelta) ? signedInDelta : null;
  const canEditAssignedDelta = !readOnly && signedInDelta === null;
  const [businessDateKey, setBusinessDateKey] = useState(() => getBusinessDateKey());
  useEffect(() => {
    const updateDay = () => setBusinessDateKey(getBusinessDateKey());
    const timer = window.setInterval(updateDay, 30000);
    window.addEventListener("focus", updateDay);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", updateDay); };
  }, []);
  const [confirmedPeriod, setConfirmedPeriod] = useState<"today" | "previous">("today");
  const [items, setItems] = useState<ActiveRouteItem[]>([]);
  const [reports, setReports] = useState<RoutePaymentReport[]>([]);
  const [captureEvents, setCaptureEvents] = useState<RouteCaptureEvent[]>([]);
  const [routeRuns, setRouteRuns] = useState<RouteRun[]>([]);
  const [captureError, setCaptureError] = useState("");
  const [captureSavingId, setCaptureSavingId] = useState<string | null>(null);
  const [runSavingId, setRunSavingId] = useState<string | null>(null);
  const itemLoadIdRef = useRef(0);
  const itemLoadingRef = useRef(false);
  const pendingItemDeltasRef = useRef<ActiveRouteDelta[]>([]);
  const reportLoadIdRef = useRef(0);
  const reportLoadingRef = useRef(false);
  const reportHistoryOffsetRef = useRef(0);
  const pendingReportDeltasRef = useRef<RouteReportDelta[]>([]);
  const [workflowView, setWorkflowView] = useState<RouteWorkflowView>("work");
  const [custodyTarget, setCustodyTarget] = useState<ActiveRouteItem | null>(null);
  const [custodySaving, setCustodySaving] = useState(false);
  const [custodyError, setCustodyError] = useState("");
  const [receiptPreview, setReceiptPreview] = useState<Payment | null>(null);
  const [receiptOptions, setReceiptOptions] = useState<Payment[]>([]);
  const [receiptLoading, setReceiptLoading] = useState<string | null>(null);
  const [receiptError, setReceiptError] = useState("");
  const [bankConfirmationSavingId, setBankConfirmationSavingId] = useState<string | null>(null);
  const [completedCash, setCompletedCash] = useState<{ unit: string; amount: number } | null>(null);
  const [reportTarget, setReportTarget] = useState<ActiveRouteItem | null>(null);
  const [reportAmount, setReportAmount] = useState("");
  const [reportMethod, setReportMethod] = useState<"" | "cash" | "bank" | "mixed">("");
  const [reportCashAmount, setReportCashAmount] = useState("");
  const [reportBankAmount, setReportBankAmount] = useState("");
  const [reportCashTeam, setReportCashTeam] = useState<CollectionTeam | "">("");
  const [reportSaving, setReportSaving] = useState(false);
  const [reportError, setReportError] = useState("");
  const [reportsError, setReportsError] = useState("");
  const [reportsReady, setReportsReady] = useState(false);
  const [reportsHaveMore, setReportsHaveMore] = useState(false);
  const [reportsLoadingMore, setReportsLoadingMore] = useState(false);

  async function reloadReports(): Promise<void> {
    const loadId = ++reportLoadIdRef.current;
    pendingReportDeltasRef.current = [];
    if (!dataOwnerUserId) {
      reportLoadingRef.current = false;
      setReports([]);
      setReportsReady(false);
      setReportsHaveMore(false);
      return;
    }
    reportLoadingRef.current = true;
    try {
      const [page, reviewReports] = await Promise.all([
        loadRoutePaymentReportsPage(dataOwnerUserId, 0, ROUTE_REPORT_PAGE_SIZE),
        loadRoutePaymentReports(dataOwnerUserId, { reviewOnly: true })
      ]);
      if (loadId !== reportLoadIdRef.current) return;
      const loaded = [...new Map([...page.reports, ...reviewReports].map((report) => [report.id, report])).values()];
      setReports(pendingReportDeltasRef.current.reduce(applyRouteReportDelta, loaded));
      reportHistoryOffsetRef.current = page.reports.length;
      setReportsHaveMore(page.hasMore);
      setReportsError("");
      setReportsReady(true);
    } catch (cause) {
      if (loadId !== reportLoadIdRef.current) return;
      setReportsReady(false);
      setReportsError(buildCloudErrorMessage("No se pudieron cargar los reportes de pago.", cause));
    } finally {
      if (loadId === reportLoadIdRef.current) {
        reportLoadingRef.current = false;
        pendingReportDeltasRef.current = [];
      }
    }
  }

  async function reloadCaptures(): Promise<void> {
    if (!dataOwnerUserId) {
      setCaptureEvents([]);
      setRouteRuns([]);
      return;
    }
    try {
      const [nextCaptures, nextRuns] = await Promise.all([
        loadRouteCaptureEvents(dataOwnerUserId),
        loadRouteRuns(dataOwnerUserId)
      ]);
      setCaptureEvents(nextCaptures);
      setRouteRuns(nextRuns);
      setCaptureError("");
    } catch (cause) {
      setCaptureError(buildCloudErrorMessage("No se pudo cargar el control de captaciones.", cause));
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
    if (cashAmount > 0 && !reportCashTeam) {
      setReportError("Selecciona el equipo PTY o WC que recibió el efectivo.");
      return;
    }
    setReportSaving(true);
    setReportError("");
    let savedReport: RoutePaymentReport | null = null;
    try {
      await reportRoutePayment(dataOwnerUserId, reportTarget, cashAmount, bankAmount);
      setRouteActionMessage(`${reportTarget.unitId} pasó a Pago notificado.`);
      try {
        const latestReport = await loadRoutePaymentReportForItem(dataOwnerUserId, reportTarget.clientId, reportTarget.publishedAt);
        if (latestReport) {
          savedReport = latestReport;
          setReports((current) => applyRouteReportDelta(current, { id: latestReport.id, report: latestReport }));
        }
      } catch (refreshError) {
        console.warn("El reporte se guardó, pero no se pudo actualizar su vista.", refreshError);
      }

      if (cashAmount > 0 && onRegisterPayment) {
        if (!savedReport) throw new Error("El pago se notificó, pero no se pudo preparar el recibo. Actualiza la ruta para generarlo.");
        if (!reportCashTeam) throw new Error("El pago se notificó, pero falta identificar el equipo que recibió el efectivo.");
        const cashTeam = reportCashTeam;
        const result = await onRegisterPayment({
          clientId: reportTarget.clientId,
          amount: cashAmount,
          method: "cash",
          team: cashTeam,
          reportId: savedReport.id,
          fundsReceivedDate: getBusinessDateKey(new Date(savedReport.reported_at))
        });
        if (result.kind !== "cash" || !result.receiptNumber) throw new Error("El pago se notificó, pero no se pudo emitir el recibo de efectivo.");
        setCompletedCash({ unit: reportTarget.unitId, amount: cashAmount });
        setPaymentMessage(`${reportTarget.unitId}: pago en efectivo registrado correctamente · Equipo ${cashTeam}.`);
        setRegisteredReportIds((current) => current.includes(savedReport!.id) ? current : [...current, savedReport!.id]);
        try {
          const refreshed = await loadRoutePaymentReport(dataOwnerUserId, savedReport.id);
          setReports((current) => applyRouteReportDelta(current, { id: savedReport!.id, report: refreshed }));
        } catch (refreshError) {
          console.warn("El recibo se generó, pero no se pudo actualizar el pago notificado.", refreshError);
        }
        setRouteActionMessage(`${reportTarget.unitId}: pago registrado correctamente.`);
      }
      setReportTarget(null);
    } catch (cause) {
      if (savedReport) {
        setReportTarget(null);
        try {
          await cancelRoutePaymentReport(savedReport.id);
          setReports((current) => applyRouteReportDelta(current, { id: savedReport!.id, report: null }));
          openWorkflow("work");
          setReportsError(buildCloudErrorMessage("No se pudo emitir el recibo. La notificación se devolvió a Trabajo para evitar un efectivo pendiente.", cause, { includeRawFallback: true }));
        } catch (cancelError) {
          console.error("No se pudo devolver el reporte después de fallar el recibo.", cancelError);
          openWorkflow("review");
          setReportsError(buildCloudErrorMessage("No se pudo emitir el recibo ni devolver la notificación. Actualiza la ruta antes de reintentar.", cause, { includeRawFallback: true }));
        }
      } else {
        setReportError(buildCloudErrorMessage("No se pudo notificar el pago.", cause, { includeRawFallback: true }));
      }
    } finally { setReportSaving(false); }
  }

  async function returnReport(report: RoutePaymentReport): Promise<void> {
    if (!canConfirmBankPayment || reportSaving) return;
    setReportSaving(true);
    try {
      await cancelRoutePaymentReport(report.id);
      setRouteActionMessage(`Reporte de ${report.snapshot.unitId} devuelto. La unidad aparecerá en Trabajo si sigue activa.`);
      setReports((current) => applyRouteReportDelta(current, { id: report.id, report: null }));
    } catch (cause) {
      setReportsError(buildCloudErrorMessage("No se pudo devolver el reporte.", cause, { includeRawFallback: true }));
    } finally { setReportSaving(false); }
  }

  async function confirmBankReport(report: RoutePaymentReport): Promise<void> {
    if (!canConfirmBankPayment || !onConfirmBankPayment || !dataOwnerUserId || bankConfirmationSavingId) return;
    setBankConfirmationSavingId(report.id);
    setReportsError("");
    setPaymentMessage("");
    try {
      const latest = await loadRoutePaymentReport(dataOwnerUserId, report.id);
      const pendingBankAmount = latest ? Math.max(0, latest.bank_amount - latest.confirmed_bank_amount) : 0;
      if (!latest || latest.status !== "review" || pendingBankAmount <= 0) {
        throw new Error("Este pago bancario ya fue confirmado o cambió. Actualiza la ruta.");
      }
      const result = await onConfirmBankPayment({ reportId: latest.id });
      const refreshed = await loadRoutePaymentReport(dataOwnerUserId, latest.id);
      setReports((current) => applyRouteReportDelta(current, { id: latest.id, report: refreshed }));
      await refreshItem(latest.client_id);
      setPaymentMessage(`${latest.snapshot.unitId}: pago confirmado en banco por el administrador.`);
      setRouteActionMessage(result.outcome === "removed"
        ? `${latest.snapshot.unitId} salió de Ruta: el monto confirmado cubre lo solicitado.`
        : `${latest.snapshot.unitId} pasó a Decisión pendiente.`);
    } catch (cause) {
      console.error("No se pudo confirmar el pago bancario de Ruta.", cause);
      setReportsError(buildCloudErrorMessage("No se pudo confirmar el pago en banco.", cause, { includeRawFallback: true }));
    } finally {
      setBankConfirmationSavingId(null);
    }
  }
  const [changingRoute, setChangingRoute] = useState<string | null>(null);
  const [changingAssignedDelta, setChangingAssignedDelta] = useState<string | null>(null);
  const [assignedDeltaError, setAssignedDeltaError] = useState("");
  const [changeRouteError, setChangeRouteError] = useState("");
  const [routeUndo, setRouteUndo] = useState<{ item: ActiveRouteItem; previous: string; current: string } | null>(null);
  const [routeCreateTarget, setRouteCreateTarget] = useState<ActiveRouteItem | null>(null);
  const [routeCreateDraft, setRouteCreateDraft] = useState("");
  const [routeCreateError, setRouteCreateError] = useState("");
  const [inactiveSavingByClient, setInactiveSavingByClient] = useState<Record<string, boolean>>({});
  const [inactiveError, setInactiveError] = useState("");
  const [elapsedNow, setElapsedNow] = useState(() => Date.now());
  async function changeTeam(item: ActiveRouteItem, routeValue: string, isUndo = false): Promise<boolean> {
    const route = normalizeRouteAssignment(routeValue);
    const previous = normalizeRouteAssignment(item.routeAssignment ?? "") ?? "";
    if (!canReportPayment || !dataOwnerUserId || changingRoute || !route || route === previous) return false;
    setChangingRoute(item.clientId);
    setChangeRouteError("");
    setInactiveError("");
    setRouteActionMessage("");
    try {
      await changeRouteAssignment(dataOwnerUserId, item, route);
      setItems(current => current.map(row => row.clientId === item.clientId && row.publishedAt === item.publishedAt
        ? {
            ...row,
            routeAssignment: route,
            assignedDelta: route === "WC"
              ? "delta2"
              : route === "PTY" && (row.assignedDelta === "delta1" || row.assignedDelta === "delta3")
                ? row.assignedDelta
                : undefined
          } : row));
      setRouteUndo(isUndo ? null : { item: { ...item, routeAssignment: route, assignedDelta: route === "WC" ? "delta2" : undefined }, previous, current: route });
      setRouteActionMessage(isUndo ? `${item.unitId} volvió a ${route}.` : `${item.unitId} cambió a ${route}.`);
      return true;
    } catch (cause) {
      setChangeRouteError(buildCloudErrorMessage("No se pudo cambiar la ruta.", cause, { includeRawFallback: true }));
      return false;
    } finally { setChangingRoute(null); }
  }
  async function undoRouteChange(): Promise<void> {
    if (routeUndo) await changeTeam(routeUndo.item, routeUndo.previous, true);
  }
  async function changeAssignedDelta(item: ActiveRouteItem, delta: PtyAssignedDelta): Promise<void> {
    if (!canEditAssignedDelta || !dataOwnerUserId || changingAssignedDelta || item.assignedDelta === delta) return;
    if (delta === "delta3" && isDelta1OnlyRouteClient(item.clientName)) {
      setAssignedDeltaError(`${item.clientName} debe permanecer asignado a Delta 1.`);
      return;
    }
    setChangingAssignedDelta(item.clientId);
    setAssignedDeltaError("");
    setRouteActionMessage("");
    try {
      await changeCloudActiveRouteDelta({
        userId: dataOwnerUserId,
        clientId: item.clientId,
        publishedAt: item.publishedAt,
        previousDelta: item.assignedDelta === "delta1" || item.assignedDelta === "delta3" ? item.assignedDelta : undefined,
        delta
      });
      setItems(current => current.map(row => row.clientId === item.clientId && row.publishedAt === item.publishedAt
        ? { ...row, assignedDelta: delta } : row));
      setRouteActionMessage(`${item.unitId} quedó asignado a ${routeDeltaLabel(delta)}.`);
    } catch (cause) {
      setAssignedDeltaError(buildCloudErrorMessage("No se pudo cambiar el buscador asignado.", cause, { includeRawFallback: true }));
    } finally {
      setChangingAssignedDelta(null);
    }
  }
  async function createRoute(): Promise<void> {
    if (!routeCreateTarget || changingRoute) return;
    const route = normalizeRouteAssignment(routeCreateDraft);
    if (!route) {
      setRouteCreateError("Escribe el nombre de la ruta.");
      return;
    }
    if (route === normalizeRouteAssignment(routeCreateTarget.routeAssignment ?? "")) {
      setRouteCreateTarget(null);
      setRouteCreateDraft("");
      setRouteCreateError("");
      return;
    }
    const changed = await changeTeam(routeCreateTarget, route);
    if (!changed) {
      setRouteCreateError("No se pudo guardar la ruta. Intenta nuevamente.");
      return;
    }
    setRouteCreateTarget(null);
    setRouteCreateDraft("");
    setRouteCreateError("");
  }
  async function toggleInactive(item: ActiveRouteItem): Promise<void> {
    if (!canReportPayment || !dataOwnerUserId || inactiveSavingByClient[item.clientId]) return;
    const inactive = !item.routeInactiveAt;
    setInactiveSavingByClient(current => ({ ...current, [item.clientId]: true }));
    setInactiveError(""); setChangeRouteError(""); setRouteUndo(null);
    try {
      const changedAt = await setRouteInactiveStatus(dataOwnerUserId, item, inactive);
      setItems(current => current.map(row => row.clientId === item.clientId && row.publishedAt === item.publishedAt
        ? { ...row, routeInactiveAt: inactive ? (changedAt ?? new Date().toISOString()) : undefined,
          routeInactiveBy: inactive ? currentUserId : undefined }
        : row));
      setElapsedNow(Date.now());
      setRouteActionMessage(inactive ? `${item.unitId} quedó marcado como Inactivo.` : `${item.unitId} volvió a estar disponible.`);
    } catch (cause) {
      setInactiveError(buildCloudErrorMessage("No se pudo cambiar el estado Inactivo.", cause, { includeRawFallback: true }));
    } finally {
      setInactiveSavingByClient(current => ({ ...current, [item.clientId]: false }));
    }
  }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [routeFilter, setRouteFilter] = useState(preferredRouteFilter ?? ALL_ACTIVE_ROUTE_FILTER);
  const [deltaFilter, setDeltaFilter] = useState<RouteDeltaKey | null>(null);
  const [assignedDeltaFilter, setAssignedDeltaFilter] = useState<AssignedDelta | null>(signedInAssignedDelta);
  const [assignmentManagerOpen, setAssignmentManagerOpen] = useState(false);
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

  useEffect(() => {
    if (!preferredRouteFilter) return;
    setRouteFilter(preferredRouteFilter);
    setZoneFilter(ALL_ACTIVE_ZONE_FILTER);
    setZoneFilterLabel("");
  }, [preferredRouteFilter]);

  useEffect(() => {
    setAssignedDeltaFilter(signedInAssignedDelta);
  }, [signedInAssignedDelta]);

  const currentBalanceByClient = useMemo(
    () => new Map(clients.map((client) => [client.id, Math.max(0, client.balance)] as const)),
    [clients]
  );

  const travelFundBalanceByClient = useMemo(
    () => new Map(clients.map((client) => [client.id, Math.max(0, client.travelFundBalance ?? 0)] as const)),
    [clients]
  );

  function currentBalance(item: ActiveRouteItem): number {
    return currentBalanceByClient.get(item.clientId) ?? item.overdueBalance;
  }

  async function reload(): Promise<void> {
    const loadId = ++itemLoadIdRef.current;
    pendingItemDeltasRef.current = [];
    if (!dataOwnerUserId) {
      itemLoadingRef.current = false;
      setItems([]);
      setLoading(false);
      setError("No hay dataset asignado para consultar la ruta.");
      return;
    }
    itemLoadingRef.current = true;
    setLoading(true);
    setError("");
    try {
      const loadedItems = await loadCloudActiveRouteItems(dataOwnerUserId);
      if (loadId !== itemLoadIdRef.current) return;
      const nextItems = pendingItemDeltasRef.current.reduce(applyActiveRouteDelta, loadedItems);
      setItems(nextItems);
      setLastRefreshAt(new Date().toLocaleTimeString("es-PA", { hour: "numeric", minute: "2-digit" }));
    } catch (loadError) {
      if (loadId !== itemLoadIdRef.current) return;
      console.error("No se pudo cargar la vista buscador.", loadError);
      setError("No se pudo cargar Cobro en Ruta.");
    } finally {
      if (loadId === itemLoadIdRef.current) {
        itemLoadingRef.current = false;
        pendingItemDeltasRef.current = [];
        setLoading(false);
      }
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
    void reloadCaptures();
    setReports([]);
    setReportsReady(false);
    void reloadReports();
  }, [dataOwnerUserId]);

  useEffect(() => {
    const timer = window.setInterval(() => setElapsedNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!routeUndo) return;
    const timer = window.setTimeout(() => setRouteUndo(current => current === routeUndo ? null : current), 15_000);
    return () => window.clearTimeout(timer);
  }, [routeUndo]);

  useEffect(() => {
    if (!dataOwnerUserId || !supabase) return;
    const client = supabase;
    let subscribed = false;
    const channel = client
      .channel(`route-search-${dataOwnerUserId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "route_payment_reports", filter: `user_id=eq.${dataOwnerUserId}` }, (payload) => {
        const delta = routeReportDeltaFromPayload(payload);
        if (!delta) {
          void reloadReports();
          return;
        }
        if (reportLoadingRef.current) pendingReportDeltasRef.current.push(delta);
        setReports((current) => applyRouteReportDelta(current, delta));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "active_route_items_cloud", filter: `user_id=eq.${dataOwnerUserId}` }, (payload) => {
        const delta = activeRouteDeltaFromPayload(payload);
        if (!delta) {
          void reload();
          return;
        }
        if (itemLoadingRef.current) pendingItemDeltasRef.current.push(delta);
        setItems((current) => applyActiveRouteDelta(current, delta));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "route_capture_events", filter: `user_id=eq.${dataOwnerUserId}` }, () => {
        void reloadCaptures();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "route_runs", filter: `user_id=eq.${dataOwnerUserId}` }, () => {
        void reloadCaptures();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "notified_payments_cloud", filter: `user_id=eq.${dataOwnerUserId}` }, () => {
        void reloadBankNotices();
      })
      .subscribe((status) => {
        if (status !== "SUBSCRIBED") return;
        if (subscribed) {
          void reload();
          void reloadReports();
          void reloadBankNotices();
          void reloadCaptures();
        }
        subscribed = true;
      });
    return () => {
      void client.removeChannel(channel);
    };
  }, [dataOwnerUserId]);

  const routeReviewIndex = useMemo(() => buildRouteReviewIndex(payments, reports), [payments, reports]);
  const workItems = useMemo(() => getRouteWorkItems(items, payments, businessDateKey, reports, routeReviewIndex), [items, payments, businessDateKey, reports, routeReviewIndex]);
  const custodyItems = useMemo(() => items.filter((item) => item.inCustody && !item.removedAt), [items]);
  const captureByRouteItem = useMemo(() => {
    const byItem = new Map<string, RouteCaptureEvent>();
    captureEvents.forEach((event) => {
      const key = `${event.client_id}\u0000${event.published_at}`;
      if (!byItem.has(key)) byItem.set(key, event);
    });
    return byItem;
  }, [captureEvents]);

  const partialReviewItems = useMemo(() => (
    getActiveRouteReviewItems(items, payments, businessDateKey, reports, routeReviewIndex).map((item) => ({
      ...item,
      report: reports.find((report) => report.client_id === item.clientId && report.published_at === item.publishedAt),
      reviewKind: "partial" as const
    }))
  ), [items, payments, businessDateKey, reports, routeReviewIndex]);

  const confirmedReports = useMemo(() => reports.filter(report => report.status === "confirmed"), [reports]);
  const confirmedToday = useMemo(() => confirmedReports.filter(report => {
    const date = new Date(report.confirmed_at || report.reported_at);
    return !Number.isNaN(date.getTime()) && getBusinessDateKey(date) === businessDateKey;
  }), [confirmedReports, businessDateKey]);
  const confirmedPrevious = useMemo(() => confirmedReports.filter(report => !confirmedToday.includes(report)), [confirmedReports, confirmedToday]);
  const visibleConfirmedReports = confirmedPeriod === "today" ? confirmedToday : confirmedPrevious;
  const reviewReports = useMemo(() => reports.filter((report) => report.status === "review"), [reports]);
  const notifiedReviewItems = useMemo<RouteDisplayItem[]>(() => reviewReports.map((report) => ({
    ...report.snapshot,
    inCustody: items.some((item) => item.clientId === report.client_id && item.publishedAt === report.published_at && item.inCustody),
    report,
    reviewKind: "notified"
  })), [items, reviewReports]);
  const paymentReviewItems = useMemo<RouteDisplayItem[]>(() => {
    const notifiedKeys = new Set(notifiedReviewItems.map((item) => `${item.clientId}\u0000${item.publishedAt}`));
    return [
      ...partialReviewItems.filter((item) => !notifiedKeys.has(`${item.clientId}\u0000${item.publishedAt}`)),
      ...notifiedReviewItems
    ];
  }, [notifiedReviewItems, partialReviewItems]);
  const deltaIdentityMap = useMemo(() => buildRouteDeltaIdentityMap({
    reports,
    captures: captureEvents,
    runs: routeRuns,
    currentUserId,
    currentUserEmail
  }), [captureEvents, currentUserEmail, currentUserId, reports, routeRuns]);
  const managedActions = useMemo(() => buildRouteManagedActions({
    reports,
    captures: captureEvents,
    runs: routeRuns,
    items,
    businessDateKey,
    currentUserId,
    currentUserEmail
  }), [businessDateKey, captureEvents, currentUserEmail, currentUserId, items, reports, routeRuns]);

  const activeItems = useMemo<RouteDisplayItem[]>(() => {
    const rows = workflowView === "work" ? workItems : workflowView === "custody" ? custodyItems : workflowView === "review" ? paymentReviewItems : workflowView === "confirmed" ? visibleConfirmedReports
      .map((report) => ({ ...report.snapshot, inCustody: items.some((item) => item.clientId === report.client_id && item.publishedAt === report.published_at && item.inCustody), report })) : [];
    return deltaFilter ? rows.filter((item) => deltaForDisplayItem(item, workflowView, captureByRouteItem, deltaIdentityMap) === deltaFilter) : rows;
  }, [captureByRouteItem, custodyItems, deltaFilter, deltaIdentityMap, items, paymentReviewItems, visibleConfirmedReports, workflowView, workItems]);

  const ptyAssignedWorkItems = useMemo(() => (
    workItems
      .filter(item => activeRouteFilterValue(item.routeAssignment) === "PTY")
      .sort(compareActiveRouteItems)
  ), [workItems]);
  const deltaAssignmentCounts = useMemo(() => {
    return {
      all: workItems.filter(item => item.assignedDelta && matchesAssignedDelta(item, item.assignedDelta)).length,
      delta1: ptyAssignedWorkItems.filter(item => item.assignedDelta === "delta1").length,
      delta2: workItems.filter(item => activeRouteFilterValue(item.routeAssignment) === "WC" && item.assignedDelta === "delta2").length,
      delta3: ptyAssignedWorkItems.filter(item => item.assignedDelta === "delta3").length
    };
  }, [ptyAssignedWorkItems, workItems]);

  const workflowCounts = useMemo(() => {
    const byDelta = (rows: RouteDisplayItem[], view: RouteWorkflowView) => {
      const actionFiltered = deltaFilter
        ? rows.filter((item) => deltaForDisplayItem(item, view, captureByRouteItem, deltaIdentityMap) === deltaFilter)
        : rows;
      return actionFiltered.filter(item => matchesAssignedDelta(item, assignedDeltaFilter)).length;
    };
    return {
      work: byDelta(workItems, "work"),
      review: byDelta(paymentReviewItems, "review"),
      custody: byDelta(custodyItems, "custody"),
      managed: deltaFilter ? managedActions.filter((action) => action.delta === deltaFilter).length : managedActions.length
    };
  }, [assignedDeltaFilter, captureByRouteItem, custodyItems, deltaFilter, deltaIdentityMap, managedActions, paymentReviewItems, workItems]);

  function openWorkflow(view: RouteWorkflowView): void {
    setWorkflowView(view); setConfirmedPeriod("today"); setCompletedCash(null); setRouteActionMessage(""); setRouteUndo(null);
  }

  function toggleDeltaFilter(delta: RouteDeltaKey): void {
    const nextDelta = deltaFilter === delta ? null : delta;
    setDeltaFilter(nextDelta);
    setRouteFilter(ALL_ACTIVE_ROUTE_FILTER);
    setZoneFilter(ALL_ACTIVE_ZONE_FILTER);
    setZoneFilterLabel("");
    openWorkflow("managed");
  }

  function clearManagedDeltaFilter(): void {
    setDeltaFilter(null);
    setRouteFilter(ALL_ACTIVE_ROUTE_FILTER);
    setZoneFilter(ALL_ACTIVE_ZONE_FILTER);
    setZoneFilterLabel("");
  }

  function toggleRouteFilter(route: string): void {
    setRouteFilter((current) => current === route ? ALL_ACTIVE_ROUTE_FILTER : route);
    if (route !== "PTY") setAssignedDeltaFilter(null);
    setDeltaFilter(null);
    setZoneFilter(ALL_ACTIVE_ZONE_FILTER);
    setZoneFilterLabel("");
  }

  async function loadMoreReportHistory(): Promise<void> {
    if (!dataOwnerUserId || reportsLoadingMore || !reportsHaveMore) return;
    setReportsLoadingMore(true);
    try {
      const page = await loadRoutePaymentReportsPage(
        dataOwnerUserId,
        reportHistoryOffsetRef.current,
        ROUTE_REPORT_PAGE_SIZE
      );
      reportHistoryOffsetRef.current += page.reports.length;
      setReports((current) => {
        const byId = new Map(current.map((report) => [report.id, report]));
        for (const report of page.reports) byId.set(report.id, report);
        return [...byId.values()].sort((left, right) => right.reported_at.localeCompare(left.reported_at) || left.id.localeCompare(right.id));
      });
      setReportsHaveMore(page.hasMore);
    } catch (cause) {
      setReportsError(buildCloudErrorMessage("No se pudo cargar mas historial de pagos.", cause));
    } finally {
      setReportsLoadingMore(false);
    }
  }

  async function refreshItem(clientId: string): Promise<void> {
    if (!dataOwnerUserId) return;
    const item = await loadCloudActiveRouteItem(dataOwnerUserId, clientId);
    setItems((current) => applyActiveRouteDelta(current, { clientId, item }));
  }

  const bankNoticesByClient = useMemo(() => {
    const grouped = new Map<string, NotifiedPayment[]>();
    bankNotices.filter((notice) => notice.paymentMethod === "bank").forEach((notice) => {
      grouped.set(notice.clientId, [...(grouped.get(notice.clientId) ?? []), notice]);
    });
    return grouped;
  }, [bankNotices]);

  const routeAssignmentOptions = useMemo(() => {
    const knownRoutes = new Set<string>(ROUTE_ASSIGNMENT_OPTIONS);
    const addRoute = (value: string | undefined) => {
      const normalized = normalizeRouteAssignment(value ?? "");
      if (normalized) knownRoutes.add(normalized);
    };
    items.forEach((item) => addRoute(item.routeAssignment));
    reports.forEach((report) => addRoute(report.snapshot.routeAssignment));
    const defaults = ROUTE_ASSIGNMENT_OPTIONS.filter((route) => knownRoutes.delete(route));
    return [...defaults, ...Array.from(knownRoutes).sort(compareActiveRouteFilterValues)];
  }, [items, reports]);

  const routeFilterOptions = useMemo(() => {
    const managed = deltaFilter ? managedActions.filter((action) => action.delta === deltaFilter) : managedActions;
    const options = new Set((workflowView === "managed" ? managed : activeItems).map((item) => activeRouteFilterValue(item.routeAssignment)));
    if (routeFilter !== ALL_ACTIVE_ROUTE_FILTER) options.add(routeFilter);
    return Array.from(options).sort(compareActiveRouteFilterValues);
  }, [activeItems, deltaFilter, managedActions, routeFilter, workflowView]);

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
    if (routeFilter === ALL_ACTIVE_ROUTE_FILTER) {
      setZoneFilter(ALL_ACTIVE_ZONE_FILTER);
      setZoneFilterLabel("");
    }
  }, [routeFilter]);

  const visibleItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return activeItems
      .filter((item) => matchesAssignedDelta(item, assignedDeltaFilter))
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
      .sort((left, right) => {
        if (workflowView === "work") return compareRouteWorkItemsByUrgency(left, right, elapsedNow);
        if (workflowView === "review" && left.reviewKind !== right.reviewKind) {
          return left.reviewKind === "partial" ? -1 : 1;
        }
        return compareActiveRouteItems(left, right);
      });
  }, [activeItems, assignedDeltaFilter, elapsedNow, query, routeFilter, workflowView, zoneFilter]);

  const visibleManagedActions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return managedActions
      .filter((action) => !deltaFilter || action.delta === deltaFilter)
      .filter((action) => routeFilter === ALL_ACTIVE_ROUTE_FILTER || activeRouteFilterValue(action.routeAssignment) === routeFilter)
      .filter((action) => {
        if (!normalizedQuery) return true;
        const actionLabel = action.kind === "paid" ? "cobrado" : action.kind === "custody" ? "custodia" : "ausente";
        return [action.unitId, action.clientName, action.routeAssignment, routeDeltaLabel(action.delta), actionLabel]
          .some((value) => value.toLowerCase().includes(normalizedQuery));
      });
  }, [deltaFilter, managedActions, query, routeFilter]);

  const routeTotals = useMemo(() => {
    const managed = deltaFilter ? managedActions.filter((action) => action.delta === deltaFilter) : managedActions;
    const source = workflowView === "managed" ? managed : activeItems;
    const standardRoutes = Array.from(new Set(ROUTE_DELTAS.map((delta) => delta.route)));
    const standardRouteSet = new Set<string>(standardRoutes);
    const additionalRoutes = Array.from(new Set(source
      .map((item) => activeRouteFilterValue(item.routeAssignment))
      .filter((route) => route !== EMPTY_ACTIVE_ROUTE_FILTER && !standardRouteSet.has(route))))
      .sort(compareActiveRouteFilterValues);
    return [...standardRoutes, ...additionalRoutes].map((route) => ({
      route,
      count: source.filter((item) => activeRouteFilterValue(item.routeAssignment) === route).length
    }));
  }, [activeItems, deltaFilter, managedActions, workflowView]);

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
      void refreshItem(item.clientId).catch((refreshError) => console.warn("No se pudo actualizar la unidad.", refreshError));
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
      void refreshItem(item.clientId).catch((refreshError) => console.warn("No se pudo actualizar la unidad.", refreshError));
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
          ? { ...item, inCustody: false, custodySince: undefined, removedAt, removedReason: "route_editor_removed" }
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
    const pendingCashAmount = report ? Math.max(0, report.cash_amount - report.confirmed_cash_amount) : 0;
    setPaymentAmount(report ? String(pendingCashAmount) : item.releaseAmount > 0 ? String(item.releaseAmount) : "");
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
        const latest = await loadRoutePaymentReport(dataOwnerUserId, paymentReport.id);
        if (latest) setReports((current) => applyRouteReportDelta(current, { id: latest.id, report: latest }));
        const pendingCashAmount = latest ? Math.max(0, latest.cash_amount - latest.confirmed_cash_amount) : 0;
        if (!latest || !isPendingCashRouteReport(latest)
          || Math.abs(pendingCashAmount - amount) >= 0.005 || paymentMethod !== "cash") {
          throw new Error("El reporte cambió o ya fue confirmado. Cierra esta ventana y actualiza la ruta.");
        }
      }
      const result = await onRegisterPayment({
        clientId: paymentTarget.clientId,
        amount,
        method: paymentMethod,
        team: paymentTeam,
        ...(paymentReport ? {
          reportId: paymentReport.id,
          fundsReceivedDate: getBusinessDateKey(new Date(paymentReport.reported_at))
        } : {})
      });
      if (result.kind === "bank") {
        setBankNotices(loadNotifiedPayments());
        setPaymentMessage(`Pago bancario de ${formatCurrency(amount)} en hold · Equipo ${paymentTeam}.`);
      } else {
        setPaymentMessage(`${paymentTarget.unitId}: pago en efectivo registrado correctamente · Equipo ${paymentTeam}.`);
        setCompletedCash({ unit: paymentTarget.unitId, amount });
        if (paymentReport) setRegisteredReportIds((current) => [...current, paymentReport.id]);
      }
      setPaymentTarget(null);
      if (paymentReport && dataOwnerUserId) {
        try {
          const latest = await loadRoutePaymentReport(dataOwnerUserId, paymentReport.id);
          setReports((current) => applyRouteReportDelta(current, { id: paymentReport.id, report: latest }));
        } catch (refreshError) {
          console.warn("El pago se registró, pero no se pudo actualizar el reporte.", refreshError);
        }
      }
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
      setRouteActionMessage(custodyTarget.inCustody ? `${custodyTarget.unitId} salió de custodia. Aparecerá en Trabajo si tiene cobros pendientes y no tiene un pago notificado.` : `${custodyTarget.unitId}: carro declarado en custodia.`);
      const clientId = custodyTarget.clientId;
      const inCustody = !custodyTarget.inCustody;
      setItems((current) => current.map((item) => item.clientId === clientId ? { ...item, inCustody } : item));
      void refreshItem(clientId).catch((refreshError) => console.warn("La custodia cambió, pero no se pudo actualizar la unidad.", refreshError));
      void reloadCaptures();
      setCustodyTarget(null);
    } catch (cause) { setCustodyError(buildCloudErrorMessage("No se pudo cambiar la custodia.", cause, { includeRawFallback: true })); }
    finally { setCustodySaving(false); }
  }

  async function confirmCapture(event: RouteCaptureEvent): Promise<void> {
    if (!canConfirmCaptures || captureSavingId) return;
    setCaptureSavingId(event.id);
    setCaptureError("");
    try {
      await confirmRouteCapture(event.id);
      setCaptureEvents((current) => current.map((item) => item.id === event.id
        ? { ...item, status: "confirmed", confirmed_at: new Date().toISOString(), confirmed_by: currentUserId ?? null }
        : item));
      setRouteActionMessage(`${event.unit_id}: captación de ${event.reporter_name.split("@")[0]} confirmada.`);
      void reloadCaptures();
    } catch (cause) {
      setCaptureError(buildCloudErrorMessage("No se pudo confirmar la captación.", cause, { includeRawFallback: true }));
    } finally {
      setCaptureSavingId(null);
    }
  }

  async function closeRouteRun(run: RouteRun): Promise<void> {
    if (runSavingId) return;
    setRunSavingId(run.id);
    setCaptureError("");
    try {
      await submitRouteRun(run.id);
      setRouteActionMessage(`Ruta ${run.route_assignment} cerrada y enviada para confirmación.`);
      await reloadCaptures();
    } catch (cause) {
      setCaptureError(buildCloudErrorMessage("No se pudo cerrar la ruta.", cause, { includeRawFallback: true }));
    } finally {
      setRunSavingId(null);
    }
  }

  async function validateRouteRun(run: RouteRun): Promise<void> {
    if (!canConfirmCaptures || runSavingId) return;
    setRunSavingId(run.id);
    setCaptureError("");
    try {
      await confirmRouteRun(run.id);
      setRouteActionMessage(`Ruta ${run.route_assignment} de ${run.operator_name.split("@")[0]} confirmada.`);
      await reloadCaptures();
    } catch (cause) {
      setCaptureError(buildCloudErrorMessage("No se pudo confirmar la ruta.", cause, { includeRawFallback: true }));
    } finally {
      setRunSavingId(null);
    }
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
          <p>{workflowView === "managed" ? visibleManagedActions.length : visibleItems.length} unidades · {workflowView === "work" ? "Trabajo" : workflowView === "review" ? "Pagos por revisar" : workflowView === "custody" ? "En custodia" : workflowView === "managed" ? "Gestionados hoy" : "Cobro en ruta"}{deltaFilter ? ` · ${routeDeltaLabel(deltaFilter)}` : ""}{publishedAt ? ` | Publicada ${publishedAt}` : ""}</p>
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

      <section className="route-search-route-totals" aria-label="Carros por ruta">
        {routeTotals.map((total) => <button type="button" key={total.route} className={routeFilter === total.route ? "is-active" : ""}
          aria-pressed={routeFilter === total.route} onClick={() => toggleRouteFilter(total.route)}>
          <span><strong>Ruta {total.route}</strong><small>{workflowView === "managed" ? "Gestionados hoy" : "Carros en esta vista"}</small></span>
          <b>{total.count}</b>
        </button>)}
      </section>

      {workflowView === "work" || workflowView === "managed" ? <RouteTeamSummary actions={managedActions} activeDelta={deltaFilter}
        activeRoute={routeFilter === ALL_ACTIVE_ROUTE_FILTER ? "" : routeFilter} onDeltaChange={toggleDeltaFilter} /> : null}
      <details className="route-collection-cash-summary"><summary>Efectivo pendiente de entrega</summary><RoutePendingCashPanel payments={payments} dateKey={businessDateKey} loading={paymentsLoading} /></details>
      <div className="route-search-workflow-tabs" aria-label="Estado de las unidades">
        {([['work', 'Trabajo', workflowCounts.work], ['review', 'Pagos por revisar', workflowCounts.review], ['custody', 'En custodia', workflowCounts.custody], ['managed', 'Gestionados hoy', workflowCounts.managed]] as const).map(([view, label, count]) => (
          <button type="button" key={view} className={`button ${workflowView === view ? 'primary' : 'ghost'} route-search-workflow-tab route-search-workflow-tab--${view}${count > 0 ? ' route-search-workflow-tab--has-items' : ''}`} aria-pressed={workflowView === view}
            onClick={() => openWorkflow(view)}>
            {label} ({count})
          </button>
        ))}
      </div>
      {deltaFilter ? <div className="route-search-delta-filter" role="status">
        <div><strong>{workflowCounts.managed} carros gestionados hoy por {routeDeltaLabel(deltaFilter)}</strong>
          <span>Cobrado {managedActions.filter((action) => action.delta === deltaFilter && action.kind === "paid").length} · En custodia {managedActions.filter((action) => action.delta === deltaFilter && action.kind === "custody").length} · Ausente {managedActions.filter((action) => action.delta === deltaFilter && action.kind === "absent").length}</span></div>
        <button type="button" className="button ghost small" onClick={clearManagedDeltaFilter}>Ver todos</button>
      </div> : null}
      {reportsError ? <p className="error-text" role="alert">{reportsError}</p> : null}
      {captureError ? <p className="error-text" role="alert">{captureError}</p> : null}

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
        <div><strong>Pago gestionado · {completedCash.unit}</strong><p>{formatCurrency(completedCash.amount)} · Recibo generado. Puede confirmarle el pago al cliente.</p></div>
      </div> : null}
      {receiptError ? <p className="error-text" role="alert">{receiptError}</p> : null}
      {lastRefreshAt ? <p className="route-search-refresh">Ultima actualizacion: {lastRefreshAt}</p> : null}
      {error ? <p className="error-text">{error}</p> : null}
      {changeRouteError ? <p className="error-text" role="alert">{changeRouteError}</p> : null}
      {assignedDeltaError ? <p className="error-text" role="alert">{assignedDeltaError}</p> : null}
      {inactiveError ? <p className="error-text" role="alert">{inactiveError}</p> : null}
      {zoneError ? <p className="error-text" role="alert">{zoneError}</p> : null}
      {commentError ? <p className="error-text" role="alert">{commentError}</p> : null}
      {shareMessage ? <p className="route-search-share-message" role="status">{shareMessage}</p> : null}
      {paymentMessage ? <p className="route-search-payment-message" role="status">{paymentMessage}</p> : null}
      {routeActionMessage ? <div className="route-search-action-message" role="status">
        <span>{routeActionMessage}</span>
        {routeUndo && routeActionMessage === `${routeUndo.item.unitId} cambió a ${routeUndo.current}.` ? <button type="button" className="button ghost small" disabled={changingRoute !== null} onClick={() => void undoRouteChange()}>{changingRoute ? "Deshaciendo…" : "Deshacer"}</button> : null}
      </div> : null}
      {workflowView === "managed" ? (
        <div className="route-search-delta-toolbar route-search-managed-delta-toolbar">
          <span className="route-search-filter-label">Filtrar gestionados por Delta</span>
          <div className="route-search-filters route-search-delta-assignment-filters" aria-label="Filtrar gestionados hoy por Delta">
            <button type="button" className={deltaFilter === null ? "is-active" : ""} aria-pressed={deltaFilter === null} onClick={clearManagedDeltaFilter}>
              Todos ({managedActions.length})
            </button>
            {(["delta1", "delta2", "delta3"] as const).map((delta) => (
              <button key={delta} type="button" className={deltaFilter === delta ? "is-active" : ""} aria-pressed={deltaFilter === delta} onClick={() => toggleDeltaFilter(delta)}>
                {routeDeltaLabel(delta)} ({managedActions.filter((action) => action.delta === delta).length})
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {deltaAssignmentCounts.all > 0 && workflowView !== "managed" ? (
        <div className="route-search-delta-toolbar">
          <span className="route-search-filter-label">Delta</span>
          <div className="route-search-filters route-search-delta-assignment-filters" aria-label="Filtrar por Delta asignado">
            {(["delta1", "delta2", "delta3"] as const).map(delta => (
              <button key={delta} type="button" className={assignedDeltaFilter === delta && routeFilter === (delta === "delta2" ? "WC" : "PTY") ? "is-active" : ""} aria-pressed={assignedDeltaFilter === delta && routeFilter === (delta === "delta2" ? "WC" : "PTY")}
                onClick={() => { setAssignedDeltaFilter(delta); setRouteFilter(delta === "delta2" ? "WC" : "PTY"); setZoneFilter(ALL_ACTIVE_ZONE_FILTER); setZoneFilterLabel(""); }}>
                {signedInAssignedDelta === delta ? "Mis carros" : routeDeltaLabel(delta)} ({deltaAssignmentCounts[delta]})
              </button>
            ))}
            <button type="button" className="route-search-organize-inline" disabled={!canEditAssignedDelta}
              title={!canEditAssignedDelta ? "Los buscadores no pueden cambiar al responsable de búsqueda." : "Cambiar carros PTY entre Delta 1 y Delta 3"}
              onClick={() => setAssignmentManagerOpen(true)}>
              {!canEditAssignedDelta ? "Editar · Solo Administración" : "Editar asignación"}
            </button>
          </div>
        </div>
      ) : null}

      <details className="route-collection-filters"><summary>Filtrar por ruta y zona{routeFilter !== ALL_ACTIVE_ROUTE_FILTER ? ' · ' + activeRouteFilterLabel(routeFilter) : ''}{zoneFilterLabel ? ' · ' + zoneFilterLabel : ''}</summary>
      <div className="route-search-filter-line">
      {routeFilterOptions.length > 0 ? (
        <div className="route-search-filter-block">
          <span className="route-search-filter-label">Ruta</span>
          <div className="route-search-filters" aria-label="Filtrar por ruta">
            <button
              type="button"
              className={routeFilter === ALL_ACTIVE_ROUTE_FILTER ? "is-active" : ""}
              aria-pressed={routeFilter === ALL_ACTIVE_ROUTE_FILTER}
              onClick={() => {
                setRouteFilter(ALL_ACTIVE_ROUTE_FILTER);
                setDeltaFilter(null);
                setAssignedDeltaFilter(null);
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
                aria-pressed={routeFilter === option}
                onClick={() => {
                  setRouteFilter(option);
                  setDeltaFilter(null);
                  setAssignedDeltaFilter(null);
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

      {routeFilter !== ALL_ACTIVE_ROUTE_FILTER && workflowView !== "managed" ? (
        <div className="route-search-filter-block route-search-zone-filter-block">
          <span className="route-search-filter-label">Zona</span>
          <div className="route-search-filters route-search-zone-filters" aria-label="Filtrar por zona">
            <button
              type="button"
              className={zoneFilter === ALL_ACTIVE_ZONE_FILTER ? "is-active" : ""}
              aria-pressed={zoneFilter === ALL_ACTIVE_ZONE_FILTER}
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
                aria-pressed={zoneFilter === option.value}
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

      </div>

      </details>
      {workflowView === "managed" ? (
        visibleManagedActions.length === 0
          ? <div className="route-search-empty">No hay carros gestionados hoy con estos filtros.</div>
          : <RouteManagedList actions={visibleManagedActions} />
      ) : loading && visibleItems.length === 0 ? (
        <div className="route-search-empty">Cargando ruta...</div>
      ) : visibleItems.length === 0 ? (
        <div className="route-search-empty">{workflowView === "work" ? "No hay unidades pendientes con estos filtros." : workflowView === "review" ? "No hay pagos pendientes de revisión con estos filtros." : workflowView === "custody" ? "No hay vehículos actualmente en custodia con estos filtros." : "No hay pagos confirmados con estos filtros."}</div>
      ) : (
        <div className={`route-search-list${workflowView === "work" ? "" : " route-search-list--rows"}`}>
          {visibleItems.map((item) => {
            const activeRoute = items.find(active => active.clientId === item.clientId && active.publishedAt === item.publishedAt);
            const paidRent = routeRentAmountForDay(payments, item, businessDateKey, routeReviewIndex);
            const cardView = workflowView === "review" && item.reviewKind === "partial" ? "partial" : workflowView;
            return <RouteCollectionCard key={workflowView + '-' + (item.reviewKind ?? 'standard') + '-' + (item.report?.id ?? item.clientId)} item={item} view={cardView}
              capture={captureByRouteItem.get(`${item.clientId}\u0000${item.publishedAt}`)}
              managementFields={activeRoute && !activeRoute.removedAt && cardView !== "review" && cardView !== "confirmed" ? renderManagementFields?.(activeRoute) : undefined}
              paidRent={paidRent} balance={currentBalance(item)} travelFundBalance={travelFundBalanceByClient.get(item.clientId) ?? 0} canReport={canReportPayment} canEdit={!readOnly}
              canRemove={canRemoveFromRoute} canRegister={!readOnly && Boolean(onRegisterPayment) && (!item.report || (isPendingCashRouteReport(item.report) && !registeredReportIds.includes(item.report.id)))}
              hasPendingReport={reports.some(report => report.status === "review" && report.client_id === item.clientId && report.published_at === item.publishedAt)}
              hasActiveRoute={Boolean(activeRoute && !activeRoute.removedAt)} reportDisabled={!reportsReady}
              saving={reportSaving || paymentSaving || custodySaving || Boolean(partialDecisionSavingByClient[item.clientId]) || removeSaving}
              receiptLoading={receiptLoading === item.report?.id}
              hasReceipt={Boolean(item.report && (!item.report.bank_confirmed_visually_at || item.report.confirmed_cash_amount > 0))}
              zone={zoneDrafts[item.clientId] ?? item.zone ?? ""} zoneSaving={Boolean(zoneSavingByClient[item.clientId]) || !dataOwnerUserId}
              zoneOptions={(zoneOptionsByRoute.get(activeRouteFilterValue(item.routeAssignment)) ?? []).filter(option => option.value !== EMPTY_ACTIVE_ZONE_FILTER).map(option => option.label)}
              comment={commentDrafts[item.clientId] ?? item.comment ?? ""} commentSaving={Boolean(commentSavingByClient[item.clientId]) || !dataOwnerUserId}
              changingRoute={changingRoute !== null}
              changingAssignedDelta={changingAssignedDelta === item.clientId}
              canEditAssignedDelta={canEditAssignedDelta && Boolean(activeRoute && !activeRoute.removedAt)}
              routeOptions={routeAssignmentOptions}
              inactiveSaving={Boolean(inactiveSavingByClient[item.clientId])} elapsedNow={elapsedNow}
              canReturnReport={Boolean(item.report?.status === "review" && canConfirmBankPayment)}
              canConfirmBank={Boolean(item.report?.status === "review" && item.report.bank_amount > item.report.confirmed_bank_amount && canConfirmBankPayment && onConfirmBankPayment)}
              bankConfirmationSaving={bankConfirmationSavingId === item.report?.id}
              bankNotices={!item.report ? bankNoticesByClient.get(item.clientId) ?? [] : []}
              onReport={() => { setReportTarget(item); setReportAmount(""); setReportMethod(""); setReportCashAmount(""); setReportBankAmount(""); setReportCashTeam(operatorCollectionTeam || asCollectionTeam(item.routeAssignment)); setReportError(""); }}
              onRegister={() => openPaymentDialog(item, item.report)}
              onReceipt={() => { if (item.report) void openReportReceipt(item.report); }}
              onCustody={() => { if (activeRoute) { setCustodyTarget(activeRoute); setCustodyError(""); } }}
              onRemove={() => { setRemoveTarget(item); setRemoveError(""); }}
              onKeep={() => void keepInRouteAfterPartialPayment(item, paidRent)}
              onReturnReport={() => { if (item.report) void returnReport(item.report); }}
              onConfirmBank={() => { if (item.report) void confirmBankReport(item.report); }}
              onZone={value => { setZoneError(""); setZoneDrafts(current => ({ ...current, [item.clientId]: value })); }} onSaveZone={() => void commitZone(item)}
              onComment={value => { setCommentError(""); setCommentDrafts(current => ({ ...current, [item.clientId]: value.slice(0, 25) })); }} onSaveComment={() => void commitComment(item)}
              onRoute={route => void changeTeam(item, route)}
              onAssignedDelta={delta => void changeAssignedDelta(item, delta)}
              onCreateRoute={() => { setRouteCreateTarget(item); setRouteCreateDraft(""); setRouteCreateError(""); }}
              onInactive={() => void toggleInactive(item)} />;
          })}
        </div>
      )}

      {assignmentManagerOpen && canEditAssignedDelta ? (
        <div className="modal-overlay route-search-payment-overlay">
          <div className="modal route-assignment-manager" role="dialog" aria-modal="true" aria-labelledby="route-assignment-manager-title">
            <div className="modal-header">
              <div>
                <h2 id="route-assignment-manager-title">Organizar carros PTY</h2>
                <p>Cambia el responsable de búsqueda. Los buscadores no pueden editar esta lista.</p>
              </div>
              <button type="button" className="button ghost small" onClick={() => setAssignmentManagerOpen(false)}>Cerrar</button>
            </div>
            <div className="route-assignment-manager-summary">
              <span><strong>Delta 1</strong><b>{deltaAssignmentCounts.delta1}</b></span>
              <span><strong>Delta 3</strong><b>{deltaAssignmentCounts.delta3}</b></span>
            </div>
            <div className="route-assignment-manager-list">
              {ptyAssignedWorkItems.map(item => <label key={`${item.clientId}:${item.publishedAt}`} className="route-assignment-manager-row">
                <span><strong>{item.unitId}</strong><small>{item.clientName}</small></span>
                <select aria-label={`Cambiar responsable de ${item.unitId}`} value={item.assignedDelta ?? ""}
                  disabled={changingAssignedDelta !== null}
                  onChange={event => void changeAssignedDelta(item, event.target.value as PtyAssignedDelta)}>
                  {!item.assignedDelta ? <option value="">Sin asignar</option> : null}
                  <option value="delta1">Delta 1</option>
                  <option value="delta3" disabled={isDelta1OnlyRouteClient(item.clientName)}>Delta 3{isDelta1OnlyRouteClient(item.clientName) ? " · No permitido" : ""}</option>
                </select>
              </label>)}
            </div>
            {assignedDeltaError ? <p className="error-text" role="alert">{assignedDeltaError}</p> : null}
          </div>
        </div>
      ) : null}

      {routeCreateTarget ? (
        <div className="modal-overlay route-search-payment-overlay">
          <form className="modal route-search-payment-modal" role="dialog" aria-modal="true" aria-labelledby="route-create-title" onSubmit={(event) => { event.preventDefault(); void createRoute(); }}>
            <div className="modal-header">
              <div>
                <h2 id="route-create-title">Crear y asignar ruta</h2>
                <p>{routeCreateTarget.unitId} · {routeCreateTarget.clientName}</p>
              </div>
            </div>
            <div className="route-search-payment-form">
              <label>
                <span>Nombre de la ruta</span>
                <input
                  value={routeCreateDraft}
                  maxLength={12}
                  placeholder="Ej. CHORRERA"
                  autoFocus
                  disabled={changingRoute !== null}
                  onChange={(event) => { setRouteCreateDraft(event.target.value.toUpperCase().slice(0, 12)); setRouteCreateError(""); }}
                />
              </label>
              <p className="hint">La ruta quedará disponible en los demás selectores de esta pantalla.</p>
              {routeCreateError ? <p className="error-text" role="alert">{routeCreateError}</p> : null}
            </div>
            <div className="modal-actions">
              <button type="button" className="button ghost" disabled={changingRoute !== null} onClick={() => { setRouteCreateTarget(null); setRouteCreateDraft(""); setRouteCreateError(""); }}>Cancelar</button>
              <button type="submit" className="button primary" disabled={changingRoute !== null || !normalizeRouteAssignment(routeCreateDraft)}>{changingRoute ? "Guardando..." : "Crear y asignar"}</button>
            </div>
          </form>
        </div>
      ) : null}

      <PaymentPreviewDialog payment={receiptPreview} onClose={() => setReceiptPreview(null)} />
      {receiptOptions.length > 0 ? <div className="modal-overlay route-search-payment-overlay"><div className="modal route-search-payment-modal" role="dialog" aria-modal="true" aria-label="Recibos del pago">
        <h2>Recibos del pago</h2><p>Este reporte tiene más de un recibo asociado.</p>
        {receiptOptions.map(payment => <button className="button ghost" type="button" key={payment.id} onClick={() => { setReceiptOptions([]); setReceiptPreview(payment); }}>{payment.receiptNumber}</button>)}
        <button type="button" className="button ghost" onClick={() => setReceiptOptions([])}>Cerrar</button>
      </div></div> : null}
      {custodyTarget ? <div className="modal-overlay route-search-payment-overlay"><div className="modal route-search-payment-modal" role="dialog" aria-modal="true" aria-labelledby="route-custody-title">
        <h2 id="route-custody-title">{custodyTarget.inCustody ? "Sacar de custodia" : "Declarar carro en custodia"}</h2>
        <p>{custodyTarget.unitId} · {custodyTarget.clientName}</p>
        <p>{custodyTarget.inCustody ? "La unidad volverá a Trabajo si tiene cobros pendientes y no tiene un pago notificado." : "La unidad saldrá de Trabajo, quedará en custodia y la declaración será atribuida a tu usuario."} Se conservan los pagos y el historial. Los saldos y los cobros automáticos siguen igual.</p>
        {custodyError ? <p className="error-text" role="alert">{custodyError}</p> : null}
        <div className="modal-actions"><button type="button" className="button ghost" disabled={custodySaving} onClick={() => setCustodyTarget(null)}>Cancelar</button><button type="button" className="button primary" disabled={custodySaving} onClick={() => void changeCustody()}>{custodySaving ? "Guardando…" : "Confirmar"}</button></div>
      </div></div> : null}
      {reportTarget ? (
        <div className="modal-overlay route-search-payment-overlay">
          <form className="modal route-search-payment-modal" role="dialog" aria-modal="true" aria-labelledby="route-report-title" onSubmit={(event) => void submitReport(event)}>
            <div className="modal-header"><div><h2 id="route-report-title">Notificar pago</h2><p>{reportTarget.unitId} · {reportTarget.clientName}</p></div></div>
            <div className="route-search-payment-form">
              <label><span>Cómo pagó</span><select value={reportMethod} onChange={(event) => setReportMethod(event.target.value as "" | "cash" | "bank" | "mixed")} required autoFocus disabled={reportSaving}>
                <option value="">Seleccionar</option><option value="cash">Efectivo</option><option value="bank">Banca</option><option value="mixed">Mixto (efectivo + banca)</option>
              </select></label>
              {reportMethod === "mixed" ? <>
                <label><span>Cuánto en efectivo ($)</span><input type="number" min="0.01" max="9999999999.99" step="0.01" inputMode="decimal" value={reportCashAmount} onChange={(event) => setReportCashAmount(event.target.value)} required disabled={reportSaving} /></label>
                <label><span>Cuánto por banca ($)</span><input type="number" min="0.01" max="9999999999.99" step="0.01" inputMode="decimal" value={reportBankAmount} onChange={(event) => setReportBankAmount(event.target.value)} required disabled={reportSaving} /></label>
                <strong aria-live="polite">Total reportado: {formatCurrency((Number(reportCashAmount) || 0) + (Number(reportBankAmount) || 0))}</strong>
              </> : <label><span>Cuánto pagó ($)</span><input type="number" min="0.01" max="9999999999.99" step="0.01" inputMode="decimal" value={reportAmount} onChange={(event) => setReportAmount(event.target.value)} required disabled={reportSaving} /></label>}
              {reportMethod === "cash" || reportMethod === "mixed" ? <label><span>Equipo que recibió el efectivo</span><select value={reportCashTeam} onChange={(event) => setReportCashTeam(event.target.value as CollectionTeam | "")} required disabled={reportSaving || Boolean(operatorCollectionTeam)}>
                <option value="">Seleccionar</option><option value="PTY">PTY</option><option value="WC">WC</option>
              </select></label> : null}
              <p className="hint">{reportMethod === "cash" || reportMethod === "mixed" ? "El efectivo generará su recibo de inmediato. La parte bancaria quedará notificada hasta su confirmación." : "Se moverá a Pago notificado. El saldo cambia cuando se aplique el pago."}</p>
              {reportError ? <p className="error-text" role="alert">{reportError}</p> : null}
            </div>
            <div className="modal-actions"><button type="button" className="button ghost" disabled={reportSaving} onClick={() => setReportTarget(null)}>Cancelar</button><button type="submit" className="button primary" disabled={reportSaving}>{reportSaving ? "Enviando..." : "Notificar pago"}</button></div>
          </form>
        </div>
      ) : null}
      {paymentTarget ? (
        <div className="modal-overlay route-search-payment-overlay" onMouseDown={() => !paymentSaving && setPaymentTarget(null)}>
          <div className="modal route-search-payment-modal" role="dialog" aria-modal="true" aria-labelledby="route-payment-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2 id="route-payment-title">Generar recibo</h2>
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
              <p>{removeTarget.inCustody
                ? "La unidad saldrá de custodia y dejará de aparecer en Ruta en calle. Los pagos y el historial se conservarán."
                : "La unidad dejará de aparecer en la lista activa de cobro en ruta."}</p>
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
