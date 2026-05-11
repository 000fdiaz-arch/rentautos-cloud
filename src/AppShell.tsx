import { useEffect, useState } from "react";
import ClientsPage from "./pages/ClientsPage";
import PaymentsPage from "./pages/PaymentsPage";
import ReceivablesPage from "./pages/ReceivablesPage";
import SettingsPage from "./pages/SettingsPage";
import {
  loadClients,
  loadPayments,
  saveClients,
  savePayments,
  loadBankRules,
  loadLateFeeSettings,
  loadOtherChargesRetentionByClient,
  loadPaymentPromises,
  saveBankRules,
  saveLateFeeSettings,
  saveOtherChargesRetentionByClient,
  savePendingBankItems,
  savePendingCardItems,
  saveManualBankAssignmentAudit,
  savePaymentPromises,
  saveLateFeeLedger,
} from "./storage";
import {
  loadCloudClients,
  loadCloudPayments,
  saveCloudClients,
  saveCloudPayments
} from "./cloudData";
import { disableCloudMirror, flushCloudMirror, initializeCloudMirror } from "./cloudMirror";
import { analyzeBackupFileContent, type BackupImportReport } from "./backupImport";
import { evaluatePaymentPromises } from "./paymentPromises";
import {
  autoBackupDetailed,
  configureBackupFolder,
  getBackupHandle,
  isAutoBackupSupported,
  removeBackupFolder,
  type BackupExtraData,
  type BackupTrigger
} from "./autobackup";
import type { BankRule, Client, LateFeeSettings, OtherChargesRetentionByClient, Payment, PaymentPromise } from "./types";
import "./styles.css";

type AppPage = "clients" | "payments" | "receivables" | "settings";

type AppShellProps = {
  userId?: string;
  userEmail?: string;
  appRole?: "admin" | "operador" | "lectura";
  dataOwnerUserId?: string | null;
  onSignOut?: () => void;
};

export default function AppShell({ userId, userEmail, appRole = "lectura", dataOwnerUserId, onSignOut }: AppShellProps) {
  const isReadOnlyReceivables = appRole === "lectura";
  const cloudDataUserId = isReadOnlyReceivables ? (dataOwnerUserId ?? userId) : userId;
  const [page, setPage] = useState<AppPage>(isReadOnlyReceivables ? "receivables" : "clients");
  const [clients, setClients] = useState<Client[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [bankRules, setBankRules] = useState<BankRule[]>([]);
  const [paymentPromises, setPaymentPromises] = useState<PaymentPromise[]>(() => loadPaymentPromises());
  const [lateFeeSettings, setLateFeeSettings] = useState<LateFeeSettings>(() => loadLateFeeSettings());
  const [otherChargesRetentionByClient, setOtherChargesRetentionByClient] = useState<OtherChargesRetentionByClient>(() => loadOtherChargesRetentionByClient());
  const [cloudReady, setCloudReady] = useState<boolean>(!userId);
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

  function parseLocalJson(key: string, fallback: unknown): unknown {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
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
      paymentPromises: parseLocalJson("cobrapp.module3.payment_promises.v1", []) as unknown[],
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
        if (!isReadOnlyReceivables) {
          await initializeCloudMirror(cloudDataUserId);
        }
        const [cloudClients, cloudPayments] = await Promise.all([
          loadCloudClients(cloudDataUserId),
          loadCloudPayments(cloudDataUserId)
        ]);
        if (cancelled) return;
        setClients(cloudClients);
        setPayments(cloudPayments);
        setBankRules(loadBankRules());
        setPaymentPromises(loadPaymentPromises());
        setLateFeeSettings(loadLateFeeSettings());
        setOtherChargesRetentionByClient(loadOtherChargesRetentionByClient());
        // Mantiene compatibilidad con funciones que aun leen localStorage.
        saveClients(cloudClients);
        savePayments(cloudPayments);
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
    const reevaluatedPromises = evaluatePaymentPromises(paymentPromises, next, new Date());
    setPaymentPromises(reevaluatedPromises);
    savePaymentPromises(reevaluatedPromises);
    setHasPendingChanges(true);
  }

  function persistPaymentPromises(next: PaymentPromise[]): void {
    const reevaluated = evaluatePaymentPromises(next, payments, new Date());
    setPaymentPromises(reevaluated);
    savePaymentPromises(reevaluated);
    setHasPendingChanges(true);
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
      localStorage.setItem("cobrapp.module3.payment_promises.v1", JSON.stringify(report.normalizedData["cobrapp.module3.payment_promises.v1"] ?? []));
      localStorage.setItem("cobrapp.payments.seq.v1", String(Number(report.normalizedData["cobrapp.payments.seq.v1"] ?? 0) || 0));
      localStorage.setItem("cobrapp.clients.status_filter.v1", String(report.normalizedData["cobrapp.clients.status_filter.v1"] ?? ""));
      setPaymentPromises(loadPaymentPromises());
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

  if (cloudDataUserId && !cloudReady) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <h1>Rentautos</h1>
          <p>Cargando data de nube...</p>
        </section>
      </main>
    );
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
            onCashClose={() => void runBackup("cash_closing", true)}
          />
        )}
        {page === "receivables" && (
          <ReceivablesPage
            clients={clients}
            payments={payments}
            paymentPromises={paymentPromises}
            onPaymentPromisesChange={persistPaymentPromises}
            hideCollectedThisMonth={isReadOnlyReceivables}
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
      </main>
    </>
  );
}
