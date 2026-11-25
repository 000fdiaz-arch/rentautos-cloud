import type { Client } from "../types";
import { readIndexedDb, writeIndexedDb } from "../storage/indexedDbStorage";
import { supabaseUrl } from "../lib/supabase";
import { getCloudClient, type DataRow } from "./cloudClient";

type Snapshot = { version: 1; owner: string; fingerprint: string; count: number; payload: string };

async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function checkedRows(value: unknown, owner: string): Promise<{ snapshot: Snapshot; rows: DataRow<Client>[] } | null> {
  const item = value as Partial<Snapshot> | null;
  if (!item || item.version !== 1 || item.owner !== owner || typeof item.payload !== "string" ||
    typeof item.fingerprint !== "string" || !/^[0-9a-f]{64}$/.test(item.fingerprint) ||
    !Number.isInteger(item.count) || (item.count ?? -1) < 0) return null;
  if (await sha256(item.payload) !== item.fingerprint) return null;
  const rows: unknown = JSON.parse(item.payload);
  if (!Array.isArray(rows) || rows.length !== item.count || !rows.every(row =>
    row && typeof row.id === "string" && row.data && typeof row.data === "object" && !Array.isArray(row.data))) return null;
  if (new Set(rows.map(row => row.id)).size !== rows.length) return null;
  return { snapshot: item as Snapshot, rows: rows as DataRow<Client>[] };
}

export async function loadValidatedClientsSnapshot(owner: string): Promise<DataRow<Client>[] | null> {
  if (typeof crypto === "undefined" || !crypto.subtle || typeof TextEncoder === "undefined") return null;
  owner = owner.toLowerCase();
  const key = `cloud-clients-snapshot.v1:${supabaseUrl}:${owner}`;
  let cached: Awaited<ReturnType<typeof checkedRows>> = null;
  try { cached = await checkedRows(await readIndexedDb(key), owner); } catch { /* Cache is optional. */ }
  const { data, error } = await getCloudClient().rpc("read_clients_snapshot_if_changed", {
    p_user_id: owner, p_fingerprint: cached?.snapshot.fingerprint ?? null
  });
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") return null;
    throw error;
  }
  const result = data as Record<string, unknown> | null;
  if (result?.not_modified === true && cached && result.version === 1 && result.owner === owner &&
    result.fingerprint === cached.snapshot.fingerprint && result.count === cached.rows.length && result.payload === null) {
    return cached.rows;
  }
  const fresh = result?.not_modified === false ? await checkedRows(data, owner) : null;
  if (!fresh) throw new Error("La respuesta de clientes cloud esta incompleta o no coincide con su huella.");
  try { await writeIndexedDb(key, fresh.snapshot); } catch { /* A valid cloud read does not depend on local persistence. */ }
  return fresh.rows;
}
