import { useState } from "react";
import type { BackupImportReport } from "../../backupImport";

type Result = { ok: boolean; message: string };

type BackupSettingsPanelsProps = {
  activeTab: "backup" | "migration";
  backupSupported: boolean;
  backupConfigured: boolean;
  backupRunning: boolean;
  backupStatus: string;
  hasPendingChanges: boolean;
  lastBackupAt: string;
  onValidateBackupFile: (file: File) => Promise<BackupImportReport>;
  onApplyBackupImport: (report: BackupImportReport) => Promise<Result>;
  onManualBackup: () => Promise<Result>;
  onConfigureBackupFolder: () => Promise<Result>;
  onDisconnectBackupFolder: () => Promise<Result>;
};

export default function BackupSettingsPanels({
  activeTab,
  backupSupported,
  backupConfigured,
  backupRunning,
  backupStatus,
  hasPendingChanges,
  lastBackupAt,
  onValidateBackupFile,
  onApplyBackupImport,
  onManualBackup,
  onConfigureBackupFolder,
  onDisconnectBackupFolder
}: BackupSettingsPanelsProps) {
  const [report, setReport] = useState<BackupImportReport | null>(null);
  const [importStatus, setImportStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [manualInfo, setManualInfo] = useState("");

  async function handleFileChange(file: File | null): Promise<void> {
    setReport(null);
    setImportStatus("");
    if (!file) return;
    setBusy(true);
    try {
      const next = await onValidateBackupFile(file);
      setReport(next);
      setImportStatus(next.compatible ? "Respaldo compatible." : "El respaldo contiene errores.");
    } catch (error) {
      console.error("No se pudo validar respaldo.", error);
      setImportStatus("No se pudo leer o validar el archivo.");
    } finally {
      setBusy(false);
    }
  }

  async function handleApply(): Promise<void> {
    if (!report) return;
    setBusy(true);
    try {
      const result = await onApplyBackupImport(report);
      setImportStatus(result.message);
    } finally {
      setBusy(false);
    }
  }

  async function run(action: () => Promise<Result>): Promise<void> {
    const result = await action();
    setManualInfo(result.message);
  }

  if (activeTab === "backup") {
    return (
      <section className="panel">
        <div className="panel-head"><h2>Respaldo automatico</h2></div>
        <p className="hint" style={{ marginTop: 0 }}>Flujo activo: 5:00 PM (Panama), cierre de caja y cierre de sesion (si hay cambios).</p>
        <p className="hint">Estado: {backupSupported ? (backupConfigured ? "Configurado" : "No configurado") : "No soportado por navegador"}.</p>
        <p className="hint">Cambios pendientes: {hasPendingChanges ? "Si" : "No"}.</p>
        <p className="hint">Ultimo respaldo: {lastBackupAt || "Sin ejecucion aun"}.</p>
        <p className="hint">Detalle: {backupStatus}.</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
          <button type="button" className="button ghost" onClick={() => void run(onConfigureBackupFolder)} disabled={!backupSupported || backupRunning}>Configurar carpeta</button>
          <button type="button" className="button ghost" onClick={() => void run(onDisconnectBackupFolder)} disabled={!backupConfigured || backupRunning}>Desconectar carpeta</button>
          <button type="button" className="button primary" onClick={() => void run(onManualBackup)} disabled={!backupConfigured || backupRunning}>Generar backup ahora</button>
        </div>
        {manualInfo && <p className="hint" style={{ marginTop: 8 }}>{manualInfo}</p>}
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="panel-head"><h2>Migracion de respaldo</h2></div>
      <p className="hint" style={{ marginTop: 0 }}>Sube un JSON de respaldo para validar compatibilidad antes de migrar/continuar en nube.</p>
      <div className="form-grid">
        <label>Archivo de respaldo (.json)<input type="file" accept=".json,application/json" onChange={(event) => void handleFileChange(event.target.files?.[0] ?? null)} disabled={busy} /></label>
      </div>
      {importStatus && <p className="hint" style={{ marginTop: 10 }}>{importStatus}</p>}
      {report && (
        <>
          <div className="table-scroll" style={{ marginTop: 10 }}>
            <table><thead><tr><th>Archivo</th><th>Compatible</th><th>Clientes</th><th>Pagos</th><th>Secuencia</th></tr></thead>
              <tbody><tr><td>{report.fileName}</td><td>{report.compatible ? "Si" : "No"}</td><td>{String(report.summary.clients ?? 0)}</td><td>{String(report.summary.payments ?? 0)}</td><td>{String(report.summary.seq ?? 0)}</td></tr></tbody>
            </table>
          </div>
          {report.issues.length > 0 && <ul className="error-list">{report.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}
          {report.warnings.length > 0 && <ul className="hint" style={{ marginTop: 8 }}>{report.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
          <div style={{ marginTop: 10 }}><button type="button" className="button primary" onClick={() => void handleApply()} disabled={!report.compatible || busy}>Importar respaldo a la app</button></div>
        </>
      )}
    </section>
  );
}
