import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  loadCloudClients,
  loadCloudPayments,
  loadCloudPaymentsRecent,
  normalizeCloudClient,
  saveCloudClients,
  saveCloudPayments,
  syncCloudClientsDelta,
  syncCloudPaymentsDelta
} from "../cloudData";
import { disableCloudMirror, initializeCloudMirror } from "../cloudMirror";
import { supabase } from "../lib/supabase";
import { isSupabaseOnlyMode } from "../persistenceMode";
import {
  loadClients,
  loadClientsFromIndexedDb,
  loadPayments,
  loadPaymentsFromIndexedDb,
  saveClients,
  savePayments
} from "../storage";
import type { Client, Payment } from "../types";
import {
  buildCloudErrorMessage,
  getCloudSaveErrorMessage,
  mergeById,
  parsePendingCoreSync,
  repairDuplicateActiveUnits,
  serializePendingCoreSync,
  type PendingCoreSyncSnapshot
} from "./appShellRules";

const PENDING_CORE_SYNC_KEY = "cobrapp.cloud.pending_core_sync.v1";
const CORE_DATA_FALLBACK_POLL_MS = 5 * 60_000;
const INITIAL_PAYMENTS_LIMIT = 300;
const CLOUD_BOOT_BLOCK_MS = 10_000;
const PERF_LOGS_ENABLED = import.meta.env.VITE_PERF_LOGS === "1";
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

export type CoreSyncStatus = "idle" | "syncing" | "ok" | "error";

type UseCoreCloudSyncOptions = {
  enabled?: boolean;
  userId?: string;
  ownerUserId?: string;
  isReadOnly: boolean;
  clients: Client[];
  payments: Payment[];
  setClients: Dispatch<SetStateAction<Client[]>>;
  setPayments: Dispatch<SetStateAction<Payment[]>>;
  fullPaymentHistoryLoaded: boolean;
  setFullPaymentHistoryLoaded: Dispatch<SetStateAction<boolean>>;
  onSettingsReload: () => void;
};

async function measureAsync<T>(label: string, task: () => Promise<T>): Promise<T> {
  if (!PERF_LOGS_ENABLED) return task();
  const startedAt = performance.now();
  try {
    return await task();
  } finally {
    console.info(`[Rentautos perf] ${label}: ${Math.round(performance.now() - startedAt)}ms`);
  }
}

