import { supabase } from "../lib/supabase";

export type DataRow<T> = { id: string; data: T };
export type SingletonDataRow = { data?: unknown };
export const PAGE_SIZE = 1000;
const inflightLoads = new Map<string, Promise<unknown>>();

export function getCloudClient() {
  if (!supabase) throw new Error("Supabase no esta configurado.");
  return supabase;
}

function isTransientCloudError(error: unknown): boolean {
  const record = typeof error === "object" && error !== null ? error as Record<string, unknown> : null;
  const code = typeof record?.code === "string" ? record.code : "";
  const message = error instanceof Error ? error.message : typeof record?.message === "string" ? record.message : "";
  const details = typeof record?.details === "string" ? record.details : "";
  const normalized = `${code} ${message} ${details}`.toLowerCase();
  return normalized.includes("network") || normalized.includes("fetch") || normalized.includes("timeout") || code === "57014" || code.startsWith("08");
}

export async function withCloudRetry<T>(operation: () => PromiseLike<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !isTransientCloudError(error)) throw error;
      await new Promise<void>((resolve) => window.setTimeout(resolve, 350 * attempt));
    }
  }
  throw lastError;
}

export function chunkIds(ids: string[], size = 150): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < ids.length; index += size) chunks.push(ids.slice(index, index + size));
  return chunks;
}

export function dedupeLoad<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const existing = inflightLoads.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const next = loader().finally(() => {
    if (inflightLoads.get(key) === next) inflightLoads.delete(key);
  });
  inflightLoads.set(key, next);
  return next;
}

export function hasRowChanged<T>(previous: T | undefined, next: T): boolean {
  if (!previous) return true;
  if (previous === next) return false;
  return JSON.stringify(previous) !== JSON.stringify(next);
}

export async function deleteStaleRows(
  table: "clients_cloud" | "payments_cloud" | "payment_promises_cloud",
  userId: string,
  nextIds: Set<string>
): Promise<void> {
  const client = getCloudClient();
  const allIds: string[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await client.from(table).select("id").eq("user_id", userId).range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const batch = (data ?? []).map((row) => String((row as { id?: unknown }).id ?? "")).filter(Boolean);
    allIds.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  const staleIds = allIds.filter((id) => !nextIds.has(id));
  for (const ids of chunkIds(staleIds)) {
    const { error } = await client.from(table).delete().eq("user_id", userId).in("id", ids);
    if (error) throw error;
  }
}
