import { useEffect, useRef, useState } from "react";
import ClientsPage from "./pages/ClientsPage";
import PaymentsPage from "./pages/PaymentsPage";
import ReceivablesPage from "./pages/ReceivablesPage";
import SettingsPage from "./pages/SettingsPage";
import CashClosingPage from "./pages/CashClosingPage";
import {
  loadClients,
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
  loadCloudStreetManagement,
  saveCloudClients,
  saveCloudPayments,
  saveCloudStreetManagement
} from "./cloudData";
import { supabase } from "./lib/supabase";
import { disableCloudMirror, flushCloudMirror, initializeCloudMirror } from "./cloudMirror";
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

type AppPage = "clients" | "payments" | "receivables" | "settings" | "cash_closing";

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
  const [page, setPage] = useState<AppPage>(isReadOnlyReceivables ? "receivables" : "clients");
  const [clients, setClients] = useState<Client[]>(() => loadClients());
  const [payments, setPayments] = useState<Payment[]>(() => loadPayments());
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const indexedPayments = await loadPaymentsFromIndexedDb();
        if (cancelled || indexedPayments.length === 0) return;
        setPayments((current) => (current.length > 0 ? current : indexedPayments));
      } catch (error) {
        console.error("No se pudo hidratar pagos desde IndexedDB.", error);
      }
    })();
    return () => {
      cancelled = true;
    };
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
    if (isReadOnlyReceivables) {
      setPage("receivables");
    } else if (page === "receivables") {
      setPage("clients");
    }
  }, [isReadOnlyReceivables]);

  useEffect(() => {
    if (!cloudDataUserId) return;
    let cancelled = false;

    (async () => {
      try {
        setCloudReady(false);
        setCloudLoadError("");
        setSyncErrorMessage("");
        setSyncStatus("syncing");
        void initializeCloudMirror(cloudDataUserId).catch((error) => {
          console.error("No se pudo inicializar cloud mirror.", error);
        });
        const [cloudClientsData, cloudPaymentsData, cloudStreetManagement, cloudCollectionClosures] = await Promise.all([
          loadCloudClients(cloudDataUserId),
          loadCloudPayments(cloudDataUserId),
          loadCloudStreetManagement(cloudDataUserId),
          loadCloudCollectionClosures(cloudDataUserId)
        ]);
        if (cancelled) return;
        setClients(cloudClientsData);
        setPayments(cloudPaymentsData);
        setBankRules(loadBankRules());
        setLateFeeSettings(loadLateFeeSettings());
        setOtherChargesRetentionByClient(loadOtherChargesRetentionByClient());
        // Mantiene compatibilidad con funciones que aun leen localStorage.
        saveClients(cloudClientsData);
        savePayments(cloudPaymentsData);
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
        setSyncErrorMessage("Fallo la sincronizacion inicial con nube.");
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
    }, 30000);

    return () => {
      window.clearInterval(fallbackTimer);
      void supabase.removeChannel(channel);
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
    if (isReadOnlyReceivables) return;
    if (cloudDataUserId && !cloudReady) return;
    const previous = clients;
    setClients(next);
    if (cloudDataUserId) {
      try {
        setSyncStatus("syncing");
        await saveCloudClients(cloudDataUserId, next);
        setSyncStatus("ok");
        setSyncErrorMessage("");
        setLastSyncAt(new Date().toLocaleTimeString());
      } catch (err) {
        console.error("No se pudo guardar clientes en cloud.", err);
        setClients(previous);
        setSyncStatus("error");
        setSyncErrorMessage("No se pudo guardar clientes en nube. El cambio fue revertido.");
        return;
      }
    }
    saveClients(next);
    setHasPendingChanges(true);
  }

  async function persistPayments(next: Payment[]): Promise<void> {
    if (isReadOnlyReceivables) return;
    if (cloudDataUserId && !cloudReady) return;
    const previous = payments;
    setPayments(next);
    if (cloudDataUserId) {
      try {
        setSyncStatus("syncing");
        await saveCloudPayments(cloudDataUserId, next);
        setSyncStatus("ok");
        setSyncErrorMessage("");
        setLastSyncAt(new Date().toLocaleTimeString());
      } catch (err) {
        console.error("No se pudo guardar pagos en cloud.", err);
        setPayments(previous);
        setSyncStatus("error");
        setSyncErrorMessage("No se pudo guardar pagos en nube. El cambio fue revertido.");
        return;
      }
    }
    savePayments(next);
    setHasPendingChanges(true);
  }

  async function persistClientsAndPayments(nextClients: Client[], nextPayments: Payment[]): Promise<boolean> {
    if (isReadOnlyReceivables) return false;
    if (cloudDataUserId && !cloudReady) return false;
    const previousClients = clients;
    const previousPayments = payments;
    setClients(nextClients);
    setPayments(nextPayments);
    if (cloudDataUserId) {
      try {
        setSyncStatus("syncing");
        await saveCloudClients(cloudDataUserId, nextClients);
        await saveCloudPayments(cloudDataUserId, nextPayments);
        setSyncStatus("ok");
        setSyncErrorMessage("");
        setLastSyncAt(new Date().toLocaleTimeString());
      } catch (err) {
        console.error("No se pudo guardar clientes/pagos en cloud.", err);
        setClients(previousClients);
        setPayments(previousPayments);
        setSyncStatus("error");
        setSyncErrorMessage("No se pudo guardar clientes/pagos en nube. El cambio fue revertido.");
        return false;
      }
    }
    saveClients(nextClients);
    savePayments(nextPayments);
    setHasPendingChanges(true);
    return true;
  }

  function persistBankRules(next: BankRule[]): void {
    setBankRules(next);
    saveBankRules(next);
    setHasPendingChanges(true);
  }

  function persistLateFeeSettings(next: LateFeeSettings): void {
    setLateFeeSettings(next);
    saveLateFeeSettings(next);
    setHasPendingChanges(true);
  }

  function persistOtherChargesRetentionByClient(next: OtherChargesRetentionByClient): void {
    setOtherChargesRetentionByClient(next);
    saveOtherChargesRetentionByClient(next);
    setHasPendingChanges(true);
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
      await saveCloudStreetManagement(cloudDataUserId, mergedNext);
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

  if (cloudLoadError) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <h1>Rentautos</h1>
          <p>{cloudLoadError}</p>
          <div style={{ display: "grid", gap: 10, justifyItems: "start" }}>
            <button
              type="button"
              className="button primary"
              onClick={() => setCloudReloadTick((value) => value + 1)}
            >
              Reintentar
            </button>
            {onSignOut && (
              <button
                type="button"
                className="button ghost"
                onClick={() => void onSignOut()}
              >
                Cerrar sesion
              </button>
            )}
          </div>
        </section>
      </main>
    );
  }

  if (cloudDataUserId && !cloudReady) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <h1>Rentautos</h1>
          <p>Sincronizando data de nube...</p>
        </section>
      </main>
    );
  }

  return (
    <>
      <nav className="app-nav">
        <div className="app-nav-inner">
          <span className="app-nav-brand">Rentautos</span>
          <div className="app-nav-tabs">
            {!isReadOnlyReceivables && (
              <>
                <button
                  type="button"
                  className={`nav-tab ${page === "clients" ? "nav-tab--active" : ""}`}
                  onClick={() => setPage("clients")}
                >
                  Clientes
                </button>
                <button
                  type="button"
                  className={`nav-tab ${page === "payments" ? "nav-tab--active" : ""}`}
                  onClick={() => setPage("payments")}
                >
                  Pagos
                </button>
              </>
            )}
            <button
              type="button"
              className={`nav-tab ${page === "receivables" ? "nav-tab--active" : ""}`}
              onClick={() => setPage("receivables")}
            >
              Cuentas por Cobrar
              {routeCollectionCount > 0 && <span className="nav-tab-badge">Ruta: {routeCollectionCount}</span>}
            </button>
            {!isReadOnlyReceivables && (
              <button
                type="button"
                className={`nav-tab ${page === "settings" ? "nav-tab--active" : ""}`}
                onClick={() => setPage("settings")}
              >
                Configuraciones
              </button>
            )}
            {!isReadOnlyReceivables && (
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
        {page === "clients" && (
          <ClientsPage clients={clients} onClientsChange={persistClients} />
        )}
        {page === "payments" && (
          <PaymentsPage
            clients={clients}
            bankRules={bankRules}
            lateFeeSettings={lateFeeSettings}
            otherChargesRetentionByClient={otherChargesRetentionByClient}
            onClientsChange={persistClients}
            payments={payments}
            onPaymentsChange={persistPayments}
            onPersistClientPayment={persistClientsAndPayments}
            onCashClose={() => void runBackup("cash_closing", true)}
            quickCashPrefill={cashPaymentPrefill}
            onQuickCashPrefillConsumed={() => setCashPaymentPrefill(null)}
          />
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
