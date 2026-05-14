import { supabase } from "./lib/supabase";

type ArrayKey =
  | "cobrapp.module1.clients.v1"
  | "cobrapp.module2.payments.v1"
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
  | "cobrapp.module3.collection_closures.v1";

const ARRAY_TABLE_MAP: Record<ArrayKey, string> = {
  "cobrapp.module1.clients.v1": "clients_cloud",
  "cobrapp.module2.payments.v1": "payments_cloud",
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
  "cobrapp.module3.collection_closures.v1": "collection_closures_cloud"
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
const PAGE_SIZE = 1000;

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

function chunkIds(ids: string[], size = 150): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += size) {
    chunks.push(ids.slice(i, i + size));
  }
  return chunks;
}

function makeRowId(key: ArrayKey, rec: unknown, idx: number): string {
  const obj = rec as { id?: unknown; date?: unknown; closedAt?: unknown; clientId?: unknown; createdAt?: unknown };
  if (typeof obj?.id === "string" && obj.id.trim()) return obj.id.trim();
  if (key === "cobrapp.module2.cash_closings.v1") {
    return `${String(obj?.date ?? "na")}__${String(obj?.closedAt ?? idx)}`;
  }
  if (key === "cobrapp.module2.notified.v1") {
    return `${String(obj?.clientId ?? "na")}__${String(obj?.createdAt ?? idx)}__${idx}`;
  }
  return `row-${idx + 1}`;
}

async function saveArrayKey(userId: string, key: ArrayKey, raw: string | null): Promise<void> {
  if (!supabase) return;
  const table = ARRAY_TABLE_MAP[key];
  const rows = parseArrayValue(raw).map((rec, idx) => ({
    user_id: userId,
    id: makeRowId(key, rec, idx),
    data: rec
  }));
  const nextIds = new Set(rows.map((r) => r.id));

  if (rows.length > 0) {
    const { error } = await supabase.from(table).upsert(rows, { onConflict: "user_id,id" });
    if (error) throw error;
  }

  const existingIds: string[] = [];
  let from = 0;
  while (true) {
    const to = from + PAGE_SIZE - 1;
    const { data, error: selectError } = await supabase
      .from(table)
      .select("id")
      .eq("user_id", userId)
      .range(from, to);
    if (selectError) throw selectError;
    const batch = (data ?? [])
      .map((r) => String((r as { id?: unknown }).id ?? ""))
      .filter((id) => id.length > 0);
    existingIds.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  const staleIds = existingIds.filter((id) => !nextIds.has(id));
  if (staleIds.length === 0) return;
  for (const idsChunk of chunkIds(staleIds)) {
    const { error: deleteError } = await supabase
      .from(table)
      .delete()
      .eq("user_id", userId)
      .in("id", idsChunk);
    if (deleteError) throw deleteError;
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
    row = { user_id: userId, data: parseObjectValue(raw) };
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
  cachedValues.set(key, raw ?? "");
  const existing = pendingTimers.get(key);
  if (existing) window.clearTimeout(existing);
  const timer = window.setTimeout(() => {
    pendingTimers.delete(key);
    void saveKeyToCloud(key, cachedValues.get(key) ?? null).catch((error) => {
      console.error(`Cloud mirror sync failed for key "${key}"`, error);
    });
  }, 250);
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

  window.localStorage.setItem = (key: string, value: string) => {
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

export async function initializeCloudMirror(userId: string): Promise<void> {
  currentUserId = userId;
  patchLocalStorage();
  isHydrating = true;
  try {
    await Promise.all([
      ...Object.keys(ARRAY_TABLE_MAP).map((key) => hydrateArrayKey(userId, key as ArrayKey)),
      ...Object.keys(SINGLETON_TABLE_MAP).map((key) => hydrateSingletonKey(userId, key as SingletonKey))
    ]);
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
