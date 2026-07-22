import { supabase } from "./lib/supabase";
import { readIndexedDb, writeIndexedDb } from "./storage/indexedDbStorage";

type ArrayKey =
  | "cobrapp.module1.clients.v1"
  | "cobrapp.module2.pending_bank.v1"
  | "cobrapp.module2.pending_card.v1"
  | "cobrapp.settings.bank_rules.v1"
  | "cobrapp.module2.manual_assignment_audit.v1"
  | "cobrapp.module2.late_fee_ledger.v1"
  | "cobrapp.module2.notified.v1"
  | "cobrapp.module2.cash_closings.v1"
  | "cobrapp.module2.cash_closing_audit.v1"
  | "cobrapp.module2.charge_runs.v1";

type SingletonKey =
  | "cobrapp.payments.seq.v1"
  | "cobrapp.settings.late_fee_settings.v1"
  | "cobrapp.settings.other_charges_retention.v1"
  | "cobrapp.clients.status_filter.v1"
  | "cobrapp.module3.street_management.v1"
  | "cobrapp.module3.collection_closures.v1"
  | "cobrapp.clients.daily_collection.v1"
  | "cobrapp.clients.daily_collection_am_seals.v1"
  | "cobrapp.clients.daily_collection_pm_seals.v1"
  | "cobrapp.clients.daily_collection_close_seals.v1"
  | "cobrapp.clients.daily_collection_promises.v1"
  | "cobrapp.clients.daily_collection_street_actions.v1";

const ARRAY_TABLE_MAP: Record<ArrayKey, string> = {
  "cobrapp.module1.clients.v1": "clients_cloud",
  "cobrapp.module2.pending_bank.v1": "pending_bank_items_cloud",
  "cobrapp.module2.pending_card.v1": "pending_card_items_cloud",
  "cobrapp.settings.bank_rules.v1": "bank_rules_cloud",
  "cobrapp.module2.manual_assignment_audit.v1": "manual_assignment_audit_cloud",
  "cobrapp.module2.late_fee_ledger.v1": "late_fee_ledger_cloud",
  "cobrapp.module2.notified.v1": "notified_payments_cloud",
  "cobrapp.module2.cash_closings.v1": "cash_closings_cloud",
  "cobrapp.module2.cash_closing_audit.v1": "cash_closing_audit_cloud",
  "cobrapp.module2.charge_runs.v1": "charge_runs_cloud"
};

const SINGLETON_TABLE_MAP: Record<SingletonKey, string> = {
  "cobrapp.payments.seq.v1": "receipt_sequences_cloud",
  "cobrapp.settings.late_fee_settings.v1": "late_fee_settings_cloud",
  "cobrapp.settings.other_charges_retention.v1": "other_charges_retention_cloud",
  "cobrapp.clients.status_filter.v1": "client_ui_prefs_cloud",
  "cobrapp.module3.street_management.v1": "street_management_cloud",
  "cobrapp.module3.collection_closures.v1": "collection_closures_cloud",
  "cobrapp.clients.daily_collection.v1": "clients_daily_collection_cloud",
  "cobrapp.clients.daily_collection_am_seals.v1": "clients_daily_collection_am_seals_cloud",
  "cobrapp.clients.daily_collection_pm_seals.v1": "clients_daily_collection_pm_seals_cloud",
  "cobrapp.clients.daily_collection_close_seals.v1": "clients_daily_collection_close_seals_cloud",
  "cobrapp.clients.daily_collection_promises.v1": "clients_daily_collection_promises_cloud",
  "cobrapp.clients.daily_collection_street_actions.v1": "clients_daily_collection_street_actions_cloud"
};

const SYNCED_KEYS = new Set<string>([
  ...Object.keys(ARRAY_TABLE_MAP),
  ...Object.keys(SINGLETON_TABLE_MAP)
]);

