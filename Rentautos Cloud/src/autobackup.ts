import type { Client, Payment } from "./types";

const DB_NAME = "cobrapp-autobackup";
const STORE = "handles";
const KEY = "backupDir";
const LATEST_BACKUP_FILENAME = "cobrapp-backup.json";
const VERSIONED_BACKUP_PREFIX = "cobrapp-backup";
const MAX_VERSIONED_BACKUPS = 30;
const VERSIONED_BACKUP_REGEX = /^cobrapp-backup-\d{8}-\d{6}\.json$/;

export type BackupFailureCode =
  | "not_configured"
  | "indexeddb_error"
  | "permission_denied"
  | "handle_unavailable"
  | "write_failed";

export type BackupResult =
  | { ok: true; code: "ok"; message: string }
  | { ok: false; code: BackupFailureCode; message: string };

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function buildVersionedBackupFilename(date: Date): string {
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  const hours = pad2(date.getHours());
  const minutes = pad2(date.getMinutes());
  const seconds = pad2(date.getSeconds());
  return `${VERSIONED_BACKUP_PREFIX}-${year}${month}${day}-${hours}${minutes}${seconds}.json`;
}

async function writeBackupFile(
  handle: FileSystemDirectoryHandle,
  filename: string,
  payload: string
): Promise<void> {
  const fileHandle = await handle.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(payload);
  await writable.close();
}

async function pruneOldVersionedBackups(handle: FileSystemDirectoryHandle): Promise<void> {
  const versionedFiles: string[] = [];
  for await (const [name, entry] of handle.entries()) {
    if (entry.kind !== "file") continue;
    if (!VERSIONED_BACKUP_REGEX.test(name)) continue;
    versionedFiles.push(name);
  }

  if (versionedFiles.length <= MAX_VERSIONED_BACKUPS) return;

  // Names use YYYYMMDD-HHMMSS; lexicographic order is chronological.
  versionedFiles.sort((a, b) => b.localeCompare(a));
  const filesToDelete = versionedFiles.slice(MAX_VERSIONED_BACKUPS);
  for (const file of filesToDelete) {
    await handle.removeEntry(file);
  }
}

// -- IndexedDB helpers ------------------------------------------------------

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(handle, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadHandle(): Promise<FileSystemDirectoryHandle | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(KEY);
    req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandle) ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function clearHandle(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// -- Public API -------------------------------------------------------------

/** Returns true if browser supports the File System Access API */
export function isAutoBackupSupported(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

/** Returns the saved folder handle, or null if not configured yet */
export async function getBackupHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await loadHandle();
  } catch {
    return null;
  }
}

/**
 * Prompts the user to pick a backup folder and saves the handle for future use.
 * Returns the chosen handle, or null if the user cancelled.
 */
export async function configureBackupFolder(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const handle = await (window as Window & typeof globalThis & {
      showDirectoryPicker: (opts?: Record<string, unknown>) => Promise<FileSystemDirectoryHandle>;
    }).showDirectoryPicker({ mode: "readwrite", id: "cobrapp-backup" });
    await saveHandle(handle);
    return handle;
  } catch {
    // User cancelled or permission denied
    return null;
  }
}

/** Clears the saved backup folder */
export async function removeBackupFolder(): Promise<void> {
  await clearHandle();
}

/** Writes the backup JSON to the configured folder. Returns true on success. */
export async function autoBackup(clients: Client[], payments: Payment[]): Promise<boolean> {
  const result = await autoBackupDetailed(clients, payments);
  return result.ok;
}

/** Writes the backup JSON and returns detailed status for UI/audit feedback. */
export async function autoBackupDetailed(clients: Client[], payments: Payment[]): Promise<BackupResult> {
  let handle: FileSystemDirectoryHandle | null = null;
  try {
    handle = await loadHandle();
  } catch {
    return {
      ok: false,
      code: "indexeddb_error",
      message: "No se pudo leer la configuracion de respaldo (IndexedDB)."
    };
  }

  if (!handle) {
    return {
      ok: false,
      code: "not_configured",
      message: "No hay carpeta de respaldo configurada."
    };
  }

  try {
    // Verify we still have permission
    const perm = await handle.queryPermission({ mode: "readwrite" });
    if (perm !== "granted") {
      const req = await handle.requestPermission({ mode: "readwrite" });
      if (req !== "granted") {
        return {
          ok: false,
          code: "permission_denied",
          message: "Permiso denegado para escribir en la carpeta de respaldo."
        };
      }
    }
  } catch {
    return {
      ok: false,
      code: "handle_unavailable",
      message: "La carpeta de respaldo ya no esta disponible. Reconecta la carpeta."
    };
  }

  try {
    const now = new Date();
    const data = {
      version: 1,
      exportedAt: now.toISOString(),
      clients,
      payments,
    };
    const payload = JSON.stringify(data, null, 2);
    const versionedFilename = buildVersionedBackupFilename(now);

    // Keep the latest snapshot name for fast manual restore.
    await writeBackupFile(handle, LATEST_BACKUP_FILENAME, payload);
    // Also keep historical snapshots with timestamped filenames.
    await writeBackupFile(handle, versionedFilename, payload);
    // Keep storage under control by retaining only recent historical snapshots.
    await pruneOldVersionedBackups(handle);

    return {
      ok: true,
      code: "ok",
      message: `Respaldo guardado: ${LATEST_BACKUP_FILENAME} y ${versionedFilename}.`
    };
  } catch {
    return {
      ok: false,
      code: "write_failed",
      message: "Error al escribir archivos de respaldo en la carpeta seleccionada."
    };
  }
}
