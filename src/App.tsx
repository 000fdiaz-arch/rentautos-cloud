import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import AppShell from "./AppShell";
import AuthPanel from "./components/AuthPanel";
import { isSupabaseConfigured, supabase } from "./lib/supabase";
import "./styles.css";

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
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
      onSignOut={async () => {
        if (!supabase) return;
        await supabase.auth.signOut();
      }}
    />
  );
}
