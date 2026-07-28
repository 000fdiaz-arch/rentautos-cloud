import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import {
  loadClients,
  loadPayments,
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
  loadPendingBankItemsFromIndexedDb,
  loadPendingBankItems,
  loadManualBankAssignmentAudit,
  loadManualBankAssignmentAuditFromIndexedDb,
  saveManualBankAssignmentAudit,
  saveLateFeeLedger,
} from "./storage";
import {
  deleteCloudLeadEvaluation,
  deleteCloudPayment,
  deleteCloudPayments,
  loadCloudBankRules,
  loadCloudChargeRunsWithDetails,
  loadCloudClients,
  loadCloudLeadEvaluation,
  loadCloudLeadEvaluations,
  loadCloudLeadEvaluationSummaries,
  loadCloudLateFeeSettings,
  loadCloudOtherChargesRetention,
  loadCloudPayments,
  loadControlUnits,
  registerCloudPaymentDeltas,
  saveCloudBankRules,
  saveCloudChargeRuns,
  saveControlUnit,
  saveCloudLeadEvaluation,
  saveCloudLateFeeSettings,
  saveCloudOtherChargesRetention,
  syncCloudClientsDelta
} from "./cloudData";
import { flushCloudMirror } from "./cloudMirror";
import { isSupabaseOnlyMode } from "./persistenceMode";
import { analyzeBackupFileContent, type BackupImportReport } from "./backupImport";
import type { BackupExtraData } from "./autobackup";
import { canEditScreen, canViewScreen, type AppPermissions } from "./auth/permissions";
import type { BankRule, Client, LateFeeSettings, LeadEvaluation, OtherChargesRetentionByClient, Payment } from "./types";
import { parseLocalJson } from "./app/appShellRules";
import AppNavigation, { type AppPage } from "./app/AppNavigation";
import { useBackupManager } from "./app/useBackupManager";
import { useCoreCloudSync } from "./app/useCoreCloudSync";
import { getBusinessDateKey } from "./billing";
import { stableEqual } from "./stableSerialize";
import "./styles.css";

