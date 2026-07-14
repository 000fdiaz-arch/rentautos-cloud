import { useEffect, useState } from "react";
import ClientsPage from "./pages/ClientsPage";
import LeadsPage from "./pages/LeadsPage";
import PaymentsPage from "./pages/PaymentsPage";
import SettingsPage from "./pages/SettingsPage";
import ControlUnitsPage from "./pages/ControlUnitsPage";
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
  saveManualBankAssignmentAudit,
  saveLateFeeLedger,
} from "./storage";
import { deleteCloudLeadEvaluation, loadCloudLeadEvaluations, saveCloudLeadEvaluation } from "./cloudData";
import { flushCloudMirror } from "./cloudMirror";
import { isSupabaseOnlyMode } from "./persistenceMode";
import { analyzeBackupFileContent, type BackupImportReport } from "./backupImport";
import type { BackupExtraData } from "./autobackup";
import type { BankRule, Client, LateFeeSettings, LeadEvaluation, OtherChargesRetentionByClient, Payment } from "./types";
import { parseLocalJson } from "./app/appShellRules";
import AppNavigation, { type AppPage } from "./app/AppNavigation";
import { useBackupManager } from "./app/useBackupManager";
import { useCoreCloudSync } from "./app/useCoreCloudSync";
import "./styles.css";

type AppShellProps = {
  userId?: string;
  userEmail?: string;
  appRole?: "admin" | "operador" | "lectura";
  dataOwnerUserId?: string | null;
  onSignOut?: () => void;
};

export default function AppShell({ userId, userEmail, appRole = "lectura", dataOwnerUserId, onSignOut }: AppShellProps) {
  const isReadOnlyReceivables = appRole === "lectura";
  // TODO multiusuario: crear/probar un usuario "lectura" real antes de produccion.
  // Debe poder consultar el dataset asignado sin guardar cambios en ningun modulo.
  const canWriteOperationalData = appRole === "admin" || appRole === "operador";
  const canManageSettings = appRole === "admin";
  // Shared dataset mode: when a data owner is configured, all roles work on that same owner dataset.
  const cloudDataUserId = dataOwnerUserId ?? userId;
  const [page, setPage] = useState<AppPage>(isReadOnlyReceivables ? "control_units" : "clients");
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
    userId,
    ownerUserId: cloudDataUserId,
    isReadOnly: isReadOnlyReceivables,
    clients,
    payments,
    setClients,
    setPayments,
    fullPaymentHistoryLoaded,
    setFullPaymentHistoryLoaded,
    onSettingsReload: () => {
      setBankRules(loadBankRules());
      setLateFeeSettings(loadLateFeeSettings());
      setOtherChargesRetentionByClient(loadOtherChargesRetentionByClient());
    }
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
  } = useBackupManager({ clients, payments, buildExtraData: buildBackupExtraData });

  useEffect(() => {
    if (isReadOnlyReceivables && page !== "control_units") {
      setPage("control_units");
      return;
    }
    if (!canManageSettings && page === "settings") {
      setPage(isReadOnlyReceivables ? "control_units" : "clients");
    }
  }, [canManageSettings, isReadOnlyReceivables, page]);

  useEffect(() => {
    let cancelled = false;
    if (!canWriteOperationalData || !cloudDataUserId) {
      setLeadEvaluations([]);
      setLeadsLoading(false);
      setLeadsCloudError("");
      return () => {
        cancelled = true;
      };
    }
    setLeadsLoading(true);
    setLeadsCloudError("");
    void loadCloudLeadEvaluations(cloudDataUserId)
      .then((items) => {
        if (cancelled) return;
        setLeadEvaluations(items);
      })
      .catch((error) => {
        console.error("No se pudo cargar Leads desde Supabase.", error);
        if (!cancelled) setLeadsCloudError("No se pudieron cargar los Leads desde nube.");
      })
      .finally(() => {
        if (!cancelled) setLeadsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canWriteOperationalData, cloudDataUserId]);

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
      streetManagement: parseLocalJson("cobrapp.module3.street_management.v1", {}) as Record<string, unknown>,
      leadEvaluations,
      statusFilter: String(localStorage.getItem("cobrapp.clients.status_filter.v1") ?? "active")
    };
  }

  async function persistClients(next: Client[]): Promise<void> {
    if (!canWriteOperationalData) return;
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

  async function persistPayments(next: Payment[]): Promise<void> {
    if (!canWriteOperationalData) return;
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

  async function persistLeadEvaluations(next: LeadEvaluation[]): Promise<void> {
    if (!canWriteOperationalData) return;
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
      const changedItems = next.filter((item) => JSON.stringify(previousById.get(item.id)) !== JSON.stringify(item));

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
      await persistLeadEvaluations(Array.isArray(report.normalizedData["cobrapp.module4.leads.v1"]) ? report.normalizedData["cobrapp.module4.leads.v1"] as LeadEvaluation[] : []);
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
        window.alert("No se cerro sesion porque fallo la sincronizacion final con nube. Revisa tu conexion e intenta nuevamente.");
        return;
      }
    }
    await runBackup("signout", false);
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
        canWriteOperationalData={canWriteOperationalData}
        canManageSettings={canManageSettings}
        syncStatus={syncStatus}
        syncErrorMessage={syncErrorMessage}
        lastSyncAt={lastSyncAt}
        userEmail={userEmail}
        canSignOut={Boolean(onSignOut)}
        onPageChange={setPage}
        onSignOut={() => void handleSignOutWithBackup()}
      />
      <main className="page">
        {page === "clients" && canWriteOperationalData && (
          <ClientsPage
            clients={clients}
            onClientsChange={persistClients}
            dataOwnerUserId={cloudDataUserId}
          />
        )}
        {page === "leads" && canWriteOperationalData && (
          <LeadsPage
            evaluations={leadEvaluations}
            onEvaluationsChange={persistLeadEvaluations}
            loading={leadsLoading}
            cloudError={leadsCloudError}
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
      </main>
    </>
  );
}
