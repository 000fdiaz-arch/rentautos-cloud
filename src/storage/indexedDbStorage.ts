const INDEXED_DB_NAME = "cobrapp-storage";
const INDEXED_DB_STORE = "kv";

function openStorageDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(INDEXED_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(INDEXED_DB_STORE)) {
        db.createObjectStore(INDEXED_DB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("No se pudo abrir IndexedDB."));
  });
}

export async function writeIndexedDb(key: string, value: unknown): Promise<void> {
  const db = await openStorageDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(INDEXED_DB_STORE, "readwrite");
      const store = tx.objectStore(INDEXED_DB_STORE);
      store.put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("No se pudo guardar en IndexedDB."));
      tx.onabort = () => reject(tx.error ?? new Error("Se aborto el guardado en IndexedDB."));
    });
  } finally {
    db.close();
  }
}

export async function readIndexedDb(key: string): Promise<unknown> {
  const db = await openStorageDb();
  try {
    return await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction(INDEXED_DB_STORE, "readonly");
      const store = tx.objectStore(INDEXED_DB_STORE);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("No se pudo leer desde IndexedDB."));
    });
  } finally {
    db.close();
  }
}

export async function deleteIndexedDb(key: string): Promise<void> {
  const db = await openStorageDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(INDEXED_DB_STORE, "readwrite");
      const store = tx.objectStore(INDEXED_DB_STORE);
      store.delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("No se pudo borrar desde IndexedDB."));
      tx.onabort = () => reject(tx.error ?? new Error("Se aborto el borrado en IndexedDB."));
    });
  } finally {
    db.close();
  }
}