let currentUserId: string | null = null;
let isHydrating = false;
let patchInstalled = false;
const pendingTimers = new Map<string, number>();
const cachedValues = new Map<string, string>();
let nativeLocalStorageSetItem: ((key: string, value: string) => void) | null = null;
const PAGE_SIZE = 1000;
const BASE_SYNC_DEBOUNCE_MS = 1000;
const HEAVY_SYNC_DEBOUNCE_MS = 1800;
const DAILY_COLLECTION_KEY = "cobrapp.clients.daily_collection.v1";
const DAILY_COLLECTION_AM_SEALS_KEY = "cobrapp.clients.daily_collection_am_seals.v1";
const DAILY_COLLECTION_PM_SEALS_KEY = "cobrapp.clients.daily_collection_pm_seals.v1";
const DAILY_COLLECTION_CLOSE_SEALS_KEY = "cobrapp.clients.daily_collection_close_seals.v1";
const DAILY_COLLECTION_PROMISES_KEY = "cobrapp.clients.daily_collection_promises.v1";
const DAILY_COLLECTION_STREET_ACTIONS_KEY = "cobrapp.clients.daily_collection_street_actions.v1";
const INDEXED_DB_SENTINEL = "__indexeddb__";
const INDEXED_DB_ARRAY_KEY_MAP: Partial<Record<ArrayKey, string>> = {
  "cobrapp.module2.pending_bank.v1": "pending_bank.v1",
  "cobrapp.module2.manual_assignment_audit.v1": "manual_assignment_audit.v1"
};

type InitializeCloudMirrorOptions = {
  skipKeys?: string[];
};

function asArrayKey(key: string): ArrayKey | null {
  return key in ARRAY_TABLE_MAP ? (key as ArrayKey) : null;
}

function asSingletonKey(key: string): SingletonKey | null {
  return key in SINGLETON_TABLE_MAP ? (key as SingletonKey) : null;
}

function parseArrayValue(raw: string | null): unknown[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function parseArrayValueForKey(key: ArrayKey, raw: string | null): Promise<unknown[]> {
  const indexedDbKey = INDEXED_DB_ARRAY_KEY_MAP[key];
  if (raw === INDEXED_DB_SENTINEL && indexedDbKey) {
    const value = await readIndexedDb(indexedDbKey);
    return Array.isArray(value) ? value : [];
  }
  return parseArrayValue(raw);
}

function parseObjectValue(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    return {};
  } catch {
    return {};
  }
}

function makeRowId(key: ArrayKey, rec: unknown, idx: number): string {
  const obj = rec as { id?: unknown; date?: unknown; closedAt?: unknown; clientId?: unknown; createdAt?: unknown };
  if (typeof obj?.id === "string" && obj.id.trim()) return obj.id.trim();
  if (key === "cobrapp.module2.pending_bank.v1") {
    const folio = normalizeFolioToken((rec as { folio?: unknown })?.folio);
    if (folio) return `folio-${folio}`;
  }
  if (key === "cobrapp.module2.cash_closings.v1") {
    return `${String(obj?.date ?? "na")}__${String(obj?.closedAt ?? idx)}`;
  }
  if (key === "cobrapp.module2.notified.v1") {
    return `${String(obj?.clientId ?? "na")}__${String(obj?.createdAt ?? idx)}__${idx}`;
  }
  return `row-${idx + 1}`;
}

function normalizeFolioToken(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase().replace(/\s+/g, "") : "";
}

function getRowFolio(row: { data?: unknown }): string {
  const data = row.data as { folio?: unknown } | null | undefined;
  return normalizeFolioToken(data?.folio);
}

function dedupeRowsByIdAndFolio(rows: Array<{ user_id: string; id: string; data: unknown }>): Array<{ user_id: string; id: string; data: unknown }> {
  const byId = new Map<string, { user_id: string; id: string; data: unknown }>();
  const folioToId = new Map<string, string>();
  for (const row of rows) {
    const folio = getRowFolio(row);
    if (folio) {
      const previousId = folioToId.get(folio);
      if (previousId && previousId !== row.id) byId.delete(previousId);
      folioToId.set(folio, row.id);
    }
    byId.set(row.id, row);
  }
  return [...byId.values()];
}

async function saveArrayKey(userId: string, key: ArrayKey, raw: string | null): Promise<void> {
  if (!supabase) return;
  const table = ARRAY_TABLE_MAP[key];
  const rows = dedupeRowsByIdAndFolio((await parseArrayValueForKey(key, raw)).map((rec, idx) => ({
    user_id: userId,
    id: makeRowId(key, rec, idx),
    data: rec
  })));

  if (rows.length > 0) {
    const { error } = await supabase.from(table).upsert(rows, { onConflict: "user_id,id" });
    if (error) throw error;
  }
}

