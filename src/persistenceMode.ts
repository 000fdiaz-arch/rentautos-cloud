export type PersistenceMode = "LOCAL_ONLY" | "SUPABASE_ONLY";

const configuredMode = String(import.meta.env.VITE_PERSISTENCE_MODE ?? "").trim().toUpperCase();
const productionLocalOnlyExplicitlyAllowed = import.meta.env.VITE_ALLOW_PRODUCTION_LOCAL_ONLY === "1";
const localOnlyAllowed = import.meta.env.DEV || productionLocalOnlyExplicitlyAllowed;

export const persistenceMode: PersistenceMode =
  configuredMode === "LOCAL_ONLY" && localOnlyAllowed ? "LOCAL_ONLY" : "SUPABASE_ONLY";

export const isSupabaseOnlyMode = persistenceMode === "SUPABASE_ONLY";
export const isLocalOnlyMode = persistenceMode === "LOCAL_ONLY";