export function useCoreCloudSync({
  enabled = true,
  userId,
  ownerUserId,
  isReadOnly,
  clients,
  payments,
  setClients,
  setPayments,
  fullPaymentHistoryLoaded,
  setFullPaymentHistoryLoaded,
  onSettingsReload
}: UseCoreCloudSyncOptions) {
  const [cloudReady, setCloudReady] = useState(false);
  const [cloudBootTimedOut, setCloudBootTimedOut] = useState(false);
  const [syncStatus, setSyncStatus] = useState<CoreSyncStatus>("idle");
  const [syncErrorMessage, setSyncErrorMessage] = useState("");
  const [lastSyncAt, setLastSyncAt] = useState("");
  const pendingCoreSyncRef = useRef<PendingCoreSyncSnapshot | null>(null);
  const coreSyncRetryTimerRef = useRef<number | null>(null);
  const coreSyncInFlightRef = useRef(false);

  useEffect(() => {
    if (enabled) return;
    savePendingSnapshot(null);
    setCloudReady(true);
    setCloudBootTimedOut(false);
    setSyncStatus("ok");
    setSyncErrorMessage("");
  }, [enabled]);

  function savePendingSnapshot(snapshot: PendingCoreSyncSnapshot | null): void {
    pendingCoreSyncRef.current = snapshot;
    if (!snapshot) {
      localStorage.removeItem(PENDING_CORE_SYNC_KEY);
      return;
    }
    localStorage.setItem(PENDING_CORE_SYNC_KEY, serializePendingCoreSync(snapshot));
  }

  function scheduleRetry(delayMs = 4000): void {
    if (coreSyncRetryTimerRef.current !== null) window.clearTimeout(coreSyncRetryTimerRef.current);
    coreSyncRetryTimerRef.current = window.setTimeout(() => {
      coreSyncRetryTimerRef.current = null;
      void flushPendingCoreSync();
    }, delayMs);
  }

  async function flushPendingCoreSync(): Promise<boolean> {
    if (!enabled) return true;
    if (!ownerUserId || !cloudReady) return false;
    const snapshot = pendingCoreSyncRef.current;
    if (!snapshot) return true;
    if (coreSyncInFlightRef.current) return false;

    coreSyncInFlightRef.current = true;
    try {
      setSyncStatus("syncing");
      if (snapshot.paymentsComplete) await saveCloudPayments(ownerUserId, snapshot.payments);
      else await syncCloudPaymentsDelta(ownerUserId, [], snapshot.payments);
      await saveCloudClients(ownerUserId, snapshot.clients);
      if (pendingCoreSyncRef.current?.token === snapshot.token) savePendingSnapshot(null);
      setSyncStatus("ok");
      setSyncErrorMessage("");
      setLastSyncAt(new Date().toLocaleTimeString());
      return true;
    } catch (error) {
      console.error("No se pudo sincronizar clientes/pagos pendientes en cloud.", error);
      setSyncStatus("error");
      setSyncErrorMessage(getCloudSaveErrorMessage(error));
      scheduleRetry(5000);
      return false;
    } finally {
      coreSyncInFlightRef.current = false;
    }
  }

  function queueCoreSync(nextClients: Client[], nextPayments: Payment[]): void {
    if (!enabled) return;
    if (!ownerUserId) return;
    savePendingSnapshot({
      userId: ownerUserId,
      token: Date.now() + Math.random(),
      clients: nextClients,
      payments: nextPayments,
      paymentsComplete: fullPaymentHistoryLoaded
    });
    void flushPendingCoreSync();
  }

  async function syncCoreDeltaOrQueue(
    previousClients: Client[],
    nextClients: Client[],
    previousPayments: Payment[],
    nextPayments: Payment[]
  ): Promise<void> {
    if (!enabled) return;
    if (!ownerUserId) return;
    try {
      setSyncStatus("syncing");
      await syncCloudPaymentsDelta(ownerUserId, previousPayments, nextPayments);
      await syncCloudClientsDelta(ownerUserId, previousClients, nextClients);
      setSyncStatus("ok");
      setSyncErrorMessage("");
      setLastSyncAt(new Date().toLocaleTimeString());
    } catch (error) {
      if (isSupabaseOnlyMode) {
        setSyncStatus("error");
        setSyncErrorMessage(buildCloudErrorMessage(
          "No se pudo guardar en Supabase. Refresca y vuelve a intentar.",
          error,
          { includeRawFallback: true }
        ));
        throw error;
      }
      console.error("No se pudo sincronizar delta en cloud. Se encola snapshot completo.", error);
      queueCoreSync(nextClients, nextPayments);
    }
  }

  function saveCoreCache(nextClients: Client[], nextPayments: Payment[]): void {
    if (isSupabaseOnlyMode) return;
    saveClients(nextClients);
    savePayments(nextPayments);
  }

  function applyRemoteRow(payload: unknown, table: "clients_cloud" | "payments_cloud"): void {
    if (pendingCoreSyncRef.current) {
      setSyncStatus("syncing");
      void flushPendingCoreSync();
      return;
    }
    const event = payload && typeof payload === "object"
      ? payload as { eventType?: unknown; new?: unknown; old?: unknown }
      : null;
    const eventType = typeof event?.eventType === "string" ? event.eventType : "";
    const row = (eventType === "DELETE" ? event?.old : event?.new) as { id?: unknown; data?: unknown } | undefined;
    const id = typeof row?.id === "string" ? row.id : "";
    if (!id) return;

    if (table === "clients_cloud") {
      setClients((current) => {
        const next = eventType === "DELETE"
          ? current.filter((client) => client.id !== id)
          : (() => {
              if (!row?.data || typeof row.data !== "object") return current;
              const incoming = normalizeCloudClient(row.data as Client);
              return current.some((client) => client.id === incoming.id)
                ? current.map((client) => client.id === incoming.id ? incoming : client)
                : [incoming, ...current];
            })();
        if (next !== current && !isSupabaseOnlyMode) saveClients(next);
        return next;
      });
    } else {
      setPayments((current) => {
        const next = eventType === "DELETE"
          ? current.filter((payment) => payment.id !== id)
          : (() => {
              if (!row?.data || typeof row.data !== "object") return current;
              const incoming = row.data as Payment;
              return current.some((payment) => payment.id === incoming.id)
                ? current.map((payment) => payment.id === incoming.id ? incoming : payment)
                : [incoming, ...current];
            })();
        if (next !== current && !isSupabaseOnlyMode) savePayments(next);
        return next;
      });
    }
    setSyncStatus("ok");
    setSyncErrorMessage("");
    setLastSyncAt(new Date().toLocaleTimeString());
  }

  useEffect(() => {
    if (!enabled) return;
    if (!userId || cloudReady) {
      setCloudBootTimedOut(false);
      return;
    }
    const timer = window.setTimeout(() => setCloudBootTimedOut(true), CLOUD_BOOT_BLOCK_MS);
    return () => window.clearTimeout(timer);
  }, [enabled, cloudReady, userId]);

  useEffect(() => {
    if (!enabled) return;
    if (isSupabaseOnlyMode) return;
    let cancelled = false;
    void Promise.all([loadClientsFromIndexedDb(), loadPaymentsFromIndexedDb()]).then(([indexedClients, indexedPayments]) => {
      if (cancelled) return;
      if (indexedClients.length > 0) setClients((current) => current.length > 0 ? current : indexedClients);
      if (indexedPayments.length > 0) setPayments((current) => current.length > 0 ? current : indexedPayments);
    }).catch((error) => console.error("No se pudo hidratar cache local desde IndexedDB.", error));
    return () => { cancelled = true; };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      savePendingSnapshot(null);
      return;
    }
    if (isSupabaseOnlyMode) {
      savePendingSnapshot(null);
      return;
    }
    const snapshot = parsePendingCoreSync(localStorage.getItem(PENDING_CORE_SYNC_KEY), ownerUserId);
    if (!snapshot) return;
    pendingCoreSyncRef.current = snapshot;
    setClients(snapshot.clients);
    setPayments(snapshot.payments);
    setSyncStatus("error");
    setSyncErrorMessage("Hay cambios pendientes por sincronizar. Se reintentara automaticamente.");
  }, [enabled, ownerUserId]);

  useEffect(() => {
    if (!enabled) return;
    if (!ownerUserId) return;
    let cancelled = false;
    void (async () => {
      try {
        const localClients = isSupabaseOnlyMode ? [] : loadClients();
        const localPayments = isSupabaseOnlyMode ? [] : loadPayments();
        setCloudReady(false);
        setSyncErrorMessage("");
        setSyncStatus("syncing");
        const [cloudClients, cloudPayments] = await measureAsync("initial cloud core load", () => Promise.all([
          measureAsync("load clients", () => loadCloudClients(ownerUserId)),
          measureAsync("load recent payments", () => loadCloudPaymentsRecent(ownerUserId, INITIAL_PAYMENTS_LIMIT))
        ]));
        if (cancelled) return;
        const bootstrapClients = isSupabaseOnlyMode
          ? cloudClients
          : cloudClients.length > 0 ? mergeById(clients.length > 0 ? clients : localClients, cloudClients) : clients.length > 0 ? clients : localClients;
        const bootstrapPayments = isSupabaseOnlyMode
          ? cloudPayments
          : cloudPayments.length > 0 ? mergeById(payments.length > 0 ? payments : localPayments, cloudPayments) : payments.length > 0 ? payments : localPayments;
        const duplicateRepair = repairDuplicateActiveUnits(bootstrapClients);
        if (duplicateRepair.changed) await saveCloudClients(ownerUserId, duplicateRepair.clients);
        setClients(duplicateRepair.clients);
        setPayments(bootstrapPayments);
        setFullPaymentHistoryLoaded(false);
        onSettingsReload();
        saveCoreCache(duplicateRepair.clients, bootstrapPayments);
        await measureAsync("cloud mirror bootstrap", () => initializeCloudMirror(ownerUserId, { skipKeys: CLOUD_MIRROR_BOOTSTRAP_SKIP_KEYS }));
        if (cancelled) return;
        onSettingsReload();
        setSyncStatus("ok");
        setSyncErrorMessage("");
        setLastSyncAt(new Date().toLocaleTimeString());
        setCloudReady(true);
      } catch (error) {
        console.error("No se pudo cargar data cloud.", error);
        setSyncStatus("error");
        setSyncErrorMessage(buildCloudErrorMessage("Fallo la sincronizacion inicial con nube.", error, { includeRawFallback: true }));
        setCloudReady(true);
      }
    })();
    return () => {
      cancelled = true;
      disableCloudMirror();
    };
  }, [enabled, ownerUserId, isReadOnly]);

  useEffect(() => {
    if (!enabled) return;
    if (!ownerUserId || !cloudReady || !supabase) return;
    const client = supabase;
    let cancelled = false;
    const reload = async () => {
      if (pendingCoreSyncRef.current) {
        void flushPendingCoreSync();
        return;
      }
      try {
        const [cloudClients, cloudPayments] = await Promise.all([
          loadCloudClients(ownerUserId),
          loadCloudPaymentsRecent(ownerUserId, INITIAL_PAYMENTS_LIMIT)
        ]);
        if (cancelled) return;
        const repaired = repairDuplicateActiveUnits(cloudClients);
        if (repaired.changed) await saveCloudClients(ownerUserId, repaired.clients);
        setClients(repaired.clients);
        setPayments((current) => mergeById(current, cloudPayments));
        saveCoreCache(repaired.clients, cloudPayments);
        setLastSyncAt(new Date().toLocaleTimeString());
      } catch (error) {
        console.error("No se pudo refrescar clientes/pagos desde nube.", error);
      }
    };
    const channel = client
      .channel(`clients-core-live-${ownerUserId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "clients_cloud", filter: `user_id=eq.${ownerUserId}` }, (payload) => applyRemoteRow(payload, "clients_cloud"))
      .on("postgres_changes", { event: "*", schema: "public", table: "payments_cloud", filter: `user_id=eq.${ownerUserId}` }, (payload) => applyRemoteRow(payload, "payments_cloud"))
      .subscribe();
    const fallbackTimer = window.setInterval(() => {
      if (!document.hidden) void reload();
    }, CORE_DATA_FALLBACK_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(fallbackTimer);
      void client.removeChannel(channel);
    };
  }, [enabled, ownerUserId, cloudReady]);

  useEffect(() => {
    if (!enabled) return;
    const handleOnline = () => { void flushPendingCoreSync(); };
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("online", handleOnline);
      if (coreSyncRetryTimerRef.current !== null) window.clearTimeout(coreSyncRetryTimerRef.current);
    };
  }, [enabled, ownerUserId, cloudReady]);

  useEffect(() => {
    if (!enabled) return;
    if (!ownerUserId || !cloudReady) return;
    let timer: number | null = null;
    const handlePing = () => {
      setSyncStatus("syncing");
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        setSyncStatus("ok");
        setSyncErrorMessage("");
        setLastSyncAt(new Date().toLocaleTimeString());
      }, 250);
    };
    window.addEventListener("cobrapp:cloud-sync-ping", handlePing);
    return () => {
      window.removeEventListener("cobrapp:cloud-sync-ping", handlePing);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [enabled, ownerUserId, cloudReady]);

  async function refreshPaymentsFromSource(): Promise<void> {
    if (!enabled) return;
    if (pendingCoreSyncRef.current && !(await flushPendingCoreSync())) {
      throw new Error("No se pudieron sincronizar los cambios pendientes.");
    }
    setSyncStatus("syncing");
    try {
      let refreshedPayments: Payment[];
      let usedRecentFallback = false;
      if (ownerUserId) {
        try {
          refreshedPayments = await measureAsync("manual payments refresh", () => loadCloudPayments(ownerUserId));
          setFullPaymentHistoryLoaded(true);
        } catch (error) {
          console.error("No se pudo cargar historial completo; se intentara cargar pagos recientes.", error);
          refreshedPayments = await loadCloudPaymentsRecent(ownerUserId, INITIAL_PAYMENTS_LIMIT);
          usedRecentFallback = true;
          setFullPaymentHistoryLoaded(false);
        }
      } else {
        const indexed = await loadPaymentsFromIndexedDb();
        refreshedPayments = indexed.length > 0 ? indexed : loadPayments();
        setFullPaymentHistoryLoaded(true);
      }
      setPayments(refreshedPayments);
      if (!isSupabaseOnlyMode) savePayments(refreshedPayments);
      setSyncStatus("ok");
      setSyncErrorMessage(usedRecentFallback ? "No se pudo cargar el historial completo; se cargaron pagos recientes." : "");
      setLastSyncAt(new Date().toLocaleTimeString());
    } catch (error) {
      setSyncStatus("error");
      setSyncErrorMessage(buildCloudErrorMessage("Fallo la actualizacion manual de pagos.", error, { includeRawFallback: true }));
      throw error;
    }
  }

  return {
    cloudReady,
    cloudBootTimedOut,
    syncStatus,
    syncErrorMessage,
    lastSyncAt,
    setSyncStatus,
    setSyncErrorMessage,
    setLastSyncAt,
    flushPendingCoreSync,
    syncCoreDeltaOrQueue,
    refreshPaymentsFromSource
  };
}