async function saveSingletonKey(userId: string, key: SingletonKey, raw: string | null): Promise<void> {
  if (!supabase) return;
  const table = SINGLETON_TABLE_MAP[key];
  let row: Record<string, unknown>;
  if (key === "cobrapp.payments.seq.v1") {
    const seq = Number(raw ?? "0");
    row = { user_id: userId, seq: Number.isFinite(seq) ? Math.max(0, Math.floor(seq)) : 0 };
  } else if (key === "cobrapp.clients.status_filter.v1") {
    const statusFilter = typeof raw === "string" && raw.trim().length > 0 ? raw : null;
    row = { user_id: userId, status_filter: statusFilter, data: { status_filter: statusFilter } };
  } else {
    const incoming = parseObjectValue(raw);
    const { data, error: selectError } = await supabase
      .from(table)
      .select("data")
      .eq("user_id", userId)
      .maybeSingle();
    if (selectError) throw selectError;
    const currentData = (data as { data?: unknown } | null)?.data;
    const current = isPlainRecord(currentData) ? currentData : {};
    row = { user_id: userId, data: mergeSingletonPayload(key, current, incoming) };
  }
  const { error } = await supabase.from(table).upsert(row, { onConflict: "user_id" });
  if (error) throw error;
}

async function saveKeyToCloud(key: string, raw: string | null): Promise<void> {
  if (!currentUserId) return;
  const arrayKey = asArrayKey(key);
  if (arrayKey) {
    await saveArrayKey(currentUserId, arrayKey, raw);
    return;
  }
  const singletonKey = asSingletonKey(key);
  if (singletonKey) await saveSingletonKey(currentUserId, singletonKey, raw);
}

function scheduleSync(key: string, raw: string | null): void {
  if (!currentUserId || !SYNCED_KEYS.has(key)) return;
  const isIndexedDbArraySentinel = raw === INDEXED_DB_SENTINEL && Boolean(INDEXED_DB_ARRAY_KEY_MAP[key as ArrayKey]);
  if (raw === INDEXED_DB_SENTINEL && !isIndexedDbArraySentinel) return;
  const nextValue = raw ?? "";
  const previousValue = cachedValues.get(key);
  if (!isIndexedDbArraySentinel && previousValue === nextValue && !pendingTimers.has(key)) return;
  cachedValues.set(key, nextValue);
  const existing = pendingTimers.get(key);
  if (existing) window.clearTimeout(existing);
  const debounceMs = key.startsWith("cobrapp.clients.daily_collection")
    ? HEAVY_SYNC_DEBOUNCE_MS
    : BASE_SYNC_DEBOUNCE_MS;
  const timer = window.setTimeout(() => {
    pendingTimers.delete(key);
    void saveKeyToCloud(key, cachedValues.get(key) ?? null).catch((error) => {
      console.error(`Cloud mirror sync failed for key "${key}"`, error);
    });
  }, debounceMs);
  pendingTimers.set(key, timer);
}

export async function flushCloudMirror(): Promise<void> {
  if (!currentUserId || pendingTimers.size === 0) return;
  const keys = Array.from(pendingTimers.keys());
  for (const key of keys) {
    const timer = pendingTimers.get(key);
    if (timer) window.clearTimeout(timer);
    pendingTimers.delete(key);
  }
  for (const key of keys) {
    try {
      await saveKeyToCloud(key, cachedValues.get(key) ?? null);
    } catch (error) {
      console.error(`Cloud mirror flush failed for key "${key}"`, error);
      throw error;
    }
  }
}

function patchLocalStorage(): void {
  if (patchInstalled) return;
  patchInstalled = true;
  const originalSetItem = window.localStorage.setItem.bind(window.localStorage);
  const originalRemoveItem = window.localStorage.removeItem.bind(window.localStorage);
  nativeLocalStorageSetItem = originalSetItem;

  window.localStorage.setItem = (key: string, value: string) => {
    const indexedDbKey = INDEXED_DB_ARRAY_KEY_MAP[key as ArrayKey];
    if (indexedDbKey && value !== INDEXED_DB_SENTINEL) {
      const rows = parseArrayValue(value);
      void writeIndexedDb(indexedDbKey, rows)
        .then(() => originalSetItem(key, INDEXED_DB_SENTINEL))
        .catch((error) => {
          console.error(`No se pudo guardar "${key}" en IndexedDB.`, error);
        });
      if (!isHydrating) scheduleSync(key, INDEXED_DB_SENTINEL);
      return;
    }
    originalSetItem(key, value);
    if (!isHydrating) scheduleSync(key, value);
  };

  window.localStorage.removeItem = (key: string) => {
    originalRemoveItem(key);
    if (!isHydrating) scheduleSync(key, null);
  };
}

