import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabase } from "../lib/supabase";
import {
  canManageSettings,
  canManageUsers,
  canEditScreen,
  canViewScreen,
  canUseReadOnlyExperience,
  canWriteOperationalData,
  normalizeAppPermissions,
  normalizeAppRole,
  resolveDataOwnerUserId,
  type AppPermissions,
  type AppRole
} from "./permissions";

type AuthProfileRow = {
  role?: unknown;
  is_active?: unknown;
  data_owner_user_id?: unknown;
  permissions?: unknown;
};

export type AuthProfileState = {
  session: Session | null;
  role: AppRole;
  isActive: boolean;
  dataOwnerUserId: string | null;
  effectiveOwnerUserId: string | undefined;
  userId: string | undefined;
  userEmail: string | undefined;
  mustChangePassword: boolean;
  permissions: AppPermissions;
  loadingAuth: boolean;
  loadingProfile: boolean;
  authBootError: string;
  canWriteOperationalData: boolean;
  canManageSettings: boolean;
  canManageUsers: boolean;
  isReadOnlyExperience: boolean;
  canView: typeof canViewScreen;
  canEdit: typeof canEditScreen;
  signOut: () => Promise<void>;
};

function getDataOwnerUserId(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

async function loadProfileRow(userId: string): Promise<AuthProfileRow | null> {
  if (!supabase) return null;
  const withPermissions = await supabase
    .from("user_profiles")
    .select("role,is_active,data_owner_user_id,permissions")
    .eq("id", userId)
    .maybeSingle<AuthProfileRow>();
  if (!withPermissions.error) return withPermissions.data ?? null;

  const normalizedMessage = `${withPermissions.error.code ?? ""} ${withPermissions.error.message ?? ""}`.toLowerCase();
  if (!normalizedMessage.includes("permissions") && !normalizedMessage.includes("is_active") && withPermissions.error.code !== "42703") {
    throw withPermissions.error;
  }

  const withoutPermissions = await supabase
    .from("user_profiles")
    .select("role,data_owner_user_id")
    .eq("id", userId)
    .maybeSingle<AuthProfileRow>();
  if (withoutPermissions.error) throw withoutPermissions.error;
  return withoutPermissions.data ?? null;
}

export function useAuthProfile(): AuthProfileState {
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<AppRole>("lectura");
  const [isActive, setIsActive] = useState(true);
  const [permissions, setPermissions] = useState<AppPermissions>(() => normalizeAppPermissions("lectura", null));
  const [dataOwnerUserId, setDataOwnerUserId] = useState<string | null>(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [authBootError, setAuthBootError] = useState("");

  useEffect(() => {
    let mounted = true;

    if (!isSupabaseConfigured || !supabase) {
      setLoadingAuth(false);
      return () => {
        mounted = false;
      };
    }

    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!mounted) return;
        if (error) {
          setAuthBootError("No se pudo validar la sesion. Revisa tu conexion e intenta de nuevo.");
          setLoadingAuth(false);
          return;
        }
        setSession(data.session ?? null);
        setLoadingAuth(false);
      })
      .catch(() => {
        if (!mounted) return;
        setAuthBootError("No se pudo validar la sesion. Revisa tu conexion e intenta de nuevo.");
        setLoadingAuth(false);
      });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoadingAuth(false);
    });

    return () => {
      mounted = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let profileLoadingGuardTimer: number | null = null;

    async function loadProfile() {
      if (!session?.user.id || !supabase) {
        setRole("lectura");
        setIsActive(true);
        setPermissions(normalizeAppPermissions("lectura", null));
        setDataOwnerUserId(null);
        setLoadingProfile(false);
        return;
      }

      setLoadingProfile(true);
      // Evita bloquear la app cuando la consulta de perfil tarda por red/base.
      profileLoadingGuardTimer = window.setTimeout(() => {
        if (!cancelled) setLoadingProfile(false);
      }, 2500);

      try {
        const data = await loadProfileRow(session.user.id);
        if (cancelled) return;
        const nextRole = normalizeAppRole(data?.role);
        setIsActive(data?.is_active !== false);
        setDataOwnerUserId(getDataOwnerUserId(data?.data_owner_user_id));
        setRole(nextRole);
        setPermissions(normalizeAppPermissions(nextRole, data?.permissions));
      } catch {
        if (!cancelled) {
          setRole("lectura");
          setIsActive(true);
          setPermissions(normalizeAppPermissions("lectura", null));
          setDataOwnerUserId(null);
        }
      } finally {
        if (profileLoadingGuardTimer !== null) {
          window.clearTimeout(profileLoadingGuardTimer);
          profileLoadingGuardTimer = null;
        }
        if (!cancelled) setLoadingProfile(false);
      }
    }

    void loadProfile();

    return () => {
      cancelled = true;
      if (profileLoadingGuardTimer !== null) {
        window.clearTimeout(profileLoadingGuardTimer);
        profileLoadingGuardTimer = null;
      }
    };
  }, [session?.user.id]);

  const userId = session?.user.id;
  const effectiveOwnerUserId = resolveDataOwnerUserId(userId, dataOwnerUserId);
  const mustChangePassword = session?.user.user_metadata?.must_change_password === true;

  return useMemo(() => ({
    session,
    role,
    isActive,
    dataOwnerUserId,
    effectiveOwnerUserId,
    userId,
    userEmail: session?.user.email,
    mustChangePassword,
    permissions,
    loadingAuth,
    loadingProfile,
    authBootError,
    canWriteOperationalData: canWriteOperationalData(role, permissions),
    canManageSettings: canManageSettings(role, permissions),
    canManageUsers: canManageUsers(role, permissions),
    isReadOnlyExperience: canUseReadOnlyExperience(role, permissions),
    canView: canViewScreen,
    canEdit: canEditScreen,
    signOut: async () => {
      if (!supabase) return;
      await supabase.auth.signOut();
    }
  }), [
    authBootError,
    dataOwnerUserId,
    effectiveOwnerUserId,
    loadingAuth,
    loadingProfile,
    mustChangePassword,
    permissions,
    role,
    isActive,
    session,
    userId
  ]);
}
