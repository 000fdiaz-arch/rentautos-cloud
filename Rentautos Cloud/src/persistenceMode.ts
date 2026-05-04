export type PersistenceMode = "LOCAL_ONLY" | "SUPABASE_ONLY";

const rawMode = (import.meta.env.VITE_PERSISTENCE_MODE ?? "LOCAL_ONLY").toString().trim().toUpperCase();

export const persistenceMode: PersistenceMode =
  rawMode === "SUPABASE_ONLY" ? "SUPABASE_ONLY" : "LOCAL_ONLY";

export function assertSupportedPersistenceMode(): void {
  if (persistenceMode === "SUPABASE_ONLY") {
    throw new Error(
      "SUPABASE_ONLY aun no esta habilitado en este flujo. Usa VITE_PERSISTENCE_MODE=LOCAL_ONLY durante la migracion."
    );
  }
}
