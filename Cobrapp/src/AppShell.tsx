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
  saveBankRules,
  saveLateFeeSettings,
  saveOtherChargesRetentionByClient,
} from "./storage";
import {
  autoBackupDetailed,
  type BackupResult,
  configureBackupFolder,
  getBackupHandle,
  isAutoBackupSupported,
  removeBackupFolder,
} from "./autobackup";
import type { BankRule, Client, LateFeeSettings, OtherChargesRetentionByClient, Payment } from "./types";
import "./styles.css";

type AppPage = "clients" | "payments" | "receivables" | "settings";

type AppShellProps = {
  userEmail?: string;
  onSignOut?: () => void;
};

export default function AppShell({ userEmail, onSignOut }: AppShellProps) {
  const [page, setPage] = useState<AppPage>("clients");
  const [clients, setClients] = useState<Client[]>(() => loadClients());
  const [payments, setPayments] = useState<Payment[]>(() => loadPayments());
  const [bankRules, setBankRules] = useState<BankRule[]>(() => loadBankRules());
  const [lateFeeSettings, setLateFeeSettings] = useState<LateFeeSettings>(() => loadLateFeeSettings());
  const [otherChargesRetentionByClient, setOtherChargesRetentionByClient] = useState<OtherChargesRetentionByClient>(() => loadOtherChargesRetentionByClient());
  const [backupConfigured, setBackupConfigured] = useState<boolean>(false);
  const [backupStatus, setBackupStatus] = useState<"idle" | "ok" | "error">("idle");
  const [backupMessage, setBackupMessage] = useState<string>("");

  // Check on load if a folder is already saved
  useEffect(() => {
    getBackupHandle().then(async (h) => {
      setBackupConfigured(!!h);
      if (!h) {
        setBackupMessage("Sin carpeta de respaldo configurada.");
        return;
      }
      try {
        const perm = await h.queryPermission({ mode: "readwrite" });
        if (perm === "granted") {
          setBackupMessage("Respaldo automatico activo.");
        } else {
          setBackupMessage("Respaldo configurado, pero sin permiso de escritura. Usa Reconectar.");
        }
      } catch {
        setBackupMessage("La carpeta de respaldo no esta disponible. Usa Reconectar.");
      }
    });
  }, []);

  // Flash the backup status indicator for 2 seconds
  function flashStatus(result: BackupResult) {
    setBackupStatus(result.ok ? "ok" : "error");
    setBackupMessage(result.message);
    setTimeout(() => setBackupStatus("idle"), 2000);
  }

  async function persistClients(next: Client[]): Promise<void> {
    setClients(next);
    saveClients(next);
    const result = await autoBackupDetailed(next, payments);
    if (!result.ok && result.code === "not_configured") setBackupConfigured(false);
    if (backupConfigured) flashStatus(result);
  }

  async function persistPayments(next: Payment[]): Promise<void> {
    setPayments(next);
    savePayments(next);
    const result = await autoBackupDetailed(clients, next);
    if (!result.ok && result.code === "not_configured") setBackupConfigured(false);
    if (backupConfigured) flashStatus(result);
  }

  function persistBankRules(next: BankRule[]): void {
    setBankRules(next);
    saveBankRules(next);
  }

  function persistLateFeeSettings(next: LateFeeSettings): void {
    setLateFeeSettings(next);
    saveLateFeeSettings(next);
  }

  function persistOtherChargesRetentionByClient(next: OtherChargesRetentionByClient): void {
    setOtherChargesRetentionByClient(next);
    saveOtherChargesRetentionByClient(next);
  }

  async function handleConfigureBackup() {
    const handle = await configureBackupFolder();
    if (handle) {
      setBackupConfigured(true);
      // Run an immediate backup with current data
      const result = await autoBackupDetailed(clients, payments);
      flashStatus(result);
    }
  }

  async function handleRemoveBackup() {
    await removeBackupFolder();
    setBackupConfigured(false);
    setBackupStatus("idle");
    setBackupMessage("Respaldo removido.");
  }

  async function handleLoadBackup() {
    try {
      const [fileHandle] = await (window as Window & { showOpenFilePicker: (opts: object) => Promise<FileSystemFileHandle[]> }).showOpenFilePicker({
        types: [{ description: "Respaldo Rentautos (JSON)", accept: { "application/json": [".json"] } }],
        multiple: false
      });
      const file = await fileHandle.getFile();
      const text = await file.text();
      const parsed = JSON.parse(text) as { clients?: unknown[]; payments?: unknown[] };
      if (!Array.isArray(parsed?.clients)) {
        alert("El archivo no tiene el formato correcto (se esperaba { clients, payments }).");
        return;
      }
      const nextClients = parsed.clients as Client[];
      const nextPayments = (parsed.payments ?? []) as Payment[];
      saveClients(nextClients);
      savePayments(nextPayments);
      setClients(nextClients);
      setPayments(nextPayments);
      alert(`Datos cargados: ${nextClients.length} cliente(s), ${nextPayments.length} pago(s).`);
    } catch (err) {
      if ((err as { name?: string }).name === "AbortError") return;
      alert("Error al cargar el archivo. Asegurate de seleccionar un respaldo JSON valido.");
    }
  }

  const supported = isAutoBackupSupported();

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
              className={`nav-tab ${page === "payments" ? "nav-tab--active" : ""}`}
              onClick={() => setPage("payments")}
            >
              Pagos
            </button>
            <button
              type="button"
              className={`nav-tab ${page === "receivables" ? "nav-tab--active" : ""}`}
              onClick={() => setPage("receivables")}
            >
              Cuentas por Cobrar
            </button>
            <button
              type="button"
              className={`nav-tab ${page === "settings" ? "nav-tab--active" : ""}`}
              onClick={() => setPage("settings")}
            >
              Configuraciones
            </button>
          </div>

          <div className="backup-nav-zone">
            <button
              type="button"
              className="nav-backup-btn nav-backup-btn--setup"
              onClick={handleLoadBackup}
              title="Carga clientes y pagos desde un archivo JSON de respaldo"
            >
              Cargar respaldo
            </button>
          </div>

          {supported && (
            <div className="backup-nav-zone">
              {backupConfigured ? (
                <>
                  <span
                    className={`backup-dot ${
                      backupStatus === "ok"
                        ? "backup-dot--ok"
                        : backupStatus === "error"
                        ? "backup-dot--error"
                        : "backup-dot--ready"
                    }`}
                    title={
                      backupStatus === "ok"
                        ? "Respaldo guardado"
                        : backupStatus === "error"
                        ? "Error al respaldar"
                        : "Respaldo automatico activo"
                    }
                  />
                  <button
                    type="button"
                    className="nav-backup-btn"
                    title="Quitar carpeta de respaldo"
                    onClick={handleRemoveBackup}
                  >
                    Respaldo OK
                  </button>
                  <button
                    type="button"
                    className="nav-backup-btn nav-backup-btn--setup"
                    title="Volver a elegir carpeta y renovar permisos de respaldo"
                    onClick={handleConfigureBackup}
                  >
                    Reconectar
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="nav-backup-btn nav-backup-btn--setup"
                  onClick={handleConfigureBackup}
                  title="Configura una carpeta para respaldo automatico"
                >
                  Configurar respaldo
                </button>
              )}
              {backupMessage && (
                <span
                  className="hint"
                  style={{ marginLeft: 8, maxWidth: 340, display: "inline-block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", verticalAlign: "middle" }}
                  title={backupMessage}
                >
                  {backupMessage}
                </span>
              )}
            </div>
          )}

          {onSignOut && (
            <div className="backup-nav-zone auth-nav-zone">
              {userEmail && <span className="hint">{userEmail}</span>}
              <button
                type="button"
                className="nav-backup-btn nav-backup-btn--setup"
                onClick={onSignOut}
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
          />
        )}
        {page === "receivables" && (
          <ReceivablesPage
            clients={clients}
            payments={payments}
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
          />
        )}
      </main>
    </>
  );
}
