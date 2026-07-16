export type PersistenceMode = "LOCAL_ONLY" | "SUPABASE_ONLY";

export const persistenceMode: PersistenceMode = "SUPABASE_ONLY";

export const isSupabaseOnlyMode = persistenceMode === "SUPABASE_ONLY";
