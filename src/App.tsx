import AppShell from "./AppShell";
import { useAuthProfile } from "./auth/useAuthProfile";
import AuthPanel from "./components/AuthPanel";
import ForcePasswordChangePanel from "./components/ForcePasswordChangePanel";
import { isSupabaseConfigured } from "./lib/supabase";
import "./styles.css";

export default function App() {
  const authProfile = useAuthProfile();

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

  if (authProfile.loadingAuth) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <h1>Rentautos</h1>
          <p>Verificando sesion...</p>
        </section>
      </main>
    );
  }

  if (authProfile.authBootError) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <h1>Rentautos</h1>
          <p>{authProfile.authBootError}</p>
        </section>
      </main>
    );
  }

  if (!authProfile.session) return <AuthPanel />;

  if (authProfile.loadingProfile) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <h1>Rentautos</h1>
          <p>Cargando perfil...</p>
        </section>
      </main>
    );
  }

  if (authProfile.mustChangePassword) {
    return <ForcePasswordChangePanel onChanged={() => window.location.reload()} />;
  }

  return (
    <AppShell
      userId={authProfile.userId}
      userEmail={authProfile.userEmail}
      dataOwnerUserId={authProfile.dataOwnerUserId}
      effectiveOwnerUserId={authProfile.effectiveOwnerUserId}
      permissions={authProfile.permissions}
      canWriteOperationalData={authProfile.canWriteOperationalData}
      canManageSettings={authProfile.canManageSettings}
      canManageUsers={authProfile.canManageUsers}
      isReadOnlyExperience={authProfile.isReadOnlyExperience}
      onSignOut={authProfile.signOut}
    />
  );
}
