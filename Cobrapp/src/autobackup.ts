import type { Client, Payment } from "./types";

const DB_NAME = "cobrapp-autobackup";
const STORE = "handles";
const KEY = "backupDir";

export type BackupFailureCode =
  | "not_configured"
  | "indexeddb_error"
  | "permission_denied"
  | "handle_unavailable"
  | "write_failed";

export type BackupResult =
  | { ok: true; code: "ok"; message: string }
  | { ok: false; code: BackupFailureCode; message: string };

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
    const data = {
      version: 1,
      exportedAt: new Date().toISOString(),
      clients,
      payments,
    };

    const fileHandle = await handle.getFileHandle("cobrapp-backup.json", { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(data, null, 2));
    await writable.close();
    return {
      ok: true,
      code: "ok",
      message: "Respaldo guardado correctamente."
    };
  } catch {
    return {
      ok: false,
      code: "write_failed",
      message: "Error al escribir cobrapp-backup.json en la carpeta seleccionada."
    };
  }
}
