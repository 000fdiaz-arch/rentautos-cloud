export type PersistenceMode = "LOCAL_ONLY" | "SUPABASE_ONLY";

const configuredMode = String(import.meta.env.VITE_PERSISTENCE_MODE ?? "").trim().toUpperCase();

export const persistenceMode: PersistenceMode =
  configuredMode === "LOCAL_ONLY" ? "LOCAL_ONLY" : "SUPABASE_ONLY";

export const isSupabaseOnlyMode = persistenceMode === "SUPABASE_ONLY";
export const isLocalOnlyMode = persistenceMode === "LOCAL_ONLY";
