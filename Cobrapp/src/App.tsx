import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import AppShell from "./AppShell";
import AuthPanel from "./components/AuthPanel";
import { isSupabaseConfigured, supabase } from "./lib/supabase";
import "./styles.css";

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);

  useEffect(() => {
    if (!supabase) {
      setLoadingSession(false);
      return;
    }

    let isMounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!isMounted) return;
      setSession(data.session ?? null);
      setLoadingSession(false);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoadingSession(false);
    });

    return () => {
      isMounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  async function handleSignOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
  }

  if (!isSupabaseConfigured) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <h1>Rentautos</h1>
          <p>Falta configurar Supabase para activar usuarios.</p>
          <div className="warning-banner">
            Agrega `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` en tu archivo `.env`.
          </div>
        </section>
      </main>
    );
  }

  if (loadingSession) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <h1>Rentautos</h1>
          <p>Verificando sesion...</p>
        </section>
      </main>
    );
  }

  if (!session) {
    return <AuthPanel />;
  }

  return (
    <AppShell
      userId={session.user.id}
      userEmail={session.user.email}
      onSignOut={handleSignOut}
    />
  );
}
