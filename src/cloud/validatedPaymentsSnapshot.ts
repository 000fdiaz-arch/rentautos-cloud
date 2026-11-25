import type { Payment } from "../types";
import { readIndexedDb, writeIndexedDb } from "../storage/indexedDbStorage";
import { supabaseUrl } from "../lib/supabase";
import { getCloudClient } from "./cloudClient";

type Payments = { recent: Payment[]; pending: Payment[] };
type Snapshot = {
  version: 1; owner: string; through_date: string; limit: number;
  recent_count: number; pending_count: number; fingerprint: string; payload: string;
};

async function checkedSnapshot(value: unknown, owner: string, date: string, limit: number) {
  const item = value as Partial<Snapshot> | null;
  if (!item || item.version !== 1 || item.owner !== owner || item.through_date !== date || item.limit !== limit ||
    typeof item.payload !== "string" || typeof item.fingerprint !== "string" || !/^[0-9a-f]{64}$/.test(item.fingerprint)) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(item.payload));
  const fingerprint = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  if (fingerprint !== item.fingerprint) return null;
  const parsed = JSON.parse(item.payload) as Partial<Payments> | null;
  const validRows = (rows: unknown): rows is Payment[] => Array.isArray(rows) && rows.every(row =>
    row && typeof row === "object" && !Array.isArray(row) && typeof row.id === "string");
  if (!parsed || !validRows(parsed.recent) || !validRows(parsed.pending) ||
    parsed.recent.length !== item.recent_count || parsed.pending.length !== item.pending_count || parsed.recent.length > limit) return null;
  return { snapshot: item as Snapshot, payments: parsed as Payments };
}

export async function loadValidatedInitialPayments(owner: string, date: string, limit: number): Promise<Payments | null> {
  if (typeof crypto === "undefined" || !crypto.subtle || typeof TextEncoder === "undefined") return null;
  owner = owner.toLowerCase();
  limit = Math.max(1, Math.min(1000, Math.floor(limit)));
  // One entry per owner/project; date and limit are revalidated inside it.
  const key = `cloud-initial-payments-snapshot.v1:${supabaseUrl}:${owner}`;
  let cached: Awaited<ReturnType<typeof checkedSnapshot>> = null;
  try { cached = await checkedSnapshot(await readIndexedDb(key), owner, date, limit); } catch { /* Optional cache. */ }
  const { data, error } = await getCloudClient().rpc("read_initial_payments_snapshot", {
    p_user_id: owner, p_through_date: date, p_limit: limit, p_fingerprint: cached?.snapshot.fingerprint ?? null
  });
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") return null;
    throw error;
  }
  const result = data as Record<string, unknown> | null;
  if (result?.not_modified === true && cached && result.version === 1 && result.owner === owner &&
    result.through_date === date && result.limit === limit && result.fingerprint === cached.snapshot.fingerprint &&
    result.recent_count === cached.payments.recent.length && result.pending_count === cached.payments.pending.length && result.payload === null) {
    return cached.payments;
  }
  const fresh = result?.not_modified === false ? await checkedSnapshot(data, owner, date, limit) : null;
  if (!fresh) throw new Error("La respuesta inicial de pagos esta incompleta o no coincide con su huella.");
  try { await writeIndexedDb(key, fresh.snapshot); } catch { /* A valid cloud read does not depend on local storage. */ }
  return fresh.payments;
}
