import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() ?? "";
export const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? "";

const hasPlaceholderConfig =
  supabaseUrl.includes("TU-PROYECTO") ||
  supabaseAnonKey === "TU_SUPABASE_ANON_KEY";

export const isSupabaseConfigured =
  !hasPlaceholderConfig && supabaseUrl.length > 0 && supabaseAnonKey.length > 0;

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    })
  : null;

export function createEphemeralSupabaseClient(): SupabaseClient | null {
  if (!isSupabaseConfigured) return null;
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
}