async function hydrateArrayKey(userId: string, key: ArrayKey): Promise<void> {
  if (!supabase) return;
  const table = ARRAY_TABLE_MAP[key];
  const rows: unknown[] = [];
  let from = 0;
  while (true) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from(table)
      .select("id,data")
      .eq("user_id", userId)
      .range(from, to);
    if (error) throw error;
    const batch = (data ?? []).map((r) => (r as { data?: unknown }).data).filter((v) => v !== undefined);
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  const indexedDbKey = INDEXED_DB_ARRAY_KEY_MAP[key];
  if (indexedDbKey) {
    await writeIndexedDb(indexedDbKey, rows);
    (nativeLocalStorageSetItem ?? window.localStorage.setItem.bind(window.localStorage))(key, INDEXED_DB_SENTINEL);
    return;
  }
  window.localStorage.setItem(key, JSON.stringify(rows));
}

async function hydrateSingletonKey(userId: string, key: SingletonKey): Promise<void> {
  if (!supabase) return;
  const table = SINGLETON_TABLE_MAP[key];
  const { data, error } = await supabase
    .from(table)
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return;

  if (key === "cobrapp.payments.seq.v1") {
    const seq = Number((data as { seq?: unknown }).seq ?? 0);
    window.localStorage.setItem(key, String(Number.isFinite(seq) ? seq : 0));
    return;
  }
  if (key === "cobrapp.clients.status_filter.v1") {
    const status = (data as { status_filter?: unknown }).status_filter;
    if (typeof status === "string") window.localStorage.setItem(key, status);
    return;
  }
  const payload = (data as { data?: unknown }).data;
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    window.localStorage.setItem(key, JSON.stringify(payload));
  }
}

export async function initializeCloudMirror(userId: string, options?: InitializeCloudMirrorOptions): Promise<void> {
  currentUserId = userId;
  patchLocalStorage();
  const skipKeys = new Set(options?.skipKeys ?? []);
  isHydrating = true;
  try {
    await Promise.all([
      ...Object.keys(ARRAY_TABLE_MAP)
        .filter((key) => !skipKeys.has(key))
        .map((key) => hydrateArrayKey(userId, key as ArrayKey)),
      ...Object.keys(SINGLETON_TABLE_MAP)
        .filter((key) => !skipKeys.has(key))
        .map((key) => hydrateSingletonKey(userId, key as SingletonKey))
    ]);
  } finally {
    isHydrating = false;
  }
}

function newerIso(left?: unknown, right?: unknown): string {
  const leftText = typeof left === "string" ? left : "";
  const rightText = typeof right === "string" ? right : "";
  const leftMs = leftText ? new Date(leftText).getTime() : 0;
  const rightMs = rightText ? new Date(rightText).getTime() : 0;
  return (Number.isFinite(leftMs) ? leftMs : 0) >= (Number.isFinite(rightMs) ? rightMs : 0) ? leftText : rightText;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mergeDailyCollection(current: Record<string, unknown>, incoming: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...current };
  for (const [dateKey, incomingDayValue] of Object.entries(incoming)) {
    const currentDay = isPlainRecord(merged[dateKey]) ? merged[dateKey] : {};
    const incomingDay = isPlainRecord(incomingDayValue) ? incomingDayValue : {};
    const nextDay: Record<string, unknown> = { ...currentDay };
    for (const runId of ["run1", "run2", "run3"]) {
      const currentRun = isPlainRecord(currentDay[runId]) ? currentDay[runId] : {};
      const incomingRun = isPlainRecord(incomingDay[runId]) ? incomingDay[runId] : {};
      const nextRun: Record<string, unknown> = { ...currentRun };
      for (const [clientId, incomingEntryValue] of Object.entries(incomingRun)) {
        if (!isPlainRecord(incomingEntryValue)) continue;
        const currentEntry = isPlainRecord(nextRun[clientId]) ? nextRun[clientId] : null;
        if (!currentEntry || newerIso(currentEntry.updatedAt, incomingEntryValue.updatedAt) === incomingEntryValue.updatedAt) {
          nextRun[clientId] = incomingEntryValue;
        }
      }
      nextDay[runId] = nextRun;
    }
    merged[dateKey] = nextDay;
  }
  return merged;
}

