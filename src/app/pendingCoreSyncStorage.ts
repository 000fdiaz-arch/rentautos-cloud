import { deleteIndexedDb, readIndexedDb, writeIndexedDb } from "../storage/indexedDbStorage";
import { parsePendingCoreSync, type PendingCoreSyncSnapshot } from "./appShellRules";

export const LEGACY_PENDING_CORE_SYNC_KEY = "cobrapp.cloud.pending_core_sync.v1";
export const PENDING_CORE_SYNC_INDEXED_DB_KEY = "cloud.pending_core_sync.v2";

export async function persistPendingCoreSync(snapshot: PendingCoreSyncSnapshot): Promise<void> {
  await writeIndexedDb(PENDING_CORE_SYNC_INDEXED_DB_KEY, snapshot);
  localStorage.removeItem(LEGACY_PENDING_CORE_SYNC_KEY);
}

export async function clearPendingCoreSync(): Promise<void> {
  await deleteIndexedDb(PENDING_CORE_SYNC_INDEXED_DB_KEY);
  localStorage.removeItem(LEGACY_PENDING_CORE_SYNC_KEY);
}

export async function loadPendingCoreSync(ownerUserId?: string | null): Promise<PendingCoreSyncSnapshot | null> {
  const indexed = await readIndexedDb(PENDING_CORE_SYNC_INDEXED_DB_KEY);
  const indexedSnapshot = parsePendingCoreSync(indexed == null ? null : JSON.stringify(indexed), ownerUserId);
  if (indexedSnapshot) return indexedSnapshot;

  const legacySnapshot = parsePendingCoreSync(localStorage.getItem(LEGACY_PENDING_CORE_SYNC_KEY), ownerUserId);
  if (!legacySnapshot) return null;

  // Migrate the old full localStorage snapshot after IndexedDB is durable.
  await persistPendingCoreSync(legacySnapshot);
  return legacySnapshot;
}
