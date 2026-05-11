import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import AppShell from "./AppShell";
import AuthPanel from "./components/AuthPanel";
import { isSupabaseConfigured, supabase } from "./lib/supabase";
import "./styles.css";

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [appRole, setAppRole] = useState<"admin" | "operador" | "lectura">("lectura");
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [authBootError, setAuthBootError] = useState<string>("");

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

    async function loadRole() {
      if (!session?.user.id || !supabase) {
        setAppRole("lectura");
        return;
      }
      try {
        const { data, error } = await supabase
          .from("user_profiles")
          .select("role")
          .eq("id", session.user.id)
          .maybeSingle();
        if (error) throw error;
        if (cancelled) return;
        const role = data?.role;
        if (role === "admin" || role === "operador" || role === "lectura") {
          setAppRole(role);
          return;
        }
        setAppRole("lectura");
      } catch {
        if (!cancelled) setAppRole("lectura");
      }
    }

    void loadRole();

    return () => {
      cancelled = true;
    };
  }, [session?.user.id]);

  if (!isSupabaseConfigured) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <h1>Rentautos</h1>
          <p>Falta configurar Supabase en el archivo .env.</p>
        </section>
      </main>
    );
  }

  if (loadingAuth) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <h1>Rentautos</h1>
          <p>Verificando sesion...</p>
        </section>
      </main>
    );
  }

  if (authBootError) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <h1>Rentautos</h1>
          <p>{authBootError}</p>
        </section>
      </main>
    );
  }

  if (!session) return <AuthPanel />;

  return (
    <AppShell
      userId={session.user.id}
      userEmail={session.user.email}
      appRole={appRole}
      onSignOut={async () => {
        if (!supabase) return;
        await supabase.auth.signOut();
      }}
    />
  );
}