const ClientsPage = lazy(() => import("./pages/ClientsPage"));
const LeadsPage = lazy(() => import("./pages/LeadsPage"));
const PaymentsPage = lazy(() => import("./pages/PaymentsPage"));
const ReceivablesPage = lazy(() => import("./pages/ReceivablesPage"));
const InsuranceWorkflowPage = lazy(() => import("./pages/InsuranceWorkflowPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const ControlUnitsPage = lazy(() => import("./pages/ControlUnitsPage"));

const FLEET_UNIT_RESTORE_FIELDS = [
  "company",
  "brand_model",
  "engine_serial",
  "chassis_serial",
  "plate",
  "cupo",
  "observation",
  "is_exception",
  "exception_note",
  "operational_status",
  "year",
  "color",
  "transmission",
  "mileage"
] as const;

const PAYMENT_MIRROR_KEYS = [
  "cobrapp.module2.pending_bank.v1",
  "cobrapp.module2.pending_card.v1",
  "cobrapp.module2.manual_assignment_audit.v1",
  "cobrapp.module2.late_fee_ledger.v1",
  "cobrapp.module2.notified.v1",
  "cobrapp.module2.cash_closings.v1",
  "cobrapp.module2.cash_closing_audit.v1",
  "cobrapp.module2.charge_runs.v1",
  "cobrapp.payments.seq.v1",
  "cobrapp.clients.daily_collection.v1",
  "cobrapp.clients.daily_collection_am_seals.v1",
  "cobrapp.clients.daily_collection_pm_seals.v1",
  "cobrapp.clients.daily_collection_close_seals.v1",
  "cobrapp.clients.daily_collection_promises.v1",
  "cobrapp.clients.daily_collection_street_actions.v1"
] as const;

const RECEIVABLES_MIRROR_KEYS = [
  "cobrapp.module3.street_management.v1",
  "cobrapp.module3.collection_closures.v1"
] as const;

const SETTINGS_MIRROR_KEYS = [
  "cobrapp.settings.bank_rules.v1",
  "cobrapp.settings.late_fee_settings.v1",
  "cobrapp.settings.other_charges_retention.v1"
] as const;

type AppShellProps = {
  userId?: string;
  userEmail?: string;
  dataOwnerUserId?: string | null;
  effectiveOwnerUserId?: string;
  permissions: AppPermissions;
  canWriteOperationalData?: boolean;
  canManageSettings?: boolean;
  canManageUsers?: boolean;
  isReadOnlyExperience?: boolean;
  onSignOut?: () => void;
};

function getFirstVisiblePage(visibility: {
  canViewLeads: boolean;
  canViewClients: boolean;
  canViewPayments: boolean;
  canViewReceivables: boolean;
  canViewControlUnits: boolean;
  canViewSettingsPage: boolean;
}): AppPage {
  if (visibility.canViewClients) return "clients";
  if (visibility.canViewPayments) return "payments";
  if (visibility.canViewReceivables) return "receivables";
  if (visibility.canViewLeads) return "leads";
  if (visibility.canViewControlUnits) return "control_units";
  if (visibility.canViewSettingsPage) return "settings";
  return "control_units";
}

export default function AppShell({
  userId,
  userEmail,
  dataOwnerUserId,
  effectiveOwnerUserId,
  permissions,
  canWriteOperationalData = false,
  canManageSettings = false,
  canManageUsers = false,
  isReadOnlyExperience = true,
  onSignOut
}: AppShellProps) {
  const canViewLeads = canViewScreen(permissions, "leads");
  const canEditLeads = canEditScreen(permissions, "leads");
  const canViewClients = canViewScreen(permissions, "clients");
  const canEditClients = canEditScreen(permissions, "clients");
  const canViewPayments = canViewScreen(permissions, "payments");
  const canEditPayments = canEditScreen(permissions, "payments");
  const canViewReceivables = canViewScreen(permissions, "receivables");
  const canEditReceivables = canEditScreen(permissions, "receivables");
  const canViewControlUnits = canViewScreen(permissions, "control_units");
  const canEditControlUnits = canEditScreen(permissions, "control_units");
  const canViewSettings = canViewScreen(permissions, "settings");
  const canEditSettings = canEditScreen(permissions, "settings") && canManageSettings;
  const canViewSettingsPage = canViewSettings || canManageUsers;
  const isReadOnlyReceivables = isReadOnlyExperience || !canEditReceivables;
  const shouldSyncCoreData = canViewClients || canViewPayments || canViewReceivables || canViewSettingsPage;
  const shouldLoadCloudSettings = canViewPayments || canViewSettingsPage;
  const cloudMirrorHydrationKeys = useMemo(() => {
    const keys = new Set<string>();
    if (canViewPayments) {
      PAYMENT_MIRROR_KEYS.forEach((key) => keys.add(key));
      SETTINGS_MIRROR_KEYS.forEach((key) => keys.add(key));
    }
    if (canViewReceivables) RECEIVABLES_MIRROR_KEYS.forEach((key) => keys.add(key));
    if (canViewSettingsPage) SETTINGS_MIRROR_KEYS.forEach((key) => keys.add(key));
    return [...keys];
  }, [canViewPayments, canViewReceivables, canViewSettingsPage]);
  // Shared dataset mode: when a data owner is configured, all roles work on that same owner dataset.
  const cloudDataUserId = effectiveOwnerUserId ?? dataOwnerUserId ?? userId;
  const [page, setPage] = useState<AppPage>(() => getFirstVisiblePage({
    canViewLeads,
    canViewClients,
    canViewPayments,
    canViewReceivables,
    canViewControlUnits,
    canViewSettingsPage
  }));
  const [receivablesDateKey, setReceivablesDateKey] = useState<string>(() => getBusinessDateKey());
  const [clients, setClients] = useState<Client[]>(() => (isSupabaseOnlyMode ? [] : loadClients()));
  const [payments, setPayments] = useState<Payment[]>(() => (isSupabaseOnlyMode ? [] : loadPayments()));
  const [bankRules, setBankRules] = useState<BankRule[]>(() => loadBankRules());
  const [lateFeeSettings, setLateFeeSettings] = useState<LateFeeSettings>(() => loadLateFeeSettings());
  const [otherChargesRetentionByClient, setOtherChargesRetentionByClient] = useState<OtherChargesRetentionByClient>(() => loadOtherChargesRetentionByClient());
  const [leadEvaluations, setLeadEvaluations] = useState<LeadEvaluation[]>([]);
  const [leadsLoading, setLeadsLoading] = useState(false);
  const [leadsCloudError, setLeadsCloudError] = useState("");
  const [fullPaymentHistoryLoaded, setFullPaymentHistoryLoaded] = useState<boolean>(false);
  const [cashPaymentPrefill, setCashPaymentPrefill] = useState<{
    dateApplied: string;
    clientId: string;
    reference: string;
    amountReceived: string;
    token: number;
  } | null>(null);
  const [signOutSyncError, setSignOutSyncError] = useState("");

  const {
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
  } = useCoreCloudSync({
    enabled: shouldSyncCoreData,
    userId,
    ownerUserId: cloudDataUserId,
    isReadOnly: isReadOnlyReceivables,
    cloudMirrorHydrationKeys,
    clients,
    payments,
    setClients,
    setPayments,
    fullPaymentHistoryLoaded,
    setFullPaymentHistoryLoaded,
    onSettingsReload: reloadSettingsFromLocalCache
  });

  const {
    backupSupported,
    backupConfigured,
    backupStatus,
    backupRunning,
    hasPendingChanges,
    lastBackupAt,
    setBackupStatus,
    setHasPendingChanges,
    runBackup,
    configureFolder: handleConfigureBackupFolder,
    disconnectFolder: handleDisconnectBackupFolder
  } = useBackupManager({ clients, payments, buildExtraData: buildBackupExtraData, buildBackupData });

  useEffect(() => {
    const visible = {
      leads: canViewLeads,
      clients: canViewClients,
      payments: canViewPayments,
      receivables: canViewReceivables,
      insurance_workflow: canViewReceivables,
      control_units: canViewControlUnits,
      settings: canViewSettingsPage
    } satisfies Record<AppPage, boolean>;
    if (!visible[page]) {
      setPage(getFirstVisiblePage({
        canViewLeads,
        canViewClients,
        canViewPayments,
        canViewReceivables,
        canViewControlUnits,
        canViewSettingsPage
      }));
      return;
    }
  }, [canViewClients, canViewControlUnits, canViewLeads, canViewPayments, canViewReceivables, canViewSettingsPage, page]);

  useEffect(() => {
    let cancelled = false;
    if (!canViewLeads || !cloudDataUserId) {
      setLeadEvaluations([]);
      setLeadsLoading(false);
      setLeadsCloudError("");
      return () => {
        cancelled = true;
      };
    }
    setLeadsLoading(true);
    setLeadsCloudError("");
    void loadCloudLeadEvaluationSummaries(cloudDataUserId)
      .then((items) => {
        if (cancelled) return;
        setLeadEvaluations(items);
      })
      .catch((error) => {
        console.error("No se pudo cargar Leads desde Supabase.", error);
        if (!cancelled) setLeadsCloudError(`No se pudieron cargar los Leads desde nube. ${describeCloudError(error)}`);
      })
      .finally(() => {
        if (!cancelled) setLeadsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canViewLeads, cloudDataUserId]);

  useEffect(() => {
    let cancelled = false;
    if (!cloudDataUserId || !cloudReady || !shouldLoadCloudSettings) return () => {
      cancelled = true;
    };

    void reloadSettingsFromCloud(cloudDataUserId).catch((error) => {
      console.error("No se pudieron cargar settings explicitos desde Supabase.", error);
      if (!cancelled) {
        setSyncStatus("error");
        setSyncErrorMessage(`No se pudieron cargar configuraciones cloud. ${describeCloudError(error)}`);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [cloudDataUserId, cloudReady, shouldLoadCloudSettings]);

  function handleStartCashClientPayment(payload: {
    dateApplied: string;
    clientId: string;
    reference: string;
    amountReceived: string;
  }): void {
    setCashPaymentPrefill({ ...payload, token: Date.now() });
    setPage("payments");
  }

  async function buildBackupExtraData(): Promise<BackupExtraData> {
    let fleetUnits: unknown[] = [];
    let cloudChargeRuns: unknown[] | null = null;
    const indexedPendingBankItems = await loadPendingBankItemsFromIndexedDb();
    const indexedManualAssignmentAudit = await loadManualBankAssignmentAuditFromIndexedDb();
    if (cloudDataUserId) {
      try {
        fleetUnits = await loadControlUnits(cloudDataUserId);
      } catch (error) {
        console.error("No se pudieron incluir autos en el respaldo.", error);
      }
      if (isSupabaseOnlyMode) {
        try {
          cloudChargeRuns = await loadCloudChargeRunsWithDetails(cloudDataUserId);
        } catch (error) {
          console.error("No se pudieron incluir corridas de cierre en el respaldo.", error);
        }
      }
    }
    return {
      seq: Number(localStorage.getItem("cobrapp.payments.seq.v1") ?? "0") || 0,
      pendingBankItems: indexedPendingBankItems.length > 0 ? indexedPendingBankItems : loadPendingBankItems(),
      pendingCardItems: parseLocalJson("cobrapp.module2.pending_card.v1", []) as unknown[],
      bankRules: parseLocalJson("cobrapp.settings.bank_rules.v1", []) as unknown[],
      manualAssignmentAudit: indexedManualAssignmentAudit.length > 0 ? indexedManualAssignmentAudit : loadManualBankAssignmentAudit(),
      lateFeeSettings: parseLocalJson("cobrapp.settings.late_fee_settings.v1", {}) as Record<string, unknown>,
      lateFeeLedger: parseLocalJson("cobrapp.module2.late_fee_ledger.v1", []) as unknown[],
      otherChargesRetentionByClient: parseLocalJson("cobrapp.settings.other_charges_retention.v1", {}) as Record<string, unknown>,
      notifiedPayments: parseLocalJson("cobrapp.module2.notified.v1", []) as unknown[],
      cashClosings: parseLocalJson("cobrapp.module2.cash_closings.v1", []) as unknown[],
      cashClosingAudit: parseLocalJson("cobrapp.module2.cash_closing_audit.v1", []) as unknown[],
      chargeRuns: cloudChargeRuns ?? parseLocalJson("cobrapp.module2.charge_runs.v1", []) as unknown[],
      streetManagement: parseLocalJson("cobrapp.module3.street_management.v1", {}) as Record<string, unknown>,
      leadEvaluations: cloudDataUserId
        ? await loadCloudLeadEvaluations(cloudDataUserId).catch((error) => {
            console.error("No se pudieron incluir Leads completos en el respaldo.", error);
            return leadEvaluations;
          })
        : leadEvaluations,
      fleetUnits,
      statusFilter: String(localStorage.getItem("cobrapp.clients.status_filter.v1") ?? "active")
    };
  }

  async function buildBackupData(): Promise<{ clients: Client[]; payments: Payment[]; extraData: BackupExtraData }> {
    if (!cloudDataUserId || !isSupabaseOnlyMode) {
      return { clients, payments, extraData: await buildBackupExtraData() };
    }
    const [backupClients, backupPayments, extraData] = await Promise.all([
      loadCloudClients(cloudDataUserId),
      loadCloudPayments(cloudDataUserId),
      buildBackupExtraData()
    ]);
    return { clients: backupClients, payments: backupPayments, extraData };
  }

  async function persistClients(next: Client[]): Promise<void> {
    if (!canEditClients && !canEditPayments && !canEditSettings) return;
    if (userId && !cloudReady) return;
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

  async function refreshClientsFromCloud(): Promise<void> {
    if (!cloudDataUserId) return;
    const cloudClients = await loadCloudClients(cloudDataUserId);
    setClients(cloudClients);
  }

  async function persistPayments(next: Payment[]): Promise<void> {
    if (!canEditPayments) return;
    if (userId && !cloudReady) return;
    const previousClients = clients;
    const previousPayments = payments;
    setPayments(next);
    if (cloudDataUserId) {
      void syncCoreDeltaOrQueue(previousClients, previousClients, previousPayments, next);
    }
    if (!isSupabaseOnlyMode) savePayments(next);
    setHasPendingChanges(true);
  }


  async function persistClientsAndPayments(nextClients: Client[], nextPayments: Payment[]): Promise<boolean> {
    if (!canEditPayments) return false;
    const previousClients = clients;
    const previousPayments = payments;
    const previousPaymentIds = new Set(previousPayments.map((payment) => payment.id));
    const hasNewPayments = nextPayments.some((payment) => !previousPaymentIds.has(payment.id));
    const isAppendOnlyPaymentChange =
      hasNewPayments &&
      previousPayments.every((previousPayment) => {
        const nextPayment = nextPayments.find((payment) => payment.id === previousPayment.id);
        return Boolean(nextPayment) && stableEqual(previousPayment, nextPayment);
      });

    if (cloudDataUserId && isSupabaseOnlyMode) {
      setSyncStatus("syncing");
      try {
        if (isAppendOnlyPaymentChange) {
          await registerCloudPaymentDeltas(cloudDataUserId, previousClients, nextClients, previousPayments, nextPayments);
        } else {
          await syncCoreDeltaOrQueue(previousClients, nextClients, previousPayments, nextPayments);
        }
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
    if (cloudDataUserId) {
      const syncTask = isAppendOnlyPaymentChange
        ? registerCloudPaymentDeltas(cloudDataUserId, previousClients, nextClients, previousPayments, nextPayments)
        : syncCoreDeltaOrQueue(previousClients, nextClients, previousPayments, nextPayments);
      void syncTask.catch((error) => {
        console.error("No se pudo guardar clientes/pagos en Supabase.", error);
      });
    }
    if (!isSupabaseOnlyMode) {
      saveClients(nextClients);
      savePayments(nextPayments);
    }
    setHasPendingChanges(true);
    return true;
  }

  async function persistDeletedPayments(nextClients: Client[], nextPayments: Payment[], deletedPaymentIds: string[]): Promise<boolean> {
    if (!canEditPayments) return false;
    if (userId && !cloudReady) return false;
    const previousClients = clients;
    const previousPayments = payments;

    if (cloudDataUserId) {
      setSyncStatus("syncing");
      try {
        await syncCloudClientsDelta(cloudDataUserId, previousClients, nextClients);
        if (deletedPaymentIds.length === 1) {
          await deleteCloudPayment(cloudDataUserId, deletedPaymentIds[0]);
        } else {
          await deleteCloudPayments(cloudDataUserId, deletedPaymentIds);
        }
      } catch (error) {
        console.error("No se pudo eliminar el pago en Supabase.", error);
        try {
          await syncCloudClientsDelta(cloudDataUserId, nextClients, previousClients);
        } catch (rollbackError) {
          console.error("No se pudo revertir el cliente despues de fallar eliminando pago.", rollbackError);
        }
        setClients(previousClients);
        setPayments(previousPayments);
        setSyncStatus("error");
        setSyncErrorMessage("No se pudo eliminar el pago en nube. Actualiza el historial y vuelve a intentar.");
        return false;
      }
    }

    setClients(nextClients);
    setPayments(nextPayments);
    if (!isSupabaseOnlyMode) {
      saveClients(nextClients);
      savePayments(nextPayments);
    }
    setSyncStatus("ok");
    setSyncErrorMessage("");
    setLastSyncAt(new Date().toLocaleTimeString());
    setHasPendingChanges(true);
    return true;
  }

  async function persistDeletedPayment(nextClients: Client[], nextPayments: Payment[], deletedPaymentId: string): Promise<boolean> {
    return persistDeletedPayments(nextClients, nextPayments, [deletedPaymentId]);
  }

  function reloadSettingsFromLocalCache(): void {
    setBankRules(loadBankRules());
    setLateFeeSettings(loadLateFeeSettings());
    setOtherChargesRetentionByClient(loadOtherChargesRetentionByClient());
  }

  async function reloadSettingsFromCloud(ownerUserId: string): Promise<void> {
    const [cloudBankRules, cloudLateFeeSettings, cloudOtherChargesRetention] = await Promise.all([
      loadCloudBankRules(ownerUserId),
      loadCloudLateFeeSettings(ownerUserId),
      loadCloudOtherChargesRetention(ownerUserId)
    ]);

    setBankRules(cloudBankRules);
    saveBankRules(cloudBankRules);

    if (cloudLateFeeSettings) {
      saveLateFeeSettings(cloudLateFeeSettings);
      setLateFeeSettings(loadLateFeeSettings());
    }

    if (cloudOtherChargesRetention) {
      saveOtherChargesRetentionByClient(cloudOtherChargesRetention);
      setOtherChargesRetentionByClient(loadOtherChargesRetentionByClient());
    }
  }

  function handleSettingsCloudError(error: unknown): void {
    console.error("No se pudo guardar configuracion en Supabase.", error);
    setSyncStatus("error");
    setSyncErrorMessage(`No se pudo guardar configuracion en nube. ${describeCloudError(error)}`);
  }

  function persistBankRules(next: BankRule[]): void {
    if (!canEditSettings) return;
    setBankRules(next);
    saveBankRules(next);
    if (cloudDataUserId) {
      void saveCloudBankRules(cloudDataUserId, next).catch(handleSettingsCloudError);
    }
    setHasPendingChanges(true);
  }

  function persistLateFeeSettings(next: LateFeeSettings): void {
    if (!canEditSettings) return;
    saveLateFeeSettings(next);
    const normalized = loadLateFeeSettings();
    setLateFeeSettings(normalized);
    if (cloudDataUserId) {
      void saveCloudLateFeeSettings(cloudDataUserId, normalized).catch(handleSettingsCloudError);
    }
    setHasPendingChanges(true);
  }

  function persistOtherChargesRetentionByClient(next: OtherChargesRetentionByClient): void {
    if (!canEditSettings) return;
    saveOtherChargesRetentionByClient(next);
    const normalized = loadOtherChargesRetentionByClient();
    setOtherChargesRetentionByClient(normalized);
    if (cloudDataUserId) {
      void saveCloudOtherChargesRetention(cloudDataUserId, normalized).catch(handleSettingsCloudError);
    }
    setHasPendingChanges(true);
  }

  async function persistLeadEvaluations(next: LeadEvaluation[]): Promise<void> {
    if (!canEditLeads) return;
    if (!cloudDataUserId) {
      setLeadsCloudError("No hay dataset cloud configurado para guardar Leads.");
      return;
    }
    const previous = leadEvaluations;
    setLeadEvaluations(next);
    setLeadsCloudError("");
    try {
      const previousById = new Map(previous.map((item) => [item.id, item]));
      const nextById = new Map(next.map((item) => [item.id, item]));
      const removedIds = previous.map((item) => item.id).filter((id) => !nextById.has(id));
      const changedItems = next.filter((item) => !stableEqual(previousById.get(item.id), item));

      for (const item of changedItems) {
        await saveCloudLeadEvaluation(cloudDataUserId, item);
      }
      for (const id of removedIds) {
        await deleteCloudLeadEvaluation(cloudDataUserId, id);
      }
      setHasPendingChanges(true);
    } catch (error) {
      console.error("No se pudo guardar Leads en Supabase.", error);
      setLeadEvaluations(previous);
      setLeadsCloudError(`No se pudo guardar el Lead en nube. ${describeCloudError(error)}`);
      throw error;
    }
  }

  async function loadFullLeadEvaluation(evaluationId: string): Promise<LeadEvaluation | null> {
    if (!cloudDataUserId) return null;
    const full = await loadCloudLeadEvaluation(cloudDataUserId, evaluationId);
    if (!full) return null;
    setLeadEvaluations((current) => current.map((item) => item.id === full.id ? full : item));
    return full;
  }

  function handleFleetClientStatusSync(payload: {
    unitId: string;
    status: Client["status"] | "libre";
    archivedClientIds: string[];
    updatedClientIds: string[];
    statusComment?: string;
    archivedAt?: string;
  }): void {
    const archivedIds = new Set(payload.archivedClientIds);
    const updatedIds = new Set(payload.updatedClientIds);
    if (archivedIds.size === 0 && updatedIds.size === 0) return;

    setClients((current) => current.map((client) => {
      if (archivedIds.has(client.id)) {
        return {
          ...client,
          status: "archivado",
          statusComment: payload.statusComment,
          archivedAt: payload.archivedAt ?? new Date().toISOString()
        };
      }
      if (updatedIds.has(client.id) && payload.status !== "libre") {
        if (payload.status === "activo") {
          return {
            ...client,
            status: "activo",
            statusComment: undefined,
            archivedAt: undefined,
            lastChargeDate: getBusinessDateKey()
          };
        }
        return {
          ...client,
          status: payload.status,
          statusComment: payload.statusComment
        };
      }
      return client;
    }));
  }

  function describeCloudError(error: unknown): string {
    const record = typeof error === "object" && error !== null ? error as Record<string, unknown> : null;
    const code = typeof record?.code === "string" ? record.code : "";
    const message = error instanceof Error
      ? error.message
      : typeof record?.message === "string"
      ? record.message
      : "";
    const details = typeof record?.details === "string" ? record.details : "";
    const hint = typeof record?.hint === "string" ? record.hint : "";
    const raw = [code, message, details, hint].filter(Boolean).join(" | ");
    return raw ? `Motivo: ${raw.slice(0, 260)}` : "Revisa la conexion e intenta de nuevo.";
  }


  async function validateBackupFile(file: File): Promise<BackupImportReport> {
    const content = await file.text();
    return analyzeBackupFileContent(file.name, content);
  }

  async function applyBackupImport(report: BackupImportReport): Promise<{ ok: boolean; message: string }> {
    if (!canEditSettings) {
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
      const importedChargeRuns = Array.isArray(report.normalizedData["cobrapp.module2.charge_runs.v1"])
        ? report.normalizedData["cobrapp.module2.charge_runs.v1"] as never[]
        : [];
      if (cloudDataUserId && isSupabaseOnlyMode) {
        await saveCloudChargeRuns(cloudDataUserId, importedChargeRuns);
      } else {
        localStorage.setItem("cobrapp.module2.charge_runs.v1", JSON.stringify(importedChargeRuns));
      }
      localStorage.setItem("cobrapp.module3.street_management.v1", JSON.stringify(report.normalizedData["cobrapp.module3.street_management.v1"] ?? {}));
      await persistLeadEvaluations(Array.isArray(report.normalizedData["cobrapp.module4.leads.v1"]) ? report.normalizedData["cobrapp.module4.leads.v1"] as LeadEvaluation[] : []);
      if (cloudDataUserId) {
        const fleetUnitsRaw = report.normalizedData["cobrapp.module5.fleet_units.v1"];
        const fleetUnits = Array.isArray(fleetUnitsRaw) ? fleetUnitsRaw : [];
        await Promise.all(
          fleetUnits
            .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row))
            .map((row) => {
              const unitId = typeof row.unit_id === "string" ? row.unit_id.trim().toUpperCase() : "";
              if (!unitId) return Promise.resolve();
              const payload: Record<string, unknown> = {
                user_id: cloudDataUserId,
                unit_id: unitId
              };
              for (const field of FLEET_UNIT_RESTORE_FIELDS) {
                if (field in row) payload[field] = row[field];
              }
              return saveControlUnit({
                ...payload,
                user_id: cloudDataUserId,
                unit_id: unitId
              });
            })
        );
      }
      localStorage.setItem("cobrapp.payments.seq.v1", String(Number(report.normalizedData["cobrapp.payments.seq.v1"] ?? 0) || 0));
      localStorage.setItem("cobrapp.clients.status_filter.v1", String(report.normalizedData["cobrapp.clients.status_filter.v1"] ?? ""));
      setHasPendingChanges(true);

      return { ok: true, message: "Respaldo importado correctamente. Ya puedes continuar con la migracion cloud." };
    } catch (error) {
      console.error("Fallo importando respaldo.", error);
      return { ok: false, message: "No se pudo importar el respaldo completo. Revisa consola y vuelve a intentar." };
    }
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
        setSignOutSyncError("Fallo la sincronizacion final con nube. Revisa tu conexion e intenta nuevamente.");
        return;
      }
    }
    await runBackup("signout", false);
    setSignOutSyncError("");
    await onSignOut?.();
  }

  if (userId && !cloudReady && !cloudBootTimedOut) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <h1>Rentautos</h1>
          <p>Cargando data de nube...</p>
        </section>
      </main>
    );
  }

  return (
    <>
      <AppNavigation
        page={page}
        canViewLeads={canViewLeads}
        canViewClients={canViewClients}
        canViewPayments={canViewPayments}
        canViewReceivables={canViewReceivables}
        canViewControlUnits={canViewControlUnits}
        canViewSettings={canViewSettingsPage}
        showCoreSyncStatus={shouldSyncCoreData}
        syncStatus={syncStatus}
        syncErrorMessage={syncErrorMessage}
        lastSyncAt={lastSyncAt}
        userEmail={userEmail}
        canSignOut={Boolean(onSignOut)}
        onPageChange={setPage}
        onSignOut={() => void handleSignOutWithBackup()}
      />
      <main className="page">
        {signOutSyncError && (
          <div className="error-banner app-shell-error" role="alert">
            <strong>No se pudo cerrar sesion.</strong> {signOutSyncError}
            <button
              type="button"
              className="button ghost small"
              onClick={() => {
                setSignOutSyncError("");
                void handleSignOutWithBackup();
              }}
            >
              Reintentar
            </button>
          </div>
        )}
        <Suspense fallback={<section className="panel"><p className="hint">Cargando modulo...</p></section>}>
        {page === "clients" && canViewClients && (
          <ClientsPage
            clients={clients}
            onClientsChange={persistClients}
            onClientsRefresh={refreshClientsFromCloud}
            dataOwnerUserId={cloudDataUserId}
            readOnly={!canEditClients}
          />
        )}
        {page === "leads" && canViewLeads && (
          <LeadsPage
            evaluations={leadEvaluations}
            onEvaluationsChange={persistLeadEvaluations}
            onEvaluationLoad={loadFullLeadEvaluation}
            loading={leadsLoading}
            cloudError={leadsCloudError}
            readOnly={!canEditLeads}
          />
        )}
        {page === "payments" && canViewPayments && (
          <PaymentsPage
            clients={clients}
            bankRules={bankRules}
            lateFeeSettings={lateFeeSettings}
            otherChargesRetentionByClient={otherChargesRetentionByClient}
            onClientsChange={persistClients}
            payments={payments}
            onPaymentsChange={persistPayments}
            onPersistClientPayment={persistClientsAndPayments}
            onDeletePayment={persistDeletedPayment}
            onDeletePayments={persistDeletedPayments}
            dataOwnerUserId={cloudDataUserId}
            isPaymentHistoryLoaded={fullPaymentHistoryLoaded}
            onRefreshPayments={refreshPaymentsFromSource}
            onCashClose={() => void runBackup("cash_closing", true)}
            onCashClosingDateChange={setReceivablesDateKey}
            quickCashPrefill={cashPaymentPrefill}
            onQuickCashPrefillConsumed={() => setCashPaymentPrefill(null)}
            readOnly={!canEditPayments}
          />
        )}
        {page === "receivables" && canViewReceivables && (
          <ReceivablesPage
            clients={clients}
            payments={payments}
            onClientsChange={persistClients}
            dataOwnerUserId={cloudDataUserId}
            receivablesDateKey={receivablesDateKey}
            streetManagementData={parseLocalJson("cobrapp.module3.street_management.v1", {}) as Record<string, unknown>}
            onStreetManagementPersist={async (value) => {
              localStorage.setItem("cobrapp.module3.street_management.v1", JSON.stringify(value));
              setHasPendingChanges(true);
              return true;
            }}
          />
        )}
        {page === "insurance_workflow" && canViewReceivables && (
          <InsuranceWorkflowPage clients={clients} />
        )}
        {page === "control_units" && canViewControlUnits && (
          <ControlUnitsPage
            dataOwnerUserId={cloudDataUserId}
            readOnly={!canEditControlUnits}
            clients={clients}
            onFleetClientStatusSync={handleFleetClientStatusSync}
          />
        )}
        {page === "settings" && canViewSettingsPage && (
          <SettingsPage
            currentUserId={userId}
            canViewSettings={canViewSettings}
            canEditSettings={canEditSettings}
            canManageUsers={canManageUsers}
            bankRules={bankRules}
            clients={clients}
            lateFeeSettings={lateFeeSettings}
            otherChargesRetentionByClient={otherChargesRetentionByClient}
            onBankRulesChange={persistBankRules}
            onClientsChange={persistClients}
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
        </Suspense>
      </main>
    </>
  );
}
