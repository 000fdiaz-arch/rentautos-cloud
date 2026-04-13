import { useEffect, useState } from "react";
import ClientsPage from "./pages/ClientsPage";
import PaymentsPage from "./pages/PaymentsPage";
import SettingsPage from "./pages/SettingsPage";
import { loadBankRules, loadClients, loadPayments, saveBankRules, saveClients, savePayments } from "./storage";
import {
  autoBackupDetailed,
  type BackupResult,
  configureBackupFolder,
  getBackupHandle,
  isAutoBackupSupported,
  removeBackupFolder,
} from "./autobackup";
import type { BankRule, Client, Payment } from "./types";
import "./styles.css";

type AppPage = "clients" | "payments" | "settings";

export default function App() {
  const [page, setPage] = useState<AppPage>("clients");
  const [clients, setClients] = useState<Client[]>(() => loadClients());
  const [payments, setPayments] = useState<Payment[]>(() => loadPayments());
  const [bankRules, setBankRules] = useState<BankRule[]>(() => loadBankRules());
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
        types: [{ description: "Respaldo Cobrapp (JSON)", accept: { "application/json": [".json"] } }],
        multiple: false
      });
      const file = await fileHandle.getFile();
      const text = await file.text();
      const parsed = JSON.parse(text) as { clients?: unknown[]; payments?: unknown[] };
      if (!Array.isArray(parsed?.clients)) {
        alert("El archivo no tiene el formato correcto (se esperaba { clients, payments }).");
        return;
      }
      // Write raw arrays to localStorage so normalizers can run on load
      localStorage.setItem("cobrapp.module1.clients.v1", JSON.stringify(parsed.clients));
      localStorage.setItem("cobrapp.module2.payments.v1", JSON.stringify(parsed.payments ?? []));
      const nextClients = loadClients();
      const nextPayments = loadPayments();
      setClients(nextClients);
      setPayments(nextPayments);
      saveClients(nextClients);
      savePayments(nextPayments);
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
          <span className="app-nav-brand">Cobrapp</span>
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
            onClientsChange={persistClients}
            payments={payments}
            onPaymentsChange={persistPayments}
          />
        )}
        {page === "settings" && (
          <SettingsPage bankRules={bankRules} onBankRulesChange={persistBankRules} />
        )}
      </main>
    </>
  );
}
