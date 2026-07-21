import { supabase } from "../lib/supabase";
import { stableEqual } from "../stableSerialize";

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
  return !stableEqual(previous, next);
}
