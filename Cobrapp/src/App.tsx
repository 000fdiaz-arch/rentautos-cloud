import { useEffect, useState } from "react";
import ClientsPage from "./pages/ClientsPage";
import PaymentsPage from "./pages/PaymentsPage";
import SettingsPage from "./pages/SettingsPage";
import { loadBankRules, loadClients, loadPayments, saveBankRules, saveClients, savePayments } from "./storage";
import {
  autoBackup,
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

  // Check on load if a folder is already saved
  useEffect(() => {
    getBackupHandle().then((h) => setBackupConfigured(!!h));
  }, []);

  // Flash the backup status indicator for 2 seconds
  function flashStatus(ok: boolean) {
    setBackupStatus(ok ? "ok" : "error");
    setTimeout(() => setBackupStatus("idle"), 2000);
  }

  async function persistClients(next: Client[]): Promise<void> {
    setClients(next);
    saveClients(next);
    const ok = await autoBackup(next, payments);
    if (backupConfigured) flashStatus(ok);
  }

  async function persistPayments(next: Payment[]): Promise<void> {
    setPayments(next);
    savePayments(next);
    const ok = await autoBackup(clients, next);
    if (backupConfigured) flashStatus(ok);
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
      const ok = await autoBackup(clients, payments);
      flashStatus(ok);
    }
  }

  async function handleRemoveBackup() {
    await removeBackupFolder();
    setBackupConfigured(false);
    setBackupStatus("idle");
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
