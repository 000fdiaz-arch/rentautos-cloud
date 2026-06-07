type CloudSnapshotRecord = {
  id: string;
  user_id: string;
  key: string;
  payload: string;
  updated_at: string;
};

export type CloudSyncQueueStatus = "pending" | "error" | "rejected";

export type CloudSyncQueueItem = {
  id: string;
  user_id: string;
  entity_type: string;
  entity_id: string;
  action: "upsert" | "replace";
  payload: string;
  status: CloudSyncQueueStatus;
  retry_count: number;
  last_error: string;
  created_at: string;
  updated_at: string;
};

const DB_NAME = "cobrapp-cloud-resilience";
const DB_VERSION = 1;
const SNAPSHOTS_STORE = "snapshots";
const QUEUE_STORE = "sync_queue";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SNAPSHOTS_STORE)) {
        const store = db.createObjectStore(SNAPSHOTS_STORE, { keyPath: "id" });
        store.createIndex("by_user", "user_id", { unique: false });
        store.createIndex("by_key", ["user_id", "key"], { unique: true });
      }
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        const store = db.createObjectStore(QUEUE_STORE, { keyPath: "id" });
        store.createIndex("by_user", "user_id", { unique: false });
        store.createIndex("by_status", ["user_id", "status"], { unique: false });
        store.createIndex("by_updated", "updated_at", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("No se pudo abrir IndexedDB de resiliencia."));
  });
}

async function withDB<T>(work: (db: IDBDatabase) => Promise<T> | T): Promise<T> {
  const db = await openDB();
  try {
    return await work(db);
  } finally {
    db.close();
  }
}

function snapshotId(userId: string, key: string): string {
  return `${userId}::${key}`;
}

function queueId(userId: string, entityType: string, entityId: string, action: string): string {
  return `${userId}::${entityType}::${entityId}::${action}`;
}

export async function saveCloudSnapshot(userId: string, key: string, payload: unknown): Promise<void> {
  const record: CloudSnapshotRecord = {
    id: snapshotId(userId, key),
    user_id: userId,
    key,
    payload: JSON.stringify(payload ?? null),
    updated_at: new Date().toISOString()
  };
  await withDB((db) => new Promise<void>((resolve, reject) => {
    const tx = db.transaction(SNAPSHOTS_STORE, "readwrite");
    tx.objectStore(SNAPSHOTS_STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("No se pudo guardar snapshot cloud."));
  }));
}

export async function loadCloudSnapshot<T>(userId: string, key: string): Promise<T | null> {
  return withDB((db) => new Promise<T | null>((resolve, reject) => {
    const tx = db.transaction(SNAPSHOTS_STORE, "readonly");
    const index = tx.objectStore(SNAPSHOTS_STORE).index("by_key");
    const req = index.get([userId, key]);
    req.onsuccess = () => {
      const row = req.result as CloudSnapshotRecord | undefined;
      if (!row?.payload) return resolve(null);
      try {
        resolve(JSON.parse(row.payload) as T);
      } catch {
        resolve(null);
      }
    };
    req.onerror = () => reject(req.error ?? new Error("No se pudo leer snapshot cloud."));
  }));
}

export async function enqueueCloudSyncItem(item: Omit<CloudSyncQueueItem, "id" | "created_at" | "updated_at" | "status" | "retry_count" | "last_error"> & Partial<Pick<CloudSyncQueueItem, "id">>): Promise<void> {
  const now = new Date().toISOString();
  const row: CloudSyncQueueItem = {
    id: item.id ?? queueId(item.user_id, item.entity_type, item.entity_id, item.action),
    user_id: item.user_id,
    entity_type: item.entity_type,
    entity_id: item.entity_id,
    action: item.action,
    payload: item.payload,
    status: "pending",
    retry_count: 0,
    last_error: "",
    created_at: now,
    updated_at: now
  };

  await withDB((db) => new Promise<void>((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, "readwrite");
    tx.objectStore(QUEUE_STORE).put(row);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("No se pudo encolar cambio cloud."));
  }));
}

export async function listPendingCloudSyncItems(userId: string): Promise<CloudSyncQueueItem[]> {
  return withDB((db) => new Promise<CloudSyncQueueItem[]>((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, "readonly");
    const index = tx.objectStore(QUEUE_STORE).index("by_user");
    const req = index.getAll(userId);
    req.onsuccess = () => {
      const rows = (req.result as CloudSyncQueueItem[])
        .filter((row) => row.status === "pending" || row.status === "error")
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
      resolve(rows);
    };
    req.onerror = () => reject(req.error ?? new Error("No se pudo leer la cola cloud."));
  }));
}

export async function listCloudSyncItems(userId: string): Promise<CloudSyncQueueItem[]> {
  return withDB((db) => new Promise<CloudSyncQueueItem[]>((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, "readonly");
    const index = tx.objectStore(QUEUE_STORE).index("by_user");
    const req = index.getAll(userId);
    req.onsuccess = () => {
      const rows = req.result as CloudSyncQueueItem[];
      rows.sort((a, b) => a.created_at.localeCompare(b.created_at));
      resolve(rows);
    };
    req.onerror = () => reject(req.error ?? new Error("No se pudo leer la cola cloud."));
  }));
}

export async function upsertCloudSyncItemStatus(
  id: string,
  patch: Partial<Pick<CloudSyncQueueItem, "status" | "retry_count" | "last_error">>
): Promise<void> {
  await withDB((db) => new Promise<void>((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, "readwrite");
    const store = tx.objectStore(QUEUE_STORE);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const current = (getReq.result as CloudSyncQueueItem | undefined);
      if (!current) {
        resolve();
        return;
      }
      const next: CloudSyncQueueItem = {
        ...current,
        ...patch,
        updated_at: new Date().toISOString()
      };
      store.put(next);
    };
    getReq.onerror = () => reject(getReq.error ?? new Error("No se pudo actualizar cola cloud."));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("No se pudo actualizar cola cloud."));
  }));
}

export async function removeCloudSyncItem(id: string): Promise<void> {
  await withDB((db) => new Promise<void>((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, "readwrite");
    tx.objectStore(QUEUE_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("No se pudo eliminar cola cloud."));
  }));
}

export async function countPendingCloudSyncItems(userId: string): Promise<number> {
  const items = await listPendingCloudSyncItems(userId);
  return items.filter((row) => row.status === "pending" || row.status === "error").length;
}

export async function loadQueuedCloudPayload(
  userId: string,
  entity_type: string,
  entity_id: string,
  action: "upsert" | "replace"
): Promise<string | null> {
  const items = await listPendingCloudSyncItems(userId);
  const found = [...items].reverse().find((item) => item.entity_type === entity_type && item.entity_id === entity_id && item.action === action);
  return found?.payload ?? null;
}
