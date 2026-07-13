import { useEffect, useState } from "react";
import {
  autoBackupDetailed,
  configureBackupFolder,
  getBackupHandle,
  isAutoBackupSupported,
  removeBackupFolder,
  type BackupExtraData,
  type BackupTrigger
} from "../autobackup";
import type { Client, Payment } from "../types";

type UseBackupManagerOptions = {
  clients: Client[];
  payments: Payment[];
  buildExtraData: () => BackupExtraData;
};

export function useBackupManager({ clients, payments, buildExtraData }: UseBackupManagerOptions) {
  const [backupSupported] = useState(isAutoBackupSupported);
  const [backupConfigured, setBackupConfigured] = useState(false);
  const [backupStatus, setBackupStatus] = useState("Sin respaldo configurado.");
  const [backupRunning, setBackupRunning] = useState(false);
  const [hasPendingChanges, setHasPendingChanges] = useState(false);
  const [lastBackupAt, setLastBackupAt] = useState("");
  const [lastDailyBackupKey, setLastDailyBackupKey] = useState("");

  async function runBackup(trigger: BackupTrigger, force = false): Promise<{ ok: boolean; message: string }> {
    if (!backupSupported) {
      return { ok: false, message: "Este navegador no soporta respaldo automatico local." };
    }
    if (!force && !hasPendingChanges && trigger !== "manual") {
      return { ok: true, message: "No habia cambios pendientes; respaldo omitido." };
    }
    setBackupRunning(true);
    try {
      const result = await autoBackupDetailed(clients, payments, buildExtraData(), trigger);
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

  async function configureFolder(): Promise<{ ok: boolean; message: string }> {
    if (!backupSupported) return { ok: false, message: "Este navegador no soporta respaldo local." };
    const handle = await configureBackupFolder();
    if (!handle) return { ok: false, message: "No se pudo configurar carpeta (cancelado o sin permisos)." };
    setBackupConfigured(true);
    setBackupStatus("Carpeta de respaldo configurada.");
    return { ok: true, message: "Carpeta de respaldo configurada." };
  }

  async function disconnectFolder(): Promise<{ ok: boolean; message: string }> {
    await removeBackupFolder();
    setBackupConfigured(false);
    setBackupStatus("Respaldo local desconectado.");
    return { ok: true, message: "Respaldo local desconectado." };
  }

  useEffect(() => {
    if (!backupSupported) return;
    let mounted = true;
    void getBackupHandle().then((handle) => {
      if (!mounted) return;
      setBackupConfigured(Boolean(handle));
      setBackupStatus(handle ? "Respaldo configurado." : "Sin respaldo configurado.");
    });
    return () => { mounted = false; };
  }, [backupSupported]);

  useEffect(() => {
    if (!backupSupported) return;
    const timer = window.setInterval(() => {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Panama",
        hour12: false,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
      }).formatToParts(new Date());
      const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? "";
      const dateKey = `${get("year")}-${get("month")}-${get("day")}`;
      if (get("hour") === "17" && get("minute") === "00" && lastDailyBackupKey !== dateKey) {
        setLastDailyBackupKey(dateKey);
        void runBackup("daily_5pm_pa", false);
      }
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [backupSupported, lastDailyBackupKey, hasPendingChanges, clients, payments]);

  return {
    backupSupported,
    backupConfigured,
    backupStatus,
    backupRunning,
    hasPendingChanges,
    lastBackupAt,
    setBackupStatus,
    setHasPendingChanges,
    runBackup,
    configureFolder,
    disconnectFolder
  };
}
