import { useEffect, useRef, useState } from "react";
import ClientsPage from "./pages/ClientsPage";
import Clients20Page from "./pages/Clients20Page";
import PaymentsPage from "./pages/PaymentsPage";
import ReceivablesPage from "./pages/ReceivablesPage";
import SettingsPage from "./pages/SettingsPage";
import CashClosingPage from "./pages/CashClosingPage";
import ControlUnitsPage from "./pages/ControlUnitsPage";
import {
  loadClients,
  loadClientsFromIndexedDb,
  loadPayments,
  loadPaymentsFromIndexedDb,
  saveClients,
  savePayments,
  loadBankRules,
  loadLateFeeSettings,
  loadOtherChargesRetentionByClient,
  saveBankRules,
  saveLateFeeSettings,
  saveOtherChargesRetentionByClient,
  savePendingBankItems,
  savePendingCardItems,
  saveManualBankAssignmentAudit,
  saveLateFeeLedger,
} from "./storage";
import {
  loadCloudClients,
  loadCloudCollectionClosures,
  loadCloudPayments,
  loadCloudPaymentsRecent,
  loadCloudStreetManagement,
  normalizeCloudClient,
  saveCloudClients,
  saveCloudPayments,
  saveCloudStreetManagement,
  syncCloudStreetManagementDelta,
  syncCloudClientsDelta,
  syncCloudPaymentsDelta
} from "./cloudData";
import { supabase } from "./lib/supabase";
import { disableCloudMirror, flushCloudMirror, initializeCloudMirror } from "./cloudMirror";
import { isSupabaseOnlyMode } from "./persistenceMode";
import { analyzeBackupFileContent, type BackupImportReport } from "./backupImport";
import {
  autoBackupDetailed,
  configureBackupFolder,
  getBackupHandle,
  isAutoBackupSupported,
  removeBackupFolder,
  type BackupExtraData,
  type BackupTrigger
} from "./autobackup";
import type { BankRule, Client, LateFeeSettings, OtherChargesRetentionByClient, Payment } from "./types";
import "./styles.css";

type AppPage = "clients" | "clients_20" | "payments" | "receivables" | "control_units" | "settings" | "cash_closing";
type PendingCoreSyncSnapshot = {
  userId: string;
  token: number;
  clients: Client[];
  payments: Payment[];
  paymentsComplete?: boolean;
};

const PENDING_CORE_SYNC_KEY = "cobrapp.cloud.pending_core_sync.v1";
const CORE_DATA_FALLBACK_POLL_MS = 5 * 60_000;
const RECEIVABLES_FALLBACK_POLL_MS = 5 * 60_000;
const PERF_LOGS_ENABLED = import.meta.env.VITE_PERF_LOGS === "1";
const INITIAL_PAYMENTS_LIMIT = 300;
// IMPORTANTE: no cambiar este formato para saldos/clientes/pagos.
// Supabase debe ser la unica fuente de verdad; no rehidratar saldos desde localStorage.
const CLOUD_MIRROR_BOOTSTRAP_SKIP_KEYS = [
  "cobrapp.module1.clients.v1",
  "cobrapp.module2.payments.v1",
  "cobrapp.module3.street_management.v1",
  "cobrapp.module3.collection_closures.v1",
  "cobrapp.clients.daily_collection.v1",
  "cobrapp.clients.daily_collection_am_seals.v1",
  "cobrapp.clients.daily_collection_pm_seals.v1",
  "cobrapp.clients.daily_collection_close_seals.v1",
  "cobrapp.clients.daily_collection_promises.v1",
  "cobrapp.clients.daily_collection_street_actions.v1"
];

type AppShellProps = {
  userId?: string;
  userEmail?: string;
  appRole?: "admin" | "operador" | "lectura";
  dataOwnerUserId?: string | null;
  onSignOut?: () => void;
};

async function measureAsync<T>(label: string, task: () => Promise<T>): Promise<T> {
  if (!PERF_LOGS_ENABLED) return task();
  const startedAt = performance.now();
  try {
    return await task();
  } finally {
    const elapsedMs = Math.round(performance.now() - startedAt);
    console.info(`[Rentautos perf] ${label}: ${elapsedMs}ms`);
  }
}

