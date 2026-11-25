import { Suspense, lazy, useEffect } from "react";
import { canDeclareRoutePayment, canRemoveActiveRouteItem, canReportRoutePayment, getRoleScreenPermissions } from "./auth/permissions";
import { useAuthProfile } from "./auth/useAuthProfile";
import AuthPanel from "./components/AuthPanel";
import { isSupabaseConfigured } from "./lib/supabase";
import { isLocalOnlyMode } from "./persistenceMode";
import { preloadRequestedAppPage } from "./app/pageLoaders";
import "./styles.css";

const loadAppShell = () => import("./AppShell");
const AppShell = lazy(loadAppShell);
const ForcePasswordChangePanel = lazy(() => import("./components/ForcePasswordChangePanel"));
const SellerLeadPortalPage = lazy(() => import("./pages/SellerLeadPortalPage"));
const ClientPortalPage = lazy(() => import("./pages/ClientPortalPage"));
const PublicFleetCatalogPage = lazy(() => import("./pages/PublicFleetCatalogPage"));
const CatalogWorkflowDemoPage = lazy(() => import("./pages/CatalogWorkflowDemoPage"));

const testBypassAuth = import.meta.env.VITE_RENTAUTOS_TEST_BYPASS_AUTH === "1";

export default function App() {
  return (
    <Suspense fallback={<main className="auth-page"><section className="auth-card"><h1>Rentautos</h1><p>Cargando aplicacion...</p></section></main>}>
      <AppRoute />
    </Suspense>
  );
}

function AppRoute() {
  const sellerPortalMatch = window.location.pathname.match(/^\/consulta-vendedor\/([0-9a-f-]{36})\/?$/i);
  const sharedPortalMatch = window.location.pathname.match(/^\/consulta-vendedores\/([0-9a-f-]{36})\/?$/i);
  const sellerConsultationLocalDemo = import.meta.env.DEV && /^\/consulta-vendedores\/demo-local\/?$/i.test(window.location.pathname);
  const clientPortalMatch = window.location.pathname.match(/^\/portal-cliente\/?$/i);
  const publicCatalogMatch = window.location.pathname.match(/^\/catalogo\/([0-9a-f-]{36})\/?$/i);
  const catalogWorkflowDemo = import.meta.env.DEV && /^\/demo\/catalogo-autos\/?$/i.test(window.location.pathname);

  if (sellerPortalMatch) return <SellerLeadPortalPage token={sellerPortalMatch[1]} />;
  if (sharedPortalMatch) return <SellerLeadPortalPage portalId={sharedPortalMatch[1]} />;
  if (sellerConsultationLocalDemo) return <SellerLeadPortalPage portalId="demo-local" />;
  if (clientPortalMatch) return <ClientPortalPage />;
  if (publicCatalogMatch) return <PublicFleetCatalogPage ownerUserId={publicCatalogMatch[1]} />;
  if (catalogWorkflowDemo) return <CatalogWorkflowDemoPage />;
  return <AuthenticatedApp />;
}

function AuthenticatedApp() {
  const authProfile = useAuthProfile();
  const sessionUserId = authProfile.session?.user.id;

  useEffect(() => {
    // Download code during profile validation; no operational component mounts
    // or reads data until the existing access checks succeed.
    if (sessionUserId) {
      void loadAppShell().catch(() => {});
      preloadRequestedAppPage(window.location.pathname);
    }
  }, [sessionUserId]);

  if (isLocalOnlyMode && (!isSupabaseConfigured || testBypassAuth)) {
    const permissions = getRoleScreenPermissions("admin");
    return (
      <AppShell
        userEmail={testBypassAuth ? "test-local@rentautos.app" : "local@rentautos.app"}
        isAdmin
        canRemoveRouteItems={canRemoveActiveRouteItem("admin", permissions)}
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
          <button type="button" className="button primary" onClick={() => window.location.reload()}>
            Volver a intentar
          </button>
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
      isAdmin={authProfile.role === "admin"}
      canReportRoutePayments={canReportRoutePayment(authProfile.role, authProfile.permissions)}
      canDeclareRoutePayments={canDeclareRoutePayment(authProfile.role, authProfile.permissions)}
      canRemoveRouteItems={canRemoveActiveRouteItem(authProfile.role, authProfile.permissions)}
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
