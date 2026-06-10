import { useEffect, useRef, useState } from "react";
import ClientsPage from "./pages/ClientsPage";
import Clients20Page from "./pages/Clients20Page";
import PaymentsPage from "./pages/PaymentsPage";
import SettingsPage from "./pages/SettingsPage";
import CashClosingPage from "./pages/CashClosingPage";
import ControlUnitsPage from "./pages/ControlUnitsPage";
import CollisionsPage from "./pages/CollisionsPage";
import {
  dedupePaymentsByReceiptNumber,
  savePendingBankItems,
  savePendingCardItems,
  saveManualBankAssignmentAudit,
  saveLateFeeLedger,
} from "./storage";
import {
  loadCloudCollectionRows,
  loadCloudSingletonData,
  loadCloudClients,
  loadCloudClientsPage,
  loadCloudCollectionClosures,
  loadCloudPayments,
  loadCloudPaymentsPage,
  loadCloudStreetManagement,
  saveCloudClients,
  saveCloudPayments,
  saveCloudStreetManagement,
  flushCloudSyncQueue,
  syncCloudStreetManagementDelta,
  loadCloudCollisions,
  saveCloudCollisions,
  loadCloudCollisionsSettings,
  saveCloudCollisionsSettings
} from "./cloudData";
import {
  countPendingCloudSyncItems,
  listCloudSyncItems,
  loadQueuedCloudPayload
} from "./cloudOffline";
import { saveCloudSnapshot } from "./cloudOffline";
import { supabase } from "./lib/supabase";
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
import type { BankRule, Client, CollisionRecord, CollisionsSettings, LateFeeSettings, OtherChargesRetentionByClient, Payment } from "./types";
import "./styles.css";

type AppPage = "clients" | "clients_20" | "payments" | "control_units" | "settings" | "cash_closing" | "collisions";
const INITIAL_CLOUD_BOOTSTRAP_LIMIT = 200;
const CORE_DATA_FALLBACK_POLL_MS = 180_000;
const RECEIVABLES_FALLBACK_POLL_MS = 300_000;
const PREFERRED_BOOTSTRAP_GROUP = "T";
const TELEGRAM_SENT_ALERTS_KEY = "cobrapp.module4.collisions.telegram_sent.v1";
const telegramSentAlertIds = new Set<string>();

type AppShellProps = {
  userId?: string;
  userEmail?: string;
  appRole?: "admin" | "operador" | "lectura";
  dataOwnerUserId?: string | null;
  onSignOut?: () => void;
};

