export type PersistenceMode = "LOCAL_ONLY" | "SUPABASE_ONLY";

const rawMode = (import.meta.env.VITE_PERSISTENCE_MODE ?? "LOCAL_ONLY").toString().trim().toUpperCase();

export const persistenceMode: PersistenceMode =
  rawMode === "SUPABASE_ONLY" ? "SUPABASE_ONLY" : "LOCAL_ONLY";

export const isSupabaseOnlyMode = persistenceMode === "SUPABASE_ONLY";