function mergeIsoByKey(current: Record<string, unknown>, incoming: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...current };
  for (const [key, incomingAt] of Object.entries(incoming)) {
    if (newerIso(merged[key], incomingAt) === incomingAt) merged[key] = incomingAt;
  }
  return merged;
}

function mergePromises(current: Record<string, unknown>, incoming: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...current };
  for (const [clientId, incomingValue] of Object.entries(incoming)) {
    if (!isPlainRecord(incomingValue)) continue;
    const currentValue = isPlainRecord(merged[clientId]) ? merged[clientId] : null;
    const currentAt = currentValue?.resolvedAt ?? currentValue?.createdAt;
    const incomingAt = incomingValue.resolvedAt ?? incomingValue.createdAt;
    if (!currentValue || newerIso(currentAt, incomingAt) === incomingAt) merged[clientId] = incomingValue;
  }
  return merged;
}

function mergeStreetActions(current: Record<string, unknown>, incoming: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...current };
  for (const [dateKey, incomingByClientValue] of Object.entries(incoming)) {
    const currentByClient = isPlainRecord(merged[dateKey]) ? merged[dateKey] : {};
    const incomingByClient = isPlainRecord(incomingByClientValue) ? incomingByClientValue : {};
    const nextByClient: Record<string, unknown> = { ...currentByClient };
    for (const [clientId, incomingActionValue] of Object.entries(incomingByClient)) {
      if (!isPlainRecord(incomingActionValue)) continue;
      const currentAction = isPlainRecord(nextByClient[clientId]) ? nextByClient[clientId] : null;
      if (!currentAction || newerIso(currentAction.updatedAt, incomingActionValue.updatedAt) === incomingActionValue.updatedAt) {
        nextByClient[clientId] = incomingActionValue;
      }
    }
    merged[dateKey] = nextByClient;
  }
  return merged;
}

function mergeSingletonPayload(key: SingletonKey, current: Record<string, unknown>, incoming: Record<string, unknown>): Record<string, unknown> {
  if (key === DAILY_COLLECTION_KEY) return mergeDailyCollection(current, incoming);
  if (key === DAILY_COLLECTION_AM_SEALS_KEY || key === DAILY_COLLECTION_PM_SEALS_KEY || key === DAILY_COLLECTION_CLOSE_SEALS_KEY) {
    return mergeIsoByKey(current, incoming);
  }
  if (key === DAILY_COLLECTION_PROMISES_KEY) return mergePromises(current, incoming);
  if (key === DAILY_COLLECTION_STREET_ACTIONS_KEY) return mergeStreetActions(current, incoming);
  return incoming;
}

export function writeLocalStorageFromCloud(key: string, value: string): void {
  patchLocalStorage();
  isHydrating = true;
  try {
    const indexedDbKey = INDEXED_DB_ARRAY_KEY_MAP[key as ArrayKey];
    if (indexedDbKey && value !== INDEXED_DB_SENTINEL) {
      void writeIndexedDb(indexedDbKey, parseArrayValue(value))
        .then(() => (nativeLocalStorageSetItem ?? window.localStorage.setItem.bind(window.localStorage))(key, INDEXED_DB_SENTINEL))
        .catch((error) => {
          console.error(`No se pudo guardar "${key}" desde cloud en IndexedDB.`, error);
        });
      return;
    }
    (nativeLocalStorageSetItem ?? window.localStorage.setItem.bind(window.localStorage))(key, value);
  } finally {
    isHydrating = false;
  }
}

export function disableCloudMirror(): void {
  for (const timer of pendingTimers.values()) {
    window.clearTimeout(timer);
  }
  pendingTimers.clear();
  currentUserId = null;
}