export default function AppShell({ userId, userEmail, appRole = "lectura", dataOwnerUserId, onSignOut }: AppShellProps) {
  const isReadOnlyReceivables = appRole === "lectura";
  // Shared dataset mode: when a data owner is configured, all roles work on that same owner dataset.
  const cloudDataUserId = dataOwnerUserId ?? userId;
  const [page, setPage] = useState<AppPage>("clients");
  const [clients, setClients] = useState<Client[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [bankRules, setBankRules] = useState<BankRule[]>([]);
  const [lateFeeSettings, setLateFeeSettings] = useState<LateFeeSettings>({
    active: false,
    dailyAmount: 5,
    chargeLabel: "RECARGO POR TARDANZA DE PAGO",
    selectedUnits: []
  });
  const [otherChargesRetentionByClient, setOtherChargesRetentionByClient] = useState<OtherChargesRetentionByClient>({});
  const [cloudReady, setCloudReady] = useState<boolean>(false);
  const [cloudLoadError, setCloudLoadError] = useState<string>("");
  const [syncStatus, setSyncStatus] = useState<"idle" | "syncing" | "ok" | "error" | "pending">("idle");
  const [syncErrorMessage, setSyncErrorMessage] = useState<string>("");
  const [lastSyncAt, setLastSyncAt] = useState<string>("");
  const [pendingSyncCount, setPendingSyncCount] = useState<number>(0);
  const [pendingSyncItems, setPendingSyncItems] = useState<Array<{
    id: string;
    entity_type: string;
    entity_id: string;
    action: string;
    status: string;
    retry_count: number;
    last_error: string;
    created_at: string;
    updated_at: string;
  }>>([]);
  const [backupSupported] = useState<boolean>(isAutoBackupSupported());
  const [backupConfigured, setBackupConfigured] = useState<boolean>(false);
  const [backupStatus, setBackupStatus] = useState<string>("Sin respaldo configurado.");
  const [backupRunning, setBackupRunning] = useState<boolean>(false);
  const [hasPendingChanges, setHasPendingChanges] = useState<boolean>(false);
  const [lastBackupAt, setLastBackupAt] = useState<string>("");
  const [lastDailyBackupKey, setLastDailyBackupKey] = useState<string>("");
  const [cloudReloadTick, setCloudReloadTick] = useState<number>(0);
  const [routeCollectionCount, setRouteCollectionCount] = useState<number>(0);
  const [isProgressiveCloudLoading, setIsProgressiveCloudLoading] = useState<boolean>(false);
  const [streetManagementData, setStreetManagementData] = useState<Record<string, unknown>>({});
  const [collisions, setCollisions] = useState<CollisionRecord[]>([]);
  const [collisionsSettings, setCollisionsSettings] = useState<CollisionsSettings>({});
  const [cashPaymentPrefill, setCashPaymentPrefill] = useState<{
    dateApplied: string;
    clientId: string;
    reference: string;
    amountReceived: string;
    token: number;
  } | null>(null);
  const lastStreetManagementSnapshotRef = useRef<string>("");
  const cloudCoreReloadTimerRef = useRef<number | null>(null);
  const cloudSyncFlushInFlightRef = useRef<boolean>(false);
  const coreRealtimeSubscribedRef = useRef<boolean>(false);
  const receivablesRealtimeSubscribedRef = useRef<boolean>(false);
  const lastTelegramSweepMinuteRef = useRef<string>("");

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
      normalizedMessage.includes("payments_cloud_user_folio_uq") ||
      normalizedMessage.includes("duplicate key") ||
      normalizedMessage.includes("duplicate")
    ) {
      return "No se pudo sincronizar: el folio ya existe en la base de datos.";
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

  async function refreshPendingSyncStatus(): Promise<number> {
    if (!cloudDataUserId) return 0;
    const pendingCount = await countPendingCloudSyncItems(cloudDataUserId);
    setPendingSyncCount(pendingCount);
    setSyncStatus(pendingCount > 0 ? "pending" : "ok");
    setSyncErrorMessage(pendingCount > 0 ? "Hay cambios pendientes por sincronizar." : "");
    return pendingCount;
  }

  async function refreshPendingSyncItems(): Promise<void> {
    if (!cloudDataUserId) {
      setPendingSyncItems([]);
      return;
    }
    try {
      const items = await listCloudSyncItems(cloudDataUserId);
      setPendingSyncItems(items);
    } catch (error) {
      console.error("No se pudo leer el detalle de la cola cloud.", error);
      setPendingSyncItems([]);
    }
  }

  async function flushCloudQueueSafely(): Promise<number> {
    if (!cloudDataUserId) return 0;
    if (cloudSyncFlushInFlightRef.current) return 0;
    cloudSyncFlushInFlightRef.current = true;
    try {
      setSyncStatus("syncing");
      const processed = await flushCloudSyncQueue(cloudDataUserId);
      await refreshPendingSyncStatus();
      await refreshPendingSyncItems();
      return processed;
    } finally {
      cloudSyncFlushInFlightRef.current = false;
    }
  }

  useEffect(() => {
    if (!cloudDataUserId) return;
    let cancelled = false;
    void (async () => {
      try {
        const [cloudRows, cloudSettings] = await Promise.all([
          loadCloudCollisions(cloudDataUserId),
          loadCloudCollisionsSettings(cloudDataUserId)
        ]);
        if (cancelled) return;
        if (Array.isArray(cloudRows) && cloudRows.length > 0) {
          setCollisions(cloudRows);
        }
        if (cloudSettings) {
          setCollisionsSettings(cloudSettings);
        }
      } catch (error) {
        console.error("No se pudo cargar Colisiones desde nube.", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cloudDataUserId]);

  function parseLocalJson(_key: string, fallback: unknown): unknown {
    return fallback;
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

  function isPreferredBootstrapGroupClient(client: Client): boolean {
    const unit = (client.unitId ?? "").trim().toUpperCase();
    return unit.startsWith(PREFERRED_BOOTSTRAP_GROUP);
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
      seq: 0,
      pendingBankItems: [],
      pendingCardItems: [],
      bankRules: [],
      manualAssignmentAudit: [],
      lateFeeSettings: {},
      lateFeeLedger: [],
      otherChargesRetentionByClient: {},
      notifiedPayments: [],
      cashClosings: [],
      cashClosingAudit: [],
      chargeRuns: [],
      streetManagement: streetManagementData,
      collisions,
      collisionsSettings,
      statusFilter: "active"
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
        setCloudReady(false);
        setCloudLoadError("");
        setSyncErrorMessage("");
        setSyncStatus("syncing");
        setIsProgressiveCloudLoading(true);
        const [
          cloudClientsData,
          cloudPaymentsData,
          cloudStreetManagement,
          cloudCollectionClosures,
          cloudBankRules,
          cloudLateFeeSettings,
          cloudOtherChargesRetention
        ] = await Promise.all([
          appRole === "admin"
            ? loadCloudClients(cloudDataUserId)
            : loadCloudClientsPage(cloudDataUserId, { limit: INITIAL_CLOUD_BOOTSTRAP_LIMIT }),
          appRole === "admin"
            ? loadCloudPayments(cloudDataUserId)
            : loadCloudPaymentsPage(cloudDataUserId, { limit: INITIAL_CLOUD_BOOTSTRAP_LIMIT }),
          loadCloudStreetManagement(cloudDataUserId),
          loadCloudCollectionClosures(cloudDataUserId),
          loadCloudCollectionRows<BankRule>("bank_rules_cloud", cloudDataUserId),
          loadCloudSingletonData<LateFeeSettings>("late_fee_settings_cloud", cloudDataUserId),
          loadCloudSingletonData<OtherChargesRetentionByClient>("other_charges_retention_cloud", cloudDataUserId)
        ]);
        if (cancelled) return;
        const bootstrapClients =
          appRole === "admin"
            ? cloudClientsData
            : cloudClientsData.filter((client) => isPreferredBootstrapGroupClient(client));
        setClients(bootstrapClients);
        setPayments(dedupePaymentsByReceiptNumber(cloudPaymentsData));
        setBankRules(cloudBankRules);
        setLateFeeSettings(cloudLateFeeSettings ?? {
          active: false,
          dailyAmount: 5,
          chargeLabel: "RECARGO POR TARDANZA DE PAGO",
          selectedUnits: []
        });
        setOtherChargesRetentionByClient(cloudOtherChargesRetention ?? {});
        setStreetManagementData(cloudStreetManagement);
        lastStreetManagementSnapshotRef.current = stableSerialize(cloudStreetManagement);
        recalculateRouteCollectionCount(cloudStreetManagement);
        const [queuedClientsRaw, queuedPaymentsRaw] = await Promise.all([
          loadQueuedCloudPayload(cloudDataUserId, "collection", "clients_cloud", "upsert"),
          loadQueuedCloudPayload(cloudDataUserId, "collection", "payments_cloud", "upsert")
        ]);
        if (queuedClientsRaw) {
          try {
            setClients(JSON.parse(queuedClientsRaw) as Client[]);
          } catch {
            // ignore malformed queue payloads
          }
        }
        if (queuedPaymentsRaw) {
          try {
            setPayments(dedupePaymentsByReceiptNumber(JSON.parse(queuedPaymentsRaw) as Payment[]));
          } catch {
            // ignore malformed queue payloads
          }
        }
        const pendingCount = await countPendingCloudSyncItems(cloudDataUserId);
        setPendingSyncCount(pendingCount);
        setSyncStatus(pendingCount > 0 ? "pending" : "ok");
        setSyncErrorMessage(pendingCount > 0 ? "Hay cambios pendientes por sincronizar." : "");
        setLastSyncAt(new Date().toLocaleTimeString());
        setCloudReady(true);

        // Carga completa en segundo plano para no bloquear la interfaz.
        void (async () => {
          try {
            const [fullClients, fullPayments] = await Promise.all([
              loadCloudClients(cloudDataUserId),
              loadCloudPayments(cloudDataUserId)
            ]);
            if (cancelled) return;
            setClients(fullClients);
            setPayments(dedupePaymentsByReceiptNumber(fullPayments));
            setLastSyncAt(new Date().toLocaleTimeString());
          } catch (error) {
            console.error("No se pudo completar la carga progresiva total.", error);
          } finally {
            if (!cancelled) setIsProgressiveCloudLoading(false);
          }
        })();
      } catch (err) {
        console.error("No se pudo cargar data cloud.", err);
        setSyncStatus("error");
        setSyncErrorMessage(buildCloudErrorMessage("Fallo la sincronizacion inicial con nube.", err, { includeRawFallback: true }));
        setCloudLoadError("No se pudo cargar la data de nube. Verifica conexion e intenta de nuevo.");
        setCloudReady(true);
        setIsProgressiveCloudLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      setIsProgressiveCloudLoading(false);
    };
  }, [cloudDataUserId, cloudReloadTick, isReadOnlyReceivables]);

  useEffect(() => {
    recalculateRouteCollectionCount(streetManagementData);
  }, [streetManagementData]);

  useEffect(() => {
    if (!cloudDataUserId || !cloudReady || !supabase) return;
    let cancelled = false;

    const reloadCloudCoreData = async () => {
      try {
        const [cloudClientsData, cloudPaymentsData] = await Promise.all([
          loadCloudClients(cloudDataUserId),
          loadCloudPayments(cloudDataUserId)
        ]);
        if (cancelled) return;
        setClients(cloudClientsData);
        setPayments(dedupePaymentsByReceiptNumber(cloudPaymentsData));
        const pendingCount = await countPendingCloudSyncItems(cloudDataUserId);
        setPendingSyncCount(pendingCount);
        setSyncStatus(pendingCount > 0 ? "pending" : "ok");
        setSyncErrorMessage(pendingCount > 0 ? "Hay cambios pendientes por sincronizar." : "");
        setLastSyncAt(new Date().toLocaleTimeString());
      } catch (error) {
        console.error("No se pudo refrescar clientes/pagos desde nube.", error);
        if (!cancelled) {
          setSyncStatus("error");
          setSyncErrorMessage(buildCloudErrorMessage("Fallo el refresco de clientes/pagos desde nube.", error, { includeRawFallback: true }));
        }
      }
    };

    const applyClientRowDelta = (payload: { eventType?: string; new?: unknown; old?: unknown }) => {
      const eventType = payload.eventType ?? "";
      const oldRow = payload.old as { id?: unknown } | null;
      const newRow = payload.new as { id?: unknown; data?: unknown } | null;
      const oldId = typeof oldRow?.id === "string" ? oldRow.id : "";
      const newId = typeof newRow?.id === "string" ? newRow.id : "";
      if (eventType === "DELETE" && oldId) {
        setClients((current) => current.filter((item) => item.id !== oldId));
        return;
      }
      if (!newId || !newRow || !newRow.data || typeof newRow.data !== "object" || Array.isArray(newRow.data)) return;
      setClients((current) => {
        const incoming = newRow.data as Client;
        const idx = current.findIndex((item) => item.id === newId);
        let next: Client[];
        if (idx < 0) {
          next = [incoming, ...current];
        } else {
          next = [...current];
          next[idx] = incoming;
        }
        return next;
      });
    };

    const applyPaymentRowDelta = (payload: { eventType?: string; new?: unknown; old?: unknown }) => {
      const eventType = payload.eventType ?? "";
      const oldRow = payload.old as { id?: unknown } | null;
      const newRow = payload.new as { id?: unknown; data?: unknown } | null;
      const oldId = typeof oldRow?.id === "string" ? oldRow.id : "";
      const newId = typeof newRow?.id === "string" ? newRow.id : "";
      if (eventType === "DELETE" && oldId) {
        setPayments((current) => current.filter((item) => item.id !== oldId));
        return;
      }
      if (!newId || !newRow || !newRow.data || typeof newRow.data !== "object" || Array.isArray(newRow.data)) return;
      setPayments((current) => {
        const incoming = newRow.data as Payment;
        const idx = current.findIndex((item) => item.id === newId);
        let next: Payment[];
        if (idx < 0) {
          next = [incoming, ...current];
        } else {
          next = [...current];
          next[idx] = incoming;
        }
        return next;
      });
    };

    const scheduleReload = () => {
      setSyncStatus("syncing");
      if (cloudCoreReloadTimerRef.current !== null) {
        window.clearTimeout(cloudCoreReloadTimerRef.current);
      }
      cloudCoreReloadTimerRef.current = window.setTimeout(() => {
        cloudCoreReloadTimerRef.current = null;
        void reloadCloudCoreData();
      }, 400);
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
        (payload) => {
          applyClientRowDelta(payload as { eventType?: string; new?: unknown; old?: unknown });
          setSyncStatus("ok");
          setSyncErrorMessage("");
          setLastSyncAt(new Date().toLocaleTimeString());
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "payments_cloud",
          filter: `user_id=eq.${cloudDataUserId}`
        },
        (payload) => {
          applyPaymentRowDelta(payload as { eventType?: string; new?: unknown; old?: unknown });
          setSyncStatus("ok");
          setSyncErrorMessage("");
          setLastSyncAt(new Date().toLocaleTimeString());
        }
      )
      .subscribe((status) => {
        coreRealtimeSubscribedRef.current = status === "SUBSCRIBED";
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          scheduleReload();
        }
      });

    const fallbackTimer = window.setInterval(() => {
      if (document.hidden) return;
      if (coreRealtimeSubscribedRef.current) return;
      void reloadCloudCoreData();
    }, CORE_DATA_FALLBACK_POLL_MS);

    return () => {
      cancelled = true;
      if (cloudCoreReloadTimerRef.current !== null) {
        window.clearTimeout(cloudCoreReloadTimerRef.current);
        cloudCoreReloadTimerRef.current = null;
      }
      coreRealtimeSubscribedRef.current = false;
      window.clearInterval(fallbackTimer);
      void supabase.removeChannel(channel);
    };
  }, [cloudDataUserId, cloudReady]);

  useEffect(() => {
    const handleOnline = () => {
      if (!cloudDataUserId) return;
      void (async () => {
        try {
          await flushCloudQueueSafely();
          setLastSyncAt(new Date().toLocaleTimeString());
        } catch (error) {
          console.error("No se pudo vaciar la cola cloud.", error);
          setSyncStatus("error");
          setSyncErrorMessage(getCloudSaveErrorMessage(error));
        }
      })();
    };
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("online", handleOnline);
    };
  }, [cloudDataUserId, cloudReady]);

  useEffect(() => {
    if (!cloudDataUserId || !cloudReady) return;
    let cancelled = false;
    const tick = async () => {
      try {
        await flushCloudQueueSafely();
        if (cancelled) return;
        await refreshPendingSyncItems();
      } catch (error) {
        console.error("No se pudo revisar la cola cloud.", error);
      }
    };
    void tick();
    const timer = window.setInterval(() => {
      void tick();
    }, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
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
          void saveCloudSnapshot(cloudDataUserId, "singleton:collection_closures_cloud", data);
          setLastSyncAt(new Date().toLocaleTimeString());
        }
      )
      .subscribe((status) => {
        receivablesRealtimeSubscribedRef.current = status === "SUBSCRIBED";
      });

    // Fallback poll in case realtime is briefly interrupted.
    const fallbackTimer = window.setInterval(() => {
      if (document.hidden) return;
      if (receivablesRealtimeSubscribedRef.current) return;
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
          void saveCloudSnapshot(cloudDataUserId, "singleton:collection_closures_cloud", collectionClosures);
        } catch (error) {
          console.error("No se pudo refrescar Cobro en Ruta desde nube.", error);
        }
      })();
    }, RECEIVABLES_FALLBACK_POLL_MS);

    return () => {
      window.clearInterval(fallbackTimer);
      receivablesRealtimeSubscribedRef.current = false;
      void supabase.removeChannel(channel);
    };
  }, [cloudDataUserId, cloudReady]);

  useEffect(() => {
    void refreshPendingSyncItems();
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
    const canSend = appRole === "admin" && collisionsSettings.telegramEnabled &&
      collisionsSettings.telegramBotToken.trim().length > 0 &&
      collisionsSettings.telegramChatId.trim().length > 0;
    if (!canSend) return;

    function asDateOnly(value: string): string {
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) return "";
      return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()).toISOString().slice(0, 10);
    }

    function dayDiff(dateIsoLike: string): number | null {
      const target = asDateOnly(dateIsoLike);
      const today = asDateOnly(new Date().toISOString());
      if (!target || !today) return null;
      const targetMs = Date.parse(`${target}T00:00:00`);
      const todayMs = Date.parse(`${today}T00:00:00`);
      if (!Number.isFinite(targetMs) || !Number.isFinite(todayMs)) return null;
      return Math.round((targetMs - todayMs) / 86_400_000);
    }

    function loadSentMap(): Record<string, true> {
      const next: Record<string, true> = {};
      for (const id of telegramSentAlertIds) next[id] = true;
      return next;
    }

    function saveSentMap(value: Record<string, true>): void {
      telegramSentAlertIds.clear();
      for (const id of Object.keys(value)) telegramSentAlertIds.add(id);
    }

    async function runSweep(): Promise<void> {
      const minuteKey = new Date().toISOString().slice(0, 16);
      if (minuteKey === lastTelegramSweepMinuteRef.current) return;
      lastTelegramSweepMinuteRef.current = minuteKey;

      const sentMap = loadSentMap();
      const daysBefore = Array.from(new Set((collisionsSettings.reminderDaysBefore ?? []).filter((d) => Number.isFinite(d))));
      for (const reminder of listCollisionReminderCandidates()) {
        const days = dayDiff(reminder.date);
        if (days === null || !daysBefore.includes(days)) continue;
        const reminderDateOnly = asDateOnly(reminder.date);
        const id = `${reminder.id}|${reminder.label}|${reminderDateOnly}|${days}`;
        if (sentMap[id]) continue;
        try {
          const whenText = days === 0 ? "hoy" : `en ${days} dia(s)`;
          const message = `Rentautos Colisiones\nUnidad ${reminder.unitId}\n${reminder.label}: ${reminderDateOnly}\nRecordatorio: ${whenText}`;
          const response = await fetch(`https://api.telegram.org/bot${collisionsSettings.telegramBotToken}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: collisionsSettings.telegramChatId,
              text: message
            })
          });
          if (!response.ok) continue;
          sentMap[id] = true;
          saveSentMap(sentMap);
        } catch (error) {
          console.error("No se pudo enviar alerta de Colisiones a Telegram.", error);
        }
      }
    }

    void runSweep();
    const timer = window.setInterval(() => { void runSweep(); }, 60_000);
    return () => window.clearInterval(timer);
  }, [appRole, collisions, collisionsSettings]);

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
    if (isReadOnlyReceivables) return;
    setClients(next);
    setHasPendingChanges(true);
    if (!cloudDataUserId) return;
    try {
      setSyncStatus("syncing");
      await saveCloudClients(cloudDataUserId, next);
      await refreshPendingSyncStatus();
      setLastSyncAt(new Date().toLocaleTimeString());
    } catch (error) {
      console.error("No se pudo sincronizar clientes en cloud.", error);
      setSyncStatus("error");
      setSyncErrorMessage(getCloudSaveErrorMessage(error));
      await refreshPendingSyncStatus();
    }
  }

  async function persistPayments(next: Payment[]): Promise<void> {
    if (isReadOnlyReceivables) return;
    const normalizedPayments = dedupePaymentsByReceiptNumber(next);
    setPayments(normalizedPayments);
    setHasPendingChanges(true);
    if (!cloudDataUserId) return;
    try {
      setSyncStatus("syncing");
      await saveCloudPayments(cloudDataUserId, normalizedPayments);
      await refreshPendingSyncStatus();
      setLastSyncAt(new Date().toLocaleTimeString());
    } catch (error) {
      console.error("No se pudo sincronizar pagos en cloud.", error);
      setSyncStatus("error");
      setSyncErrorMessage(getCloudSaveErrorMessage(error));
      await refreshPendingSyncStatus();
    }
  }

  async function persistClientsAndPayments(nextClients: Client[], nextPayments: Payment[]): Promise<boolean> {
    if (isReadOnlyReceivables) return false;
    setClients(nextClients);
    const normalizedPayments = dedupePaymentsByReceiptNumber(nextPayments);
    setPayments(normalizedPayments);
    setHasPendingChanges(true);
    if (!cloudDataUserId) return true;
    try {
      setSyncStatus("syncing");
      await Promise.all([
        saveCloudClients(cloudDataUserId, nextClients),
        saveCloudPayments(cloudDataUserId, normalizedPayments)
      ]);
      await refreshPendingSyncStatus();
      setLastSyncAt(new Date().toLocaleTimeString());
      return true;
    } catch (error) {
      console.error("No se pudo sincronizar clientes/pagos en cloud.", error);
      setSyncStatus("error");
      setSyncErrorMessage(getCloudSaveErrorMessage(error));
      await refreshPendingSyncStatus();
      return false;
    }
  }

  function persistBankRules(next: BankRule[]): void {
    setBankRules(next);
    setHasPendingChanges(true);
    if (cloudDataUserId) {
      void (async () => {
        try {
          setSyncStatus("syncing");
          await saveCloudCollectionRows("bank_rules_cloud", cloudDataUserId, next);
          await refreshPendingSyncStatus();
          setLastSyncAt(new Date().toLocaleTimeString());
        } catch (error) {
          console.error("No se pudo sincronizar reglas bancarias en cloud.", error);
          setSyncStatus("error");
          setSyncErrorMessage(getCloudSaveErrorMessage(error));
          await refreshPendingSyncStatus();
        }
      })();
    }
  }

  function persistLateFeeSettings(next: LateFeeSettings): void {
    setLateFeeSettings(next);
    setHasPendingChanges(true);
    if (cloudDataUserId) {
      void (async () => {
        try {
          setSyncStatus("syncing");
          await saveCloudSingletonData("late_fee_settings_cloud", cloudDataUserId, next);
          await refreshPendingSyncStatus();
          setLastSyncAt(new Date().toLocaleTimeString());
        } catch (error) {
          console.error("No se pudo sincronizar configuracion de mora en cloud.", error);
          setSyncStatus("error");
          setSyncErrorMessage(getCloudSaveErrorMessage(error));
          await refreshPendingSyncStatus();
        }
      })();
    }
  }

  function persistOtherChargesRetentionByClient(next: OtherChargesRetentionByClient): void {
    setOtherChargesRetentionByClient(next);
    setHasPendingChanges(true);
    if (cloudDataUserId) {
      void (async () => {
        try {
          setSyncStatus("syncing");
          await saveCloudSingletonData("other_charges_retention_cloud", cloudDataUserId, next);
          await refreshPendingSyncStatus();
          setLastSyncAt(new Date().toLocaleTimeString());
        } catch (error) {
          console.error("No se pudo sincronizar retenciones de otros cargos en cloud.", error);
          setSyncStatus("error");
          setSyncErrorMessage(getCloudSaveErrorMessage(error));
          await refreshPendingSyncStatus();
        }
      })();
    }
  }

  async function persistStreetManagement(next: Record<string, unknown>): Promise<boolean> {
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

  async function persistCollisions(next: CollisionRecord[]): Promise<void> {
    setCollisions(next);
    setHasPendingChanges(true);
    if (!cloudDataUserId || !cloudReady) return;
    try {
      setSyncStatus("syncing");
      await saveCloudCollisions(cloudDataUserId, next);
      await refreshPendingSyncStatus();
      setSyncStatus("ok");
      setSyncErrorMessage("");
      setLastSyncAt(new Date().toLocaleTimeString());
    } catch (error) {
      console.error("No se pudo sincronizar Colisiones en nube.", error);
      setSyncStatus("error");
      setSyncErrorMessage(getCloudSaveErrorMessage(error));
      await refreshPendingSyncStatus();
    }
  }

  async function persistCollisionsSettings(next: CollisionsSettings): Promise<void> {
    setCollisionsSettings(next);
    if (!cloudDataUserId || !cloudReady) return;
    try {
      setSyncStatus("syncing");
      await saveCloudCollisionsSettings(cloudDataUserId, next);
      await refreshPendingSyncStatus();
      setSyncStatus("ok");
      setSyncErrorMessage("");
    } catch (error) {
      console.error("No se pudo sincronizar configuracion de Colisiones en nube.", error);
      setSyncStatus("error");
      setSyncErrorMessage(getCloudSaveErrorMessage(error));
      await refreshPendingSyncStatus();
    }
  }

  function listCollisionReminderCandidates(): Array<{ id: string; date: string; unitId: string; label: string }> {
    const rows: Array<{ id: string; date: string; unitId: string; label: string }> = [];
    for (const item of collisions) {
      rows.push({ id: item.id, date: item.hearingAt, unitId: item.unitId, label: "Juicio" });
      if (item.resolutionDate) rows.push({ id: item.id, date: item.resolutionDate, unitId: item.unitId, label: "Resolucion" });
      if (item.resolutionWithdrawalDate) rows.push({ id: item.id, date: item.resolutionWithdrawalDate, unitId: item.unitId, label: "Retiro de resolucion" });
      if (item.outcome === "ganado" && item.insurerRecoveryStatus !== "pagado" && item.insurerInvoiceDate) {
        rows.push({ id: item.id, date: item.insurerInvoiceDate, unitId: item.unitId, label: "Seguimiento aseguradora" });
      }
      if (item.outcome === "perdido" && item.driverChargeStatus !== "cobrado" && item.resolutionDate) {
        rows.push({ id: item.id, date: item.resolutionDate, unitId: item.unitId, label: "Cobro conductor" });
      }
    }
    return rows;
  }

  async function validateBackupFile(file: File): Promise<BackupImportReport> {
    const content = await file.text();
    return analyzeBackupFileContent(file.name, content);
  }

  async function applyBackupImport(report: BackupImportReport): Promise<{ ok: boolean; message: string }> {
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

      setCollisions(Array.isArray(report.normalizedData["cobrapp.module4.collisions.v1"]) ? report.normalizedData["cobrapp.module4.collisions.v1"] as CollisionRecord[] : []);
      setCollisionsSettings((report.normalizedData["cobrapp.module4.collisions_settings.v1"] && typeof report.normalizedData["cobrapp.module4.collisions_settings.v1"] === "object")
        ? report.normalizedData["cobrapp.module4.collisions_settings.v1"] as CollisionsSettings
        : {});
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
        await flushCloudQueueSafely();
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
            <button
              type="button"
              className={`nav-tab ${page === "clients" ? "nav-tab--active" : ""}`}
              onClick={() => setPage("clients")}
            >
              Clientes
            </button>
            <button
              type="button"
              className={`nav-tab ${page === "clients_20" ? "nav-tab--active" : ""}`}
              onClick={() => setPage("clients_20")}
            >
              Clientes 2.0
            </button>
            <button
              type="button"
              className={`nav-tab ${page === "payments" ? "nav-tab--active" : ""}`}
              onClick={() => setPage("payments")}
            >
              Pagos
            </button>
            <button
              type="button"
              className={`nav-tab ${page === "control_units" ? "nav-tab--active" : ""}`}
              onClick={() => setPage("control_units")}
            >
              Autos
            </button>
            <button
              type="button"
              className={`nav-tab ${page === "collisions" ? "nav-tab--active" : ""}`}
              onClick={() => setPage("collisions")}
            >
              Gestion de siniestros
            </button>
            <button
              type="button"
              className={`nav-tab ${page === "settings" ? "nav-tab--active" : ""}`}
              onClick={() => setPage("settings")}
            >
              Configuraciones
            </button>
            <button
              type="button"
              className={`nav-tab ${page === "cash_closing" ? "nav-tab--active" : ""}`}
              onClick={() => setPage("cash_closing")}
            >
              Cuadre de Caja
            </button>
          </div>

          <div className="backup-nav-zone">
            <span className="hint">
              Estado nube:{" "}
              {syncStatus === "syncing"
                ? "Sincronizando..."
                : syncStatus === "pending"
                ? "Pendientes por subir"
                : syncStatus === "ok"
                ? "En nube"
                : syncStatus === "error"
                ? "Error"
                : "Listo"}
            </span>
            {pendingSyncCount > 0 && (
              <details style={{ marginLeft: 8, display: "inline-block" }}>
                <summary className="hint" style={{ cursor: "pointer" }}>
                  Pendientes: {pendingSyncCount}
                </summary>
                <div
                  style={{
                    marginTop: 8,
                    padding: 12,
                    minWidth: 420,
                    maxWidth: 760,
                    background: "rgba(255,255,255,0.96)",
                    border: "1px solid rgba(15,23,42,0.12)",
                    borderRadius: 12,
                    boxShadow: "0 12px 28px rgba(15,23,42,0.12)",
                    color: "#0f172a"
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Detalle de pendientes</div>
                  {pendingSyncItems.length === 0 ? (
                    <div className="hint">No hay detalle disponible por ahora.</div>
                  ) : (
                    <div style={{ display: "grid", gap: 10 }}>
                      {pendingSyncItems.slice(0, 12).map((item) => (
                        <div
                          key={item.id}
                          style={{
                            padding: 10,
                            borderRadius: 10,
                            background: "#f8fafc",
                            border: "1px solid rgba(15,23,42,0.08)"
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12 }}>
                            <strong>{item.entity_type}</strong>
                            <span>{item.action}</span>
                          </div>
                          <div style={{ fontSize: 12, marginTop: 4, wordBreak: "break-word" }}>
                            <span style={{ fontWeight: 600 }}>ID:</span> {item.entity_id}
                          </div>
                          <div style={{ fontSize: 12, marginTop: 4 }}>
                            <span style={{ fontWeight: 600 }}>Intentos:</span> {item.retry_count}
                          </div>
                          <div style={{ fontSize: 12, marginTop: 4 }}>
                            <span style={{ fontWeight: 600 }}>Estado:</span> {item.status}
                          </div>
                          {item.status === "rejected" && (
                            <div style={{ fontSize: 12, marginTop: 4, color: "#7c2d12", fontWeight: 600 }}>
                              Rechazado definitivamente. No se volvera a reintentar.
                            </div>
                          )}
                          {item.last_error && (
                            <div style={{ fontSize: 12, marginTop: 4, color: "#b42318" }}>
                              <span style={{ fontWeight: 600 }}>Error:</span> {item.last_error}
                            </div>
                          )}
                          <div style={{ fontSize: 11, marginTop: 4, color: "#475569" }}>
                            Creado: {item.created_at}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </details>
            )}
            {lastSyncAt && (
              <span className="hint" style={{ marginLeft: 8 }}>
                Ultima sync: {lastSyncAt}
              </span>
            )}
            {isProgressiveCloudLoading && (
              <span className="hint" style={{ marginLeft: 8 }}>
                Cargando mas datos...
              </span>
            )}
            {syncStatus === "error" && syncErrorMessage && (
              <span className="hint" style={{ marginLeft: 8, color: "#b42318" }}>
                {syncErrorMessage}
              </span>
            )}
            {cloudLoadError && (
              <span className="hint" style={{ marginLeft: 8, color: "#b42318" }}>
                {cloudLoadError}
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
        {page === "clients" && (
          <ClientsPage
            clients={clients}
            payments={payments}
            onPaymentsChange={persistPayments}
            onClientsChange={persistClients}
            dataOwnerUserId={cloudDataUserId}
          />
        )}
        {page === "payments" && (
          <PaymentsPage
            clients={clients}
            bankRules={bankRules}
            lateFeeSettings={lateFeeSettings}
            otherChargesRetentionByClient={otherChargesRetentionByClient}
            dataOwnerUserId={cloudDataUserId}
            onClientsChange={persistClients}
            payments={payments}
            onPaymentsChange={persistPayments}
            onPersistClientPayment={persistClientsAndPayments}
            onCashClose={() => void runBackup("cash_closing", true)}
            quickCashPrefill={cashPaymentPrefill}
            onQuickCashPrefillConsumed={() => setCashPaymentPrefill(null)}
          />
        )}
        {page === "clients_20" && (
          <Clients20Page clients={clients} dataOwnerUserId={cloudDataUserId} />
        )}
        {page === "control_units" && (
          <ControlUnitsPage
            dataOwnerUserId={cloudDataUserId}
            readOnly={isReadOnlyReceivables}
            clients={clients}
          />
        )}
        {page === "settings" && (
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
        {page === "collisions" && (
          <CollisionsPage
            clients={clients}
            collisions={collisions}
            settings={collisionsSettings}
            canEdit={appRole === "admin"}
            dataOwnerUserId={cloudDataUserId}
            onCollisionsChange={persistCollisions}
            onSettingsChange={persistCollisionsSettings}
          />
        )}
        {page === "cash_closing" && (
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
