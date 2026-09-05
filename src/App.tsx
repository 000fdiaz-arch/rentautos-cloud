import AppShell from "./AppShell";
import { canReportRoutePayment, getRoleScreenPermissions } from "./auth/permissions";
import { useAuthProfile } from "./auth/useAuthProfile";
import AuthPanel from "./components/AuthPanel";
import ForcePasswordChangePanel from "./components/ForcePasswordChangePanel";
import { isSupabaseConfigured } from "./lib/supabase";
import { isLocalOnlyMode } from "./persistenceMode";
import "./styles.css";
import SellerLeadPortalPage from "./pages/SellerLeadPortalPage";

const testBypassAuth = import.meta.env.VITE_RENTAUTOS_TEST_BYPASS_AUTH === "1";

export default function App() {
  const sellerPortalMatch = window.location.pathname.match(/^\/consulta-vendedor\/([0-9a-f-]{36})\/?$/i);
  const sharedPortalMatch = window.location.pathname.match(/^\/consulta-vendedores\/([0-9a-f-]{36})\/?$/i);

  if (sellerPortalMatch) return <SellerLeadPortalPage token={sellerPortalMatch[1]} />;
  if (sharedPortalMatch) return <SellerLeadPortalPage portalId={sharedPortalMatch[1]} />;
  return <AuthenticatedApp />;
}

function AuthenticatedApp() {
  const authProfile = useAuthProfile();

  if (isLocalOnlyMode && (!isSupabaseConfigured || testBypassAuth)) {
    const permissions = getRoleScreenPermissions("admin");
    return (
      <AppShell
        userEmail={testBypassAuth ? "test-local@rentautos.app" : "local@rentautos.app"}
        permissions={permissions}
        canWriteOperationalData
        canManageSettings
        canManageUsers
        isReadOnlyExperience={false}
      />
    );
  }

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

  if (!authProfile.isActive) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <h1>Rentautos</h1>
          <p>Este usuario esta inactivo. Contacta a un administrador para recuperar el acceso.</p>
          <button type="button" className="button primary" onClick={() => void authProfile.signOut()}>
            Volver al inicio de sesion
          </button>
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
      canReportRoutePayments={canReportRoutePayment(authProfile.role, authProfile.permissions)}
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
