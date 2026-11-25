import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabase } from "../lib/supabase";
import { withCloudRetry } from "../cloud/cloudClient";
import { markStartupPhase } from "../lib/startupDiagnostics";
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

const AUTH_LOAD_TIMEOUT_MS = 12_000;

async function loadProfileRow(userId: string, signal: AbortSignal): Promise<AuthProfileRow | null> {
  if (!supabase) return null;
  const withPermissions = await supabase
    .from("user_profiles")
    .select("role,is_active,data_owner_user_id,permissions")
    .eq("id", userId)
    .abortSignal(signal)
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
    .abortSignal(signal)
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
  const [loadedProfileUserId, setLoadedProfileUserId] = useState<string | null>(null);
  const [authBootError, setAuthBootError] = useState("");

  useEffect(() => {
    let mounted = true;
    let authTimedOut = false;

    if (!isSupabaseConfigured || !supabase) {
      setLoadingAuth(false);
      return () => {
        mounted = false;
      };
    }

    const authTimer = window.setTimeout(() => {
      if (!mounted) return;
      authTimedOut = true;
      setAuthBootError("La validacion de la sesion tardo demasiado. Revisa tu conexion y vuelve a intentar.");
      setLoadingAuth(false);
    }, AUTH_LOAD_TIMEOUT_MS);

    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!mounted || authTimedOut) return;
        window.clearTimeout(authTimer);
        if (error) {
          setAuthBootError("No se pudo validar la sesion. Revisa tu conexion e intenta de nuevo.");
          setLoadingAuth(false);
          return;
        }
        setSession(data.session ?? null);
        markStartupPhase("session");
        setAuthBootError("");
        setLoadingAuth(false);
      })
      .catch(() => {
        if (!mounted || authTimedOut) return;
        window.clearTimeout(authTimer);
        setAuthBootError("No se pudo validar la sesion. Revisa tu conexion e intenta de nuevo.");
        setLoadingAuth(false);
      });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted || authTimedOut) return;
      window.clearTimeout(authTimer);
      setSession(nextSession);
      setLoadingAuth(false);
    });

    return () => {
      mounted = false;
      window.clearTimeout(authTimer);
      subscription.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let profileLoadingGuardTimer: number | null = null;
    const controller = new AbortController();

    async function loadProfile() {
      if (!session?.user.id || !supabase) {
        setRole("lectura");
        setIsActive(true);
        setPermissions(normalizeAppPermissions("lectura", null));
        setDataOwnerUserId(null);
        setLoadedProfileUserId(null);
        setLoadingProfile(false);
        return;
      }

      setLoadingProfile(true);
      setAuthBootError("");
      // Un perfil pendiente no autoriza abrir el menu con rol/owner provisionales.
      profileLoadingGuardTimer = window.setTimeout(() => {
        if (!cancelled) {
          controller.abort();
          setAuthBootError("La carga del perfil tardo demasiado. Revisa tu conexion y vuelve a intentar.");
          setLoadingProfile(false);
        }
      }, AUTH_LOAD_TIMEOUT_MS);

      try {
        const data = await withCloudRetry(() => loadProfileRow(session.user.id, controller.signal), 2);
        if (cancelled || controller.signal.aborted) return;
        if (!data) throw new Error("No existe un perfil para este usuario.");
        const nextRole = normalizeAppRole(data?.role);
        setIsActive(data?.is_active !== false);
        setDataOwnerUserId(getDataOwnerUserId(data?.data_owner_user_id));
        setRole(nextRole);
        setPermissions(normalizeAppPermissions(nextRole, data?.permissions));
        setLoadedProfileUserId(session.user.id);
        markStartupPhase("profile");
      } catch (error) {
        if (!cancelled && !controller.signal.aborted) {
          console.error("No se pudo cargar el perfil de acceso.", error);
          setAuthBootError("No se pudo cargar tu perfil de acceso. Revisa tu conexion y vuelve a intentar.");
        }
      } finally {
        if (profileLoadingGuardTimer !== null) {
          window.clearTimeout(profileLoadingGuardTimer);
          profileLoadingGuardTimer = null;
        }
        if (!cancelled) {
          setLoadingProfile(false);
        }
      }
    }

    void loadProfile();

    return () => {
      cancelled = true;
      controller.abort();
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
    loadingProfile: loadingProfile || Boolean(session?.user.id && loadedProfileUserId !== session.user.id),
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
    loadedProfileUserId,
    mustChangePassword,
    permissions,
    role,
    isActive,
    session,
    userId
  ]);
}