export default function AppShell({ userId, userEmail, appRole = "lectura", dataOwnerUserId, onSignOut }: AppShellProps) {
  const isReadOnlyReceivables = appRole === "lectura";
  // TODO multiusuario: crear/probar un usuario "lectura" real antes de produccion.
  // Debe poder consultar el dataset asignado sin guardar cambios en ningun modulo.
  const canWriteOperationalData = appRole === "admin" || appRole === "operador";
  const canManageSettings = appRole === "admin";
  // Shared dataset mode: when a data owner is configured, all roles work on that same owner dataset.
  const cloudDataUserId = dataOwnerUserId ?? userId;
  const [page, setPage] = useState<AppPage>(isReadOnlyReceivables ? "receivables" : "clients");
  const [clients, setClients] = useState<Client[]>(() => (isSupabaseOnlyMode ? [] : loadClients()));
  const [payments, setPayments] = useState<Payment[]>(() => (isSupabaseOnlyMode ? [] : loadPayments()));
  const [bankRules, setBankRules] = useState<BankRule[]>(() => loadBankRules());
  const [lateFeeSettings, setLateFeeSettings] = useState<LateFeeSettings>(() => loadLateFeeSettings());
  const [otherChargesRetentionByClient, setOtherChargesRetentionByClient] = useState<OtherChargesRetentionByClient>(() => loadOtherChargesRetentionByClient());
  const [cloudReady, setCloudReady] = useState<boolean>(false);
  const [cloudLoadError, setCloudLoadError] = useState<string>("");
  const [syncStatus, setSyncStatus] = useState<"idle" | "syncing" | "ok" | "error">("idle");
  const [syncErrorMessage, setSyncErrorMessage] = useState<string>("");
  const [lastSyncAt, setLastSyncAt] = useState<string>("");
  const [backupSupported] = useState<boolean>(isAutoBackupSupported());
  const [backupConfigured, setBackupConfigured] = useState<boolean>(false);
  const [backupStatus, setBackupStatus] = useState<string>("Sin respaldo configurado.");
  const [backupRunning, setBackupRunning] = useState<boolean>(false);
  const [hasPendingChanges, setHasPendingChanges] = useState<boolean>(false);
  const [lastBackupAt, setLastBackupAt] = useState<string>("");
  const [lastDailyBackupKey, setLastDailyBackupKey] = useState<string>("");
  const [cloudReloadTick, setCloudReloadTick] = useState<number>(0);
  const [fullPaymentHistoryLoaded, setFullPaymentHistoryLoaded] = useState<boolean>(false);
  const [routeCollectionCount, setRouteCollectionCount] = useState<number>(0);
  const [streetManagementData, setStreetManagementData] = useState<Record<string, unknown>>({});
  const [cashPaymentPrefill, setCashPaymentPrefill] = useState<{
    dateApplied: string;
    clientId: string;
    reference: string;
    amountReceived: string;
    token: number;
  } | null>(null);
  const lastStreetManagementSnapshotRef = useRef<string>("");
  const cloudCoreReloadTimerRef = useRef<number | null>(null);
  const pendingCoreSyncRef = useRef<PendingCoreSyncSnapshot | null>(null);
  const coreSyncRetryTimerRef = useRef<number | null>(null);
  const coreSyncInFlightRef = useRef<boolean>(false);

  useEffect(() => {
    if (isReadOnlyReceivables && page !== "receivables" && page !== "control_units") {
      setPage("receivables");
      return;
    }
    if (!canManageSettings && page === "settings") {
      setPage(isReadOnlyReceivables ? "receivables" : "clients");
    }
  }, [canManageSettings, isReadOnlyReceivables, page]);

  function buildCloudErrorMessage(
    baseMessage: string,
    err: unknown,
    options?: { includeRawFallback?: boolean }
  ): string {
    const errRecord = (typeof err === "object" && err !== null ? err as Record<string, unknown> : null);
    const rawMessage =
      err instanceof Error
        ? err.message
        : typeof errRecord?.message === "string"
        ? errRecord.message
        : "";
    const rawCode = typeof errRecord?.code === "string" ? errRecord.code : "";
    const rawDetails = typeof errRecord?.details === "string" ? errRecord.details : "";
    const rawHint = typeof errRecord?.hint === "string" ? errRecord.hint : "";
    const normalized = `${rawCode} ${rawMessage} ${rawDetails} ${rawHint}`.toLowerCase();

    if (
      normalized.includes("payments_cloud_user_receipt_number_uq") ||
      normalized.includes("receiptnumber")
    ) {
      return `${baseMessage} El numero de recibo ya existe en Supabase; ejecuta la migracion 15-receipt-sequence-resync.sql y vuelve a intentar.`;
    }
    if (
      normalized.includes("payments_cloud_user_folio_uq") ||
      normalized.includes("pending_bank_items_cloud_user_folio_uq") ||
      normalized.includes("pending_card_items_cloud_user_folio_uq")
    ) {
      return `${baseMessage} El folio ya existe en Supabase.`;
    }
    if (
      normalized.includes("row-level security") ||
      normalized.includes("permission denied") ||
      normalized.includes("42501")
    ) {
      return `${baseMessage} Permisos insuficientes (RLS/owner).`;
    }
    if (
      normalized.includes("network") ||
      normalized.includes("fetch") ||
      normalized.includes("timeout")
    ) {
      return `${baseMessage} Problema de conexion/red.`;
    }
    if (
      normalized.includes("jwt") ||
      normalized.includes("token") ||
      normalized.includes("not authenticated") ||
      normalized.includes("401")
    ) {
      return `${baseMessage} Sesion expirada o no autenticada.`;
    }
    if (options?.includeRawFallback) {
      const detailBits = [rawCode, rawMessage, rawDetails, rawHint]
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
      if (detailBits.length > 0) {
        return `${baseMessage} Motivo: ${detailBits.join(" | ").slice(0, 220)}`;
      }
    }
    return baseMessage;
  }

  function serializePendingCoreSync(snapshot: PendingCoreSyncSnapshot): string {
    return JSON.stringify({
      token: snapshot.token,
      userId: snapshot.userId,
      clients: snapshot.clients,
      payments: snapshot.payments,
      paymentsComplete: snapshot.paymentsComplete === true
    });
  }

  function savePendingCoreSyncSnapshot(snapshot: PendingCoreSyncSnapshot | null): void {
    pendingCoreSyncRef.current = snapshot;
    if (!snapshot) {
      localStorage.removeItem(PENDING_CORE_SYNC_KEY);
      return;
    }
    localStorage.setItem(PENDING_CORE_SYNC_KEY, serializePendingCoreSync(snapshot));
  }

  function loadPendingCoreSyncSnapshot(): PendingCoreSyncSnapshot | null {
    const raw = localStorage.getItem(PENDING_CORE_SYNC_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (!Array.isArray(parsed.clients) || !Array.isArray(parsed.payments)) return null;
      const token = typeof parsed.token === "number" && Number.isFinite(parsed.token)
        ? parsed.token
        : Date.now();
      const ownerId = typeof parsed.userId === "string" ? parsed.userId : "";
      if (!ownerId || ownerId !== cloudDataUserId) return null;
      return {
        userId: ownerId,
        token,
        clients: parsed.clients as Client[],
        payments: parsed.payments as Payment[],
        paymentsComplete: parsed.paymentsComplete === true
      };
    } catch {
      return null;
    }
  }

  function getCloudSaveErrorMessage(err: unknown): string {
    const errRecord = (typeof err === "object" && err !== null ? err as Record<string, unknown> : null);
    const rawMessage =
      err instanceof Error
        ? err.message
        : typeof errRecord?.message === "string"
        ? errRecord.message
        : "";
    const rawCode = typeof errRecord?.code === "string" ? errRecord.code : "";
    const rawDetails = typeof errRecord?.details === "string" ? errRecord.details : "";
    const rawHint = typeof errRecord?.hint === "string" ? errRecord.hint : "";
    const normalizedMessage = `${rawCode} ${rawMessage} ${rawDetails} ${rawHint}`.toLowerCase();

    if (
      normalizedMessage.includes("payments_cloud_user_receipt_number_uq") ||
      normalizedMessage.includes("receiptnumber")
    ) {
      return "No se pudo sincronizar: el numero de recibo ya existe en la base de datos.";
    }
    if (
      normalizedMessage.includes("payments_cloud_user_folio_uq") ||
      normalizedMessage.includes("pending_bank_items_cloud_user_folio_uq") ||
      normalizedMessage.includes("pending_card_items_cloud_user_folio_uq")
    ) {
      return "No se pudo sincronizar: el folio ya existe en la base de datos.";
    }
    if (
      normalizedMessage.includes("duplicate key") ||
      normalizedMessage.includes("duplicate")
    ) {
      return "No se pudo sincronizar: hay un valor duplicado en Supabase.";
    }
    if (
      normalizedMessage.includes("row-level security") ||
      normalizedMessage.includes("permission denied") ||
      normalizedMessage.includes("42501")
    ) {
      return "No se pudo sincronizar por permisos (RLS).";
    }
    if (
      normalizedMessage.includes("network") ||
      normalizedMessage.includes("fetch") ||
      normalizedMessage.includes("timeout")
    ) {
      return "Sincronizacion pendiente por conexion lenta o inestable. Se reintentara automaticamente.";
    }
    return "Sincronizacion pendiente. Se reintentara automaticamente.";
  }

  function schedulePendingCoreSyncRetry(delayMs = 4000): void {
    if (coreSyncRetryTimerRef.current !== null) {
      window.clearTimeout(coreSyncRetryTimerRef.current);
    }
    coreSyncRetryTimerRef.current = window.setTimeout(() => {
      coreSyncRetryTimerRef.current = null;
      void flushPendingCoreSync();
    }, delayMs);
  }

  async function flushPendingCoreSync(): Promise<boolean> {
    if (!cloudDataUserId || !cloudReady) return false;
    const snapshot = pendingCoreSyncRef.current;
    if (!snapshot) return true;
    if (coreSyncInFlightRef.current) return false;

    coreSyncInFlightRef.current = true;
    try {
      setSyncStatus("syncing");
      if (snapshot.paymentsComplete) {
        await saveCloudPayments(cloudDataUserId, snapshot.payments);
      } else {
        await syncCloudPaymentsDelta(cloudDataUserId, [], snapshot.payments);
      }
      await saveCloudClients(cloudDataUserId, snapshot.clients);
      if (pendingCoreSyncRef.current?.token === snapshot.token) {
        savePendingCoreSyncSnapshot(null);
      }
      setSyncStatus("ok");
      setSyncErrorMessage("");
      setLastSyncAt(new Date().toLocaleTimeString());
      return true;
    } catch (error) {
      console.error("No se pudo sincronizar clientes/pagos pendientes en cloud.", error);
      setSyncStatus("error");
      setSyncErrorMessage(getCloudSaveErrorMessage(error));
      schedulePendingCoreSyncRetry(5000);
      return false;
    } finally {
      coreSyncInFlightRef.current = false;
    }
  }

  function queueCoreSync(nextClients: Client[], nextPayments: Payment[]): void {
    if (!cloudDataUserId) return;
    const snapshot: PendingCoreSyncSnapshot = {
      userId: cloudDataUserId,
      token: Date.now() + Math.random(),
      clients: nextClients,
      payments: nextPayments,
      paymentsComplete: fullPaymentHistoryLoaded
    };
    savePendingCoreSyncSnapshot(snapshot);
    void flushPendingCoreSync();
  }

  async function syncCoreDeltaOrQueue(
    previousClients: Client[],
    nextClients: Client[],
    previousPayments: Payment[],
    nextPayments: Payment[]
  ): Promise<void> {
    if (!cloudDataUserId) return;
    try {
      setSyncStatus("syncing");
      await syncCloudPaymentsDelta(cloudDataUserId, previousPayments, nextPayments);
      await syncCloudClientsDelta(cloudDataUserId, previousClients, nextClients);
      setSyncStatus("ok");
      setSyncErrorMessage("");
      setLastSyncAt(new Date().toLocaleTimeString());
    } catch (error) {
      if (isSupabaseOnlyMode) {
        console.error("No se pudo sincronizar delta en cloud en modo Supabase-only.", error);
        setSyncStatus("error");
        setSyncErrorMessage(buildCloudErrorMessage("No se pudo guardar en Supabase. Refresca y vuelve a intentar.", error, { includeRawFallback: true }));
        throw error;
      }
      console.error("No se pudo sincronizar delta en cloud. Se encola snapshot completo.", error);
      queueCoreSync(nextClients, nextPayments);
    }
  }

  useEffect(() => {
    if (isSupabaseOnlyMode) return;
    let cancelled = false;
    (async () => {
      try {
        const [indexedClients, indexedPayments] = await Promise.all([
          loadClientsFromIndexedDb(),
          loadPaymentsFromIndexedDb()
        ]);
        if (cancelled) return;
        if (indexedClients.length > 0) {
          setClients((current) => (current.length > 0 ? current : indexedClients));
        }
        if (indexedPayments.length > 0) {
          setPayments((current) => (current.length > 0 ? current : indexedPayments));
        }
      } catch (error) {
        console.error("No se pudo hidratar cache local desde IndexedDB.", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (isSupabaseOnlyMode) {
      savePendingCoreSyncSnapshot(null);
      return;
    }
    const pendingSnapshot = loadPendingCoreSyncSnapshot();
    if (!pendingSnapshot) return;
    pendingCoreSyncRef.current = pendingSnapshot;
    setClients(pendingSnapshot.clients);
    setPayments(pendingSnapshot.payments);
    setSyncStatus("error");
    setSyncErrorMessage("Hay cambios pendientes por sincronizar. Se reintentara automaticamente.");
  }, []);

  function parseLocalJson(key: string, fallback: unknown): unknown {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function recalculateRouteCollectionCount(source?: Record<string, unknown>): void {
    try {
      const parsed = source ?? streetManagementData;
      if (!parsed) {
        setRouteCollectionCount(0);
        return;
      }
      const values = Object.values(parsed ?? {});
      const count = values.filter((value) => {
        if (!value || typeof value !== "object") return false;
        const row = value as Record<string, unknown>;
        const type = row.managementType;
        const amount = typeof row.managementAmount === "number" ? row.managementAmount : Number(row.managementAmount);
        const hasType = type === "solo_cobrar" || type === "cobrar_o_quitar";
        return hasType && Number.isFinite(amount) && amount > 0;
      }).length;
      setRouteCollectionCount(count);
    } catch {
      setRouteCollectionCount(0);
    }
  }

  function stableSerialize(value: unknown): string {
    if (Array.isArray(value)) {
      return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
    }
    if (!value || typeof value !== "object") {
      return JSON.stringify(value);
    }
    const row = value as Record<string, unknown>;
    const keys = Object.keys(row).sort((a, b) => a.localeCompare(b));
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableSerialize(row[key])}`).join(",")}}`;
  }

  function toStreetRecordTimestamp(value: unknown): number {
    if (!value || typeof value !== "object" || Array.isArray(value)) return 0;
    const row = value as Record<string, unknown>;
    const updatedAt = typeof row.updatedAt === "string" ? Date.parse(row.updatedAt) : Number.NaN;
    const managementUpdatedAt = typeof row.managementUpdatedAt === "string" ? Date.parse(row.managementUpdatedAt) : Number.NaN;
    const updatedAtMs = Number.isFinite(updatedAt) ? updatedAt : 0;
    const managementUpdatedAtMs = Number.isFinite(managementUpdatedAt) ? managementUpdatedAt : 0;
    return Math.max(updatedAtMs, managementUpdatedAtMs);
  }

  function mergeStreetManagementByTimestamp(
    current: Record<string, unknown>,
    incoming: Record<string, unknown>
  ): Record<string, unknown> {
    const merged: Record<string, unknown> = { ...current };
    for (const [clientId, incomingValue] of Object.entries(incoming)) {
      const currentValue = merged[clientId];
      const incomingTs = toStreetRecordTimestamp(incomingValue);
      const currentTs = toStreetRecordTimestamp(currentValue);
      if (incomingTs >= currentTs) merged[clientId] = incomingValue;
    }
    return merged;
  }

  function saveCoreCache(nextClients: Client[], nextPayments: Payment[]): void {
    if (isSupabaseOnlyMode) return;
    saveClients(nextClients);
    savePayments(nextPayments);
  }

  function mergeById<T extends { id: string }>(baseRows: T[], incomingRows: T[]): T[] {
    if (baseRows.length === 0) return incomingRows;
    if (incomingRows.length === 0) return baseRows;
    const incomingById = new Map(incomingRows.map((row) => [row.id, row]));
    const merged = baseRows.map((row) => incomingById.get(row.id) ?? row);
    const baseIds = new Set(baseRows.map((row) => row.id));
    for (const row of incomingRows) {
      if (!baseIds.has(row.id)) merged.unshift(row);
    }
    return merged;
  }

  function mergePaymentsKeepingExisting(incomingRows: Payment[]): void {
    setPayments((current) => mergeById(current, incomingRows));
  }

  function repairDuplicateActiveUnits(sourceClients: Client[]): { clients: Client[]; changed: boolean; archivedCount: number; duplicateUnitCount: number } {
    const activeByUnit = new Map<string, Client[]>();
    for (const client of sourceClients) {
      const unit = client.unitId.trim().toUpperCase();
      if (!unit || client.status === "archivado") continue;
      activeByUnit.set(unit, [...(activeByUnit.get(unit) ?? []), client]);
    }

    const archiveIds = new Set<string>();
    let duplicateUnitCount = 0;
    for (const [unit, unitClients] of activeByUnit) {
      if (unitClients.length <= 1) continue;
      duplicateUnitCount += 1;
      const sorted = [...unitClients].sort((left, right) => {
        const leftTime = new Date(left.createdAt || left.archivedAt || 0).getTime();
        const rightTime = new Date(right.createdAt || right.archivedAt || 0).getTime();
        return (Number.isFinite(leftTime) ? leftTime : 0) - (Number.isFinite(rightTime) ? rightTime : 0);
      });
      const keeper = sorted[sorted.length - 1];
      for (const duplicate of sorted) {
        if (duplicate.id !== keeper.id) archiveIds.add(duplicate.id);
      }
    }

    if (archiveIds.size === 0) {
      return { clients: sourceClients, changed: false, archivedCount: 0, duplicateUnitCount };
    }

    const nowIso = new Date().toISOString();
    const clients = sourceClients.map((client) => {
      if (!archiveIds.has(client.id)) return client;
      const previousUnit = client.unitId.trim().toUpperCase();
      return {
        ...client,
        unitId: "",
        status: "archivado" as const,
        archivedAt: client.archivedAt ?? nowIso,
        statusComment: `Archivado automaticamente por duplicado de unidad ${previousUnit} el ${new Date().toLocaleDateString("es-PA")}`
      };
    });
    return { clients, changed: true, archivedCount: archiveIds.size, duplicateUnitCount };
  }

  function applyRemoteClientRow(row: unknown, eventType: string): void {
    const record = row && typeof row === "object" ? row as { id?: unknown; data?: unknown } : null;
    const id = typeof record?.id === "string" ? record.id : "";
    if (!id) return;

    setClients((current) => {
      const next =
        eventType === "DELETE"
          ? current.filter((client) => client.id !== id)
          : (() => {
              if (!record?.data || typeof record.data !== "object") return current;
              const incoming = normalizeCloudClient(record.data as Client);
              const exists = current.some((client) => client.id === incoming.id);
              return exists
                ? current.map((client) => (client.id === incoming.id ? incoming : client))
                : [incoming, ...current];
            })();
      if (next === current) return current;
      if (!isSupabaseOnlyMode) saveClients(next);
      return next;
    });
  }

  function applyRemotePaymentRow(row: unknown, eventType: string): void {
    const record = row && typeof row === "object" ? row as { id?: unknown; data?: unknown } : null;
    const id = typeof record?.id === "string" ? record.id : "";
    if (!id) return;

    setPayments((current) => {
      const next =
        eventType === "DELETE"
          ? current.filter((payment) => payment.id !== id)
          : (() => {
              if (!record?.data || typeof record.data !== "object") return current;
              const incoming = record.data as Payment;
              const exists = current.some((payment) => payment.id === incoming.id);
              return exists
                ? current.map((payment) => (payment.id === incoming.id ? incoming : payment))
                : [incoming, ...current];
            })();
      if (next === current) return current;
      if (!isSupabaseOnlyMode) savePayments(next);
      return next;
    });
  }

  function applyCoreRealtimePayload(payload: unknown, table: "clients_cloud" | "payments_cloud"): void {
    if (pendingCoreSyncRef.current) {
      setSyncStatus("syncing");
      void flushPendingCoreSync();
      return;
    }
    const event = payload && typeof payload === "object"
      ? payload as { eventType?: unknown; new?: unknown; old?: unknown }
      : null;
    const eventType = typeof event?.eventType === "string" ? event.eventType : "";
    const row = eventType === "DELETE" ? event?.old : event?.new;
    if (table === "clients_cloud") {
      applyRemoteClientRow(row, eventType);
    } else {
      applyRemotePaymentRow(row, eventType);
    }
    setSyncStatus("ok");
    setSyncErrorMessage("");
    setLastSyncAt(new Date().toLocaleTimeString());
  }

  function handleStartCashClientPayment(payload: {
    dateApplied: string;
    clientId: string;
    reference: string;
    amountReceived: string;
  }): void {
    setCashPaymentPrefill({ ...payload, token: Date.now() });
    setPage("payments");
  }

  function buildBackupExtraData(): BackupExtraData {
    return {
      seq: Number(localStorage.getItem("cobrapp.payments.seq.v1") ?? "0") || 0,
      pendingBankItems: parseLocalJson("cobrapp.module2.pending_bank.v1", []) as unknown[],
      pendingCardItems: parseLocalJson("cobrapp.module2.pending_card.v1", []) as unknown[],
      bankRules: parseLocalJson("cobrapp.settings.bank_rules.v1", []) as unknown[],
      manualAssignmentAudit: parseLocalJson("cobrapp.module2.manual_assignment_audit.v1", []) as unknown[],
      lateFeeSettings: parseLocalJson("cobrapp.settings.late_fee_settings.v1", {}) as Record<string, unknown>,
      lateFeeLedger: parseLocalJson("cobrapp.module2.late_fee_ledger.v1", []) as unknown[],
      otherChargesRetentionByClient: parseLocalJson("cobrapp.settings.other_charges_retention.v1", {}) as Record<string, unknown>,
      notifiedPayments: parseLocalJson("cobrapp.module2.notified.v1", []) as unknown[],
      cashClosings: parseLocalJson("cobrapp.module2.cash_closings.v1", []) as unknown[],
      cashClosingAudit: parseLocalJson("cobrapp.module2.cash_closing_audit.v1", []) as unknown[],
      chargeRuns: parseLocalJson("cobrapp.module2.charge_runs.v1", []) as unknown[],
      streetManagement: streetManagementData,
      statusFilter: String(localStorage.getItem("cobrapp.clients.status_filter.v1") ?? "active")
    };
  }

  async function runBackup(trigger: BackupTrigger, force = false): Promise<{ ok: boolean; message: string }> {
    if (!backupSupported) {
      return { ok: false, message: "Este navegador no soporta respaldo automatico local." };
    }
    if (!force && !hasPendingChanges && trigger !== "manual") {
      return { ok: true, message: "No habia cambios pendientes; respaldo omitido." };
    }
    setBackupRunning(true);
    try {
      const result = await autoBackupDetailed(clients, payments, buildBackupExtraData(), trigger);
      setBackupStatus(result.message);
      if (result.ok) {
        setHasPendingChanges(false);
        setLastBackupAt(new Date().toLocaleString("es-PA"));
      }
      return { ok: result.ok, message: result.message };
    } finally {
      setBackupRunning(false);
    }
  }

  useEffect(() => {
    if (!cloudDataUserId) return;
    let cancelled = false;

    (async () => {
      try {
        const localClientsFallback = isSupabaseOnlyMode ? [] : loadClients();
        const localPaymentsFallback = isSupabaseOnlyMode ? [] : loadPayments();
        setCloudReady(false);
        setCloudLoadError("");
        setSyncErrorMessage("");
        setSyncStatus("syncing");
        void measureAsync("cloud mirror bootstrap", () =>
          initializeCloudMirror(cloudDataUserId, { skipKeys: CLOUD_MIRROR_BOOTSTRAP_SKIP_KEYS })
        ).catch((error) => {
          console.error("No se pudo inicializar cloud mirror.", error);
        });
        const [cloudClientsData, cloudPaymentsData, cloudStreetManagement, cloudCollectionClosures] =
          await measureAsync("initial cloud core load", () => Promise.all([
            measureAsync("load clients", () => loadCloudClients(cloudDataUserId)),
            measureAsync("load recent payments", () => loadCloudPaymentsRecent(cloudDataUserId, INITIAL_PAYMENTS_LIMIT)),
            measureAsync("load street management", () => loadCloudStreetManagement(cloudDataUserId)),
            measureAsync("load collection closures", () => loadCloudCollectionClosures(cloudDataUserId))
          ]));
        if (cancelled) return;
        const bootstrapClients =
          isSupabaseOnlyMode
            ? cloudClientsData
            : cloudClientsData.length > 0
            ? mergeById((clients.length > 0 ? clients : localClientsFallback), cloudClientsData)
            : (clients.length > 0 ? clients : localClientsFallback);
        const duplicateRepair = repairDuplicateActiveUnits(bootstrapClients);
        const bootstrapPayments =
          isSupabaseOnlyMode
            ? cloudPaymentsData
            : cloudPaymentsData.length > 0
            ? mergeById((payments.length > 0 ? payments : localPaymentsFallback), cloudPaymentsData)
            : (payments.length > 0 ? payments : localPaymentsFallback);
        if (duplicateRepair.changed) {
          await saveCloudClients(cloudDataUserId, duplicateRepair.clients);
          console.warn(
            `[Cobrapp] Reparados ${duplicateRepair.archivedCount} cliente(s) duplicado(s) en ${duplicateRepair.duplicateUnitCount} unidad(es).`
          );
        }
        setClients(duplicateRepair.clients);
        setPayments(bootstrapPayments);
        setFullPaymentHistoryLoaded(false);
        setBankRules(loadBankRules());
        setLateFeeSettings(loadLateFeeSettings());
        setOtherChargesRetentionByClient(loadOtherChargesRetentionByClient());
        // Mantiene cache local opcional cuando no estamos en modo estricto nube.
        saveCoreCache(duplicateRepair.clients, bootstrapPayments);
        setStreetManagementData(cloudStreetManagement);
        lastStreetManagementSnapshotRef.current = stableSerialize(cloudStreetManagement);
        localStorage.setItem("cobrapp.module3.collection_closures.v1", JSON.stringify(cloudCollectionClosures));
        recalculateRouteCollectionCount(cloudStreetManagement);
        setSyncStatus("ok");
        setSyncErrorMessage("");
        setLastSyncAt(new Date().toLocaleTimeString());
        setCloudReady(true);
      } catch (err) {
        console.error("No se pudo cargar data cloud.", err);
        setSyncStatus("error");
        setSyncErrorMessage(buildCloudErrorMessage("Fallo la sincronizacion inicial con nube.", err, { includeRawFallback: true }));
        setCloudLoadError("No se pudo cargar la data de nube. Verifica conexion e intenta de nuevo.");
        setCloudReady(true);
      }
    })();

    return () => {
      cancelled = true;
      disableCloudMirror();
    };
  }, [cloudDataUserId, cloudReloadTick, isReadOnlyReceivables]);

  useEffect(() => {
    recalculateRouteCollectionCount(streetManagementData);
  }, [streetManagementData]);

  useEffect(() => {
    if (!cloudDataUserId || !cloudReady || !supabase) return;
    let cancelled = false;

    const reloadCloudCoreData = async () => {
      if (pendingCoreSyncRef.current) {
        setSyncStatus("syncing");
        void flushPendingCoreSync();
        return;
      }
      try {
        const [cloudClientsData, cloudPaymentsData] = await measureAsync("fallback core reload", () => Promise.all([
          measureAsync("reload clients", () => loadCloudClients(cloudDataUserId)),
          measureAsync("reload recent payments", () => loadCloudPaymentsRecent(cloudDataUserId, INITIAL_PAYMENTS_LIMIT))
        ]));
        if (cancelled) return;
        const duplicateRepair = repairDuplicateActiveUnits(cloudClientsData);
        if (duplicateRepair.changed) {
          await saveCloudClients(cloudDataUserId, duplicateRepair.clients);
          console.warn(
            `[Cobrapp] Reparados ${duplicateRepair.archivedCount} cliente(s) duplicado(s) en ${duplicateRepair.duplicateUnitCount} unidad(es).`
          );
        }
        setClients(duplicateRepair.clients);
        mergePaymentsKeepingExisting(cloudPaymentsData);
        saveCoreCache(duplicateRepair.clients, cloudPaymentsData);
        setSyncStatus("ok");
        setSyncErrorMessage("");
        setLastSyncAt(new Date().toLocaleTimeString());
      } catch (error) {
        console.error("No se pudo refrescar clientes/pagos desde nube.", error);
        if (!cancelled) {
          setSyncStatus("error");
          setSyncErrorMessage(buildCloudErrorMessage("Fallo el refresco de clientes/pagos desde nube.", error, { includeRawFallback: true }));
        }
      }
    };

    const channel = supabase
      .channel(`clients-core-live-${cloudDataUserId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "clients_cloud",
          filter: `user_id=eq.${cloudDataUserId}`
        },
        (payload) => applyCoreRealtimePayload(payload, "clients_cloud")
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "payments_cloud",
          filter: `user_id=eq.${cloudDataUserId}`
        },
        (payload) => applyCoreRealtimePayload(payload, "payments_cloud")
      )
      .subscribe();

    const fallbackTimer = window.setInterval(() => {
      if (document.hidden) return;
      void reloadCloudCoreData();
    }, CORE_DATA_FALLBACK_POLL_MS);

    return () => {
      cancelled = true;
      if (cloudCoreReloadTimerRef.current !== null) {
        window.clearTimeout(cloudCoreReloadTimerRef.current);
        cloudCoreReloadTimerRef.current = null;
      }
      window.clearInterval(fallbackTimer);
      void supabase.removeChannel(channel);
    };
  }, [cloudDataUserId, cloudReady]);

  useEffect(() => {
    const handleOnline = () => {
      void flushPendingCoreSync();
    };
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("online", handleOnline);
      if (coreSyncRetryTimerRef.current !== null) {
        window.clearTimeout(coreSyncRetryTimerRef.current);
        coreSyncRetryTimerRef.current = null;
      }
    };
  }, [cloudDataUserId, cloudReady]);

  useEffect(() => {
    if (!cloudDataUserId || !cloudReady || !supabase) return;

    const channel = supabase
      .channel(`receivables-live-${cloudDataUserId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "street_management_cloud",
          filter: `user_id=eq.${cloudDataUserId}`
        },
        (payload) => {
          const row = payload.new as { data?: unknown } | null;
          const data = row?.data;
          if (!data || typeof data !== "object" || Array.isArray(data)) return;
          const nextData = data as Record<string, unknown>;
          setStreetManagementData((current) => {
            const mergedData = mergeStreetManagementByTimestamp(current, nextData);
            const incomingSnapshot = stableSerialize(mergedData);
            if (incomingSnapshot === lastStreetManagementSnapshotRef.current) return current;
            lastStreetManagementSnapshotRef.current = incomingSnapshot;
            recalculateRouteCollectionCount(mergedData);
            return mergedData;
          });
          setLastSyncAt(new Date().toLocaleTimeString());
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "collection_closures_cloud",
          filter: `user_id=eq.${cloudDataUserId}`
        },
        (payload) => {
          const row = payload.new as { data?: unknown } | null;
          const data = row?.data;
          if (!data || typeof data !== "object" || Array.isArray(data)) return;
          localStorage.setItem("cobrapp.module3.collection_closures.v1", JSON.stringify(data));
          setLastSyncAt(new Date().toLocaleTimeString());
        }
      )
      .subscribe();

    // Fallback poll in case realtime is briefly interrupted.
    const fallbackTimer = window.setInterval(() => {
      if (document.hidden) return;
      void (async () => {
        try {
          const [streetManagement, collectionClosures] = await Promise.all([
            loadCloudStreetManagement(cloudDataUserId),
            loadCloudCollectionClosures(cloudDataUserId)
          ]);
          setStreetManagementData((current) => {
            const mergedData = mergeStreetManagementByTimestamp(current, streetManagement);
            const incomingSnapshot = stableSerialize(mergedData);
            if (incomingSnapshot !== lastStreetManagementSnapshotRef.current) {
              lastStreetManagementSnapshotRef.current = incomingSnapshot;
              recalculateRouteCollectionCount(mergedData);
              return mergedData;
            }
            return current;
          });
          localStorage.setItem("cobrapp.module3.collection_closures.v1", JSON.stringify(collectionClosures));
        } catch (error) {
          console.error("No se pudo refrescar Cobro en Ruta desde nube.", error);
        }
      })();
    }, RECEIVABLES_FALLBACK_POLL_MS);

    return () => {
      window.clearInterval(fallbackTimer);
      void supabase.removeChannel(channel);
    };
  }, [cloudDataUserId, cloudReady]);

  useEffect(() => {
    if (!cloudDataUserId || !cloudReady) return;
    let syncTimer: number | null = null;
    const handleSyncPing = () => {
      setSyncStatus("syncing");
      if (syncTimer !== null) window.clearTimeout(syncTimer);
      syncTimer = window.setTimeout(() => {
        setSyncStatus("ok");
        setSyncErrorMessage("");
        setLastSyncAt(new Date().toLocaleTimeString());
      }, 250);
    };
    window.addEventListener("cobrapp:cloud-sync-ping", handleSyncPing);
    return () => {
      window.removeEventListener("cobrapp:cloud-sync-ping", handleSyncPing);
      if (syncTimer !== null) window.clearTimeout(syncTimer);
    };
  }, [cloudDataUserId, cloudReady]);

  useEffect(() => {
    if (!backupSupported) return;
    let mounted = true;
    (async () => {
      const handle = await getBackupHandle();
      if (!mounted) return;
      setBackupConfigured(!!handle);
      if (!handle) {
        setBackupStatus("Sin respaldo configurado.");
        return;
      }
      setBackupStatus("Respaldo configurado.");
    })();
    return () => {
      mounted = false;
    };
  }, [backupSupported]);

  useEffect(() => {
    if (!backupSupported) return;
    const timer = window.setInterval(() => {
      const now = new Date();
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Panama",
        hour12: false,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
      }).formatToParts(now);
      const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
      const dateKey = `${get("year")}-${get("month")}-${get("day")}`;
      const hour = get("hour");
      const minute = get("minute");
      if (hour === "17" && minute === "00" && lastDailyBackupKey !== dateKey) {
        setLastDailyBackupKey(dateKey);
        void runBackup("daily_5pm_pa", false);
      }
    }, 30000);
    return () => window.clearInterval(timer);
  }, [backupSupported, lastDailyBackupKey, hasPendingChanges, clients, payments]);

  async function persistClients(next: Client[]): Promise<void> {
    if (!canWriteOperationalData) return;
    const previousClients = clients;
    const previousPayments = payments;
    setClients(next);
    try {
      if (cloudDataUserId) {
        await syncCoreDeltaOrQueue(previousClients, next, previousPayments, previousPayments);
      }
      if (!isSupabaseOnlyMode) saveClients(next);
      setHasPendingChanges(true);
    } catch (error) {
      setClients(previousClients);
      throw error;
    }
  }

  async function persistPayments(next: Payment[]): Promise<void> {
    if (!canWriteOperationalData) return;
    const previousClients = clients;
    const previousPayments = payments;
    setPayments(next);
    if (cloudDataUserId) {
      void syncCoreDeltaOrQueue(previousClients, previousClients, previousPayments, next);
    }
    if (!isSupabaseOnlyMode) savePayments(next);
    setHasPendingChanges(true);
  }

  async function refreshPaymentsFromSource(): Promise<void> {
    if (pendingCoreSyncRef.current) {
      const flushed = await flushPendingCoreSync();
      if (!flushed) {
        throw new Error("No se pudieron sincronizar los cambios pendientes.");
      }
    }

    setSyncStatus("syncing");
    try {
      let refreshedPayments: Payment[];
      let usedRecentFallback = false;
      if (cloudDataUserId) {
        try {
          refreshedPayments = await measureAsync("manual payments refresh", () => loadCloudPayments(cloudDataUserId));
          setFullPaymentHistoryLoaded(true);
        } catch (error) {
          console.error("No se pudo cargar historial completo; se intentara cargar pagos recientes.", error);
          refreshedPayments = await measureAsync("manual recent payments fallback", () => loadCloudPaymentsRecent(cloudDataUserId, INITIAL_PAYMENTS_LIMIT));
          usedRecentFallback = true;
          setFullPaymentHistoryLoaded(false);
        }
      } else {
        const indexedPayments = await loadPaymentsFromIndexedDb();
        refreshedPayments = indexedPayments.length > 0 ? indexedPayments : loadPayments();
        setFullPaymentHistoryLoaded(true);
      }

      setPayments(refreshedPayments);
      if (!isSupabaseOnlyMode) savePayments(refreshedPayments);
      setSyncStatus("ok");
      setSyncErrorMessage(usedRecentFallback ? "No se pudo cargar el historial completo; se cargaron pagos recientes." : "");
      setLastSyncAt(new Date().toLocaleTimeString());
    } catch (error) {
      console.error("No se pudo actualizar manualmente el historial de pagos.", error);
      setSyncStatus("error");
      setSyncErrorMessage(buildCloudErrorMessage("Fallo la actualización manual de pagos.", error, { includeRawFallback: true }));
      throw error;
    }
  }

  async function persistClientsAndPayments(nextClients: Client[], nextPayments: Payment[]): Promise<boolean> {
    if (!canWriteOperationalData) return false;
    const previousClients = clients;
    const previousPayments = payments;
    if (cloudDataUserId && isSupabaseOnlyMode) {
      setSyncStatus("syncing");
      try {
        await syncCoreDeltaOrQueue(previousClients, nextClients, previousPayments, nextPayments);
      } catch (error) {
        console.error("No se pudo guardar clientes/pagos en Supabase.", error);
        setClients(previousClients);
        setPayments(previousPayments);
        throw error;
      }
      setClients(nextClients);
      setPayments(nextPayments);
      setHasPendingChanges(true);
      return true;
    }

    setClients(nextClients);
    setPayments(nextPayments);
    if (cloudDataUserId) void syncCoreDeltaOrQueue(previousClients, nextClients, previousPayments, nextPayments);
    if (!isSupabaseOnlyMode) {
      saveClients(nextClients);
      savePayments(nextPayments);
    }
    setHasPendingChanges(true);
    return true;
  }

  function persistBankRules(next: BankRule[]): void {
    if (!canManageSettings) return;
    setBankRules(next);
    saveBankRules(next);
    setHasPendingChanges(true);
  }

  function persistLateFeeSettings(next: LateFeeSettings): void {
    if (!canManageSettings) return;
    setLateFeeSettings(next);
    saveLateFeeSettings(next);
    setHasPendingChanges(true);
  }

  function persistOtherChargesRetentionByClient(next: OtherChargesRetentionByClient): void {
    if (!canManageSettings) return;
    setOtherChargesRetentionByClient(next);
    saveOtherChargesRetentionByClient(next);
    setHasPendingChanges(true);
  }

  async function persistStreetManagement(next: Record<string, unknown>): Promise<boolean> {
    if (!canWriteOperationalData) return false;
    if (!cloudDataUserId || !cloudReady) {
      setStreetManagementData(next);
      recalculateRouteCollectionCount(next);
      setHasPendingChanges(true);
      return true;
    }
    try {
      const mergedNext = mergeStreetManagementByTimestamp(streetManagementData, next);
      setSyncStatus("syncing");
      await syncCloudStreetManagementDelta(cloudDataUserId, streetManagementData, mergedNext);
      lastStreetManagementSnapshotRef.current = stableSerialize(mergedNext);
      setStreetManagementData(mergedNext);
      recalculateRouteCollectionCount(mergedNext);
      setHasPendingChanges(true);
      setSyncStatus("ok");
      setSyncErrorMessage("");
      setLastSyncAt(new Date().toLocaleTimeString());
      return true;
    } catch (error) {
      console.error("No se pudo guardar Estado Cobranza en cloud.", error);
      setSyncStatus("error");
      setSyncErrorMessage("No se pudo guardar Estado Cobranza en nube. Se mantiene local y se reintentara.");
      return false;
    }
  }

  async function validateBackupFile(file: File): Promise<BackupImportReport> {
    const content = await file.text();
    return analyzeBackupFileContent(file.name, content);
  }

  async function applyBackupImport(report: BackupImportReport): Promise<{ ok: boolean; message: string }> {
    if (!canManageSettings) {
      return { ok: false, message: "Solo admin puede importar respaldos." };
    }
    if (!report.compatible) {
      return { ok: false, message: "El respaldo no es compatible. Corrige los errores e intenta otra vez." };
    }

    try {
      const clientsRaw = report.normalizedData["cobrapp.module1.clients.v1"];
      const paymentsRaw = report.normalizedData["cobrapp.module2.payments.v1"];
      const clientsNext = Array.isArray(clientsRaw) ? (clientsRaw as Client[]) : [];
      const paymentsNext = Array.isArray(paymentsRaw) ? (paymentsRaw as Payment[]) : [];

      await persistClients(clientsNext);
      await persistPayments(paymentsNext);

      const bankRulesRaw = report.normalizedData["cobrapp.settings.bank_rules.v1"];
      persistBankRules(Array.isArray(bankRulesRaw) ? (bankRulesRaw as BankRule[]) : []);

      const lateFeeRaw = report.normalizedData["cobrapp.settings.late_fee_settings.v1"];
      persistLateFeeSettings((lateFeeRaw && typeof lateFeeRaw === "object" ? lateFeeRaw : {}) as LateFeeSettings);

      const otherChargesRaw = report.normalizedData["cobrapp.settings.other_charges_retention.v1"];
      persistOtherChargesRetentionByClient(
        (otherChargesRaw && typeof otherChargesRaw === "object" ? otherChargesRaw : {}) as OtherChargesRetentionByClient
      );

      savePendingBankItems(Array.isArray(report.normalizedData["cobrapp.module2.pending_bank.v1"]) ? report.normalizedData["cobrapp.module2.pending_bank.v1"] as never[] : []);
      savePendingCardItems(Array.isArray(report.normalizedData["cobrapp.module2.pending_card.v1"]) ? report.normalizedData["cobrapp.module2.pending_card.v1"] as never[] : []);
      saveManualBankAssignmentAudit(Array.isArray(report.normalizedData["cobrapp.module2.manual_assignment_audit.v1"]) ? report.normalizedData["cobrapp.module2.manual_assignment_audit.v1"] as never[] : []);
      saveLateFeeLedger(Array.isArray(report.normalizedData["cobrapp.module2.late_fee_ledger.v1"]) ? report.normalizedData["cobrapp.module2.late_fee_ledger.v1"] as never[] : []);

      localStorage.setItem("cobrapp.module2.notified.v1", JSON.stringify(report.normalizedData["cobrapp.module2.notified.v1"] ?? []));
      localStorage.setItem("cobrapp.module2.cash_closings.v1", JSON.stringify(report.normalizedData["cobrapp.module2.cash_closings.v1"] ?? []));
      localStorage.setItem("cobrapp.module2.cash_closing_audit.v1", JSON.stringify(report.normalizedData["cobrapp.module2.cash_closing_audit.v1"] ?? []));
      localStorage.setItem("cobrapp.module2.charge_runs.v1", JSON.stringify(report.normalizedData["cobrapp.module2.charge_runs.v1"] ?? []));
      localStorage.setItem("cobrapp.module3.street_management.v1", JSON.stringify(report.normalizedData["cobrapp.module3.street_management.v1"] ?? {}));
      localStorage.setItem("cobrapp.payments.seq.v1", String(Number(report.normalizedData["cobrapp.payments.seq.v1"] ?? 0) || 0));
      localStorage.setItem("cobrapp.clients.status_filter.v1", String(report.normalizedData["cobrapp.clients.status_filter.v1"] ?? ""));
      setHasPendingChanges(true);

      return { ok: true, message: "Respaldo importado correctamente. Ya puedes continuar con la migracion cloud." };
    } catch (error) {
      console.error("Fallo importando respaldo.", error);
      return { ok: false, message: "No se pudo importar el respaldo completo. Revisa consola y vuelve a intentar." };
    }
  }

  async function handleConfigureBackupFolder(): Promise<{ ok: boolean; message: string }> {
    if (!backupSupported) return { ok: false, message: "Este navegador no soporta respaldo local." };
    const handle = await configureBackupFolder();
    if (!handle) return { ok: false, message: "No se pudo configurar carpeta (cancelado o sin permisos)." };
    setBackupConfigured(true);
    setBackupStatus("Carpeta de respaldo configurada.");
    return { ok: true, message: "Carpeta de respaldo configurada." };
  }

  async function handleDisconnectBackupFolder(): Promise<{ ok: boolean; message: string }> {
    await removeBackupFolder();
    setBackupConfigured(false);
    setBackupStatus("Respaldo local desconectado.");
    return { ok: true, message: "Respaldo local desconectado." };
  }

  async function handleSignOutWithBackup(): Promise<void> {
    if (cloudDataUserId && !isReadOnlyReceivables) {
      try {
        setSyncStatus("syncing");
        await flushPendingCoreSync();
        await flushCloudMirror();
        setSyncStatus("ok");
        setLastSyncAt(new Date().toLocaleTimeString());
      } catch (error) {
        console.error("No se pudo completar la sincronizacion final antes de cerrar sesion.", error);
        setSyncStatus("error");
        setSyncErrorMessage("No se cerro sesion porque fallo la sincronizacion final.");
        setBackupStatus("No se cerro sesion: fallo la sincronizacion final con nube. Intenta nuevamente.");
        window.alert("No se cerro sesion porque fallo la sincronizacion final con nube. Revisa tu conexion e intenta nuevamente.");
        return;
      }
    }
    await runBackup("signout", false);
    await onSignOut?.();
  }

  return (
    <>
      <nav className="app-nav">
        <div className="app-nav-inner">
          <span className="app-nav-brand">Rentautos</span>
          <div className="app-nav-tabs">
            {canWriteOperationalData && (
              <button
                type="button"
                className={`nav-tab ${page === "clients" ? "nav-tab--active" : ""}`}
                onClick={() => setPage("clients")}
              >
                Clientes
              </button>
            )}
            {canWriteOperationalData && (
              <button
                type="button"
                className={`nav-tab ${page === "clients_20" ? "nav-tab--active" : ""}`}
                onClick={() => setPage("clients_20")}
              >
                Clientes 2.0
              </button>
            )}
            {canWriteOperationalData && (
              <button
                type="button"
                className={`nav-tab ${page === "payments" ? "nav-tab--active" : ""}`}
                onClick={() => setPage("payments")}
              >
                Pagos
              </button>
            )}
            <button
              type="button"
              className={`nav-tab ${page === "receivables" ? "nav-tab--active" : ""}`}
              onClick={() => setPage("receivables")}
            >
              Cuentas por Cobrar
              {routeCollectionCount > 0 && <span className="nav-tab-badge">Ruta: {routeCollectionCount}</span>}
            </button>
            <button
              type="button"
              className={`nav-tab ${page === "control_units" ? "nav-tab--active" : ""}`}
              onClick={() => setPage("control_units")}
            >
              Autos
            </button>
            {canManageSettings && (
              <button
                type="button"
                className={`nav-tab ${page === "settings" ? "nav-tab--active" : ""}`}
                onClick={() => setPage("settings")}
              >
                Configuraciones
              </button>
            )}
            {canWriteOperationalData && (
              <button
                type="button"
                className={`nav-tab ${page === "cash_closing" ? "nav-tab--active" : ""}`}
                onClick={() => setPage("cash_closing")}
              >
                Cuadre de Caja
              </button>
            )}
          </div>

          <div className="backup-nav-zone">
            <span className="hint">
              Estado nube:{" "}
              {syncStatus === "syncing"
                ? "Sincronizando..."
                : syncStatus === "ok"
                ? "En nube"
                : syncStatus === "error"
                ? "Error"
                : "Listo"}
            </span>
            {lastSyncAt && (
              <span className="hint" style={{ marginLeft: 8 }}>
                Ultima sync: {lastSyncAt}
              </span>
            )}
            {syncStatus === "error" && syncErrorMessage && (
              <span className="hint" style={{ marginLeft: 8, color: "#b42318" }}>
                {syncErrorMessage}
              </span>
            )}
          </div>

          {onSignOut && (
            <div className="backup-nav-zone auth-nav-zone">
              {userEmail && <span className="hint">{userEmail}</span>}
              <button
                type="button"
                className="nav-backup-btn nav-backup-btn--setup"
                onClick={() => void handleSignOutWithBackup()}
                title="Cerrar sesion"
              >
                Cerrar sesion
              </button>
            </div>
          )}
        </div>
      </nav>
      <main className="page">
        {page === "clients" && canWriteOperationalData && (
          <ClientsPage
            clients={clients}
            payments={payments}
            onPaymentsChange={persistPayments}
            onClientsChange={persistClients}
            dataOwnerUserId={cloudDataUserId}
          />
        )}
        {page === "payments" && canWriteOperationalData && (
          <PaymentsPage
            clients={clients}
            bankRules={bankRules}
            lateFeeSettings={lateFeeSettings}
            otherChargesRetentionByClient={otherChargesRetentionByClient}
            onClientsChange={persistClients}
            payments={payments}
            onPaymentsChange={persistPayments}
            onPersistClientPayment={persistClientsAndPayments}
            dataOwnerUserId={cloudDataUserId}
            isPaymentHistoryLoaded={fullPaymentHistoryLoaded}
            onRefreshPayments={refreshPaymentsFromSource}
            onCashClose={() => void runBackup("cash_closing", true)}
            quickCashPrefill={cashPaymentPrefill}
            onQuickCashPrefillConsumed={() => setCashPaymentPrefill(null)}
          />
        )}
        {page === "clients_20" && canWriteOperationalData && (
          <Clients20Page clients={clients} dataOwnerUserId={cloudDataUserId} />
        )}
        {page === "receivables" && (
          <ReceivablesPage
            clients={clients}
            payments={payments}
            hideCollectedThisMonth={isReadOnlyReceivables}
            streetManagementData={streetManagementData}
            onStreetManagementPersist={persistStreetManagement}
          />
        )}
        {page === "control_units" && (
          <ControlUnitsPage
            dataOwnerUserId={cloudDataUserId}
            readOnly={isReadOnlyReceivables}
            clients={clients}
          />
        )}
        {page === "settings" && canManageSettings && (
          <SettingsPage
            bankRules={bankRules}
            clients={clients}
            lateFeeSettings={lateFeeSettings}
            otherChargesRetentionByClient={otherChargesRetentionByClient}
            onBankRulesChange={persistBankRules}
            onLateFeeSettingsChange={persistLateFeeSettings}
            onOtherChargesRetentionByClientChange={persistOtherChargesRetentionByClient}
            onValidateBackupFile={validateBackupFile}
            onApplyBackupImport={applyBackupImport}
            onManualBackup={() => runBackup("manual", true)}
            onConfigureBackupFolder={handleConfigureBackupFolder}
            onDisconnectBackupFolder={handleDisconnectBackupFolder}
            backupSupported={backupSupported}
            backupConfigured={backupConfigured}
            backupRunning={backupRunning}
            backupStatus={backupStatus}
            hasPendingChanges={hasPendingChanges}
            lastBackupAt={lastBackupAt}
          />
        )}
        {page === "cash_closing" && canWriteOperationalData && (
          <CashClosingPage
            clients={clients}
            payments={payments}
            appRole={appRole}
            dataOwnerUserId={cloudDataUserId}
            onStartCashClientPayment={handleStartCashClientPayment}
          />
        )}
      </main>
    </>
  );
}
