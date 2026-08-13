import type { AppPage } from "./appRoutes";
import { appPagePath } from "./appRoutes";

export type { AppPage } from "./appRoutes";

type Props = {
  page: AppPage;
  canViewLeads: boolean;
  canViewClients: boolean;
  canViewPayments: boolean;
  canViewReceivables: boolean;
  canViewRouteSearch: boolean;
  canViewControlUnits: boolean;
  canViewSettings: boolean;
  showCoreSyncStatus?: boolean;
  syncStatus: "idle" | "syncing" | "ok" | "error";
  syncErrorMessage: string;
  lastSyncAt: string;
  userEmail?: string;
  canSignOut: boolean;
  onPageChange: (page: AppPage) => void;
  onSignOut: () => void;
};

export default function AppNavigation({
  page,
  canViewLeads,
  canViewClients,
  canViewPayments,
  canViewReceivables,
  canViewRouteSearch,
  canViewControlUnits,
  canViewSettings,
  showCoreSyncStatus = true,
  syncStatus,
  syncErrorMessage,
  lastSyncAt,
  userEmail,
  canSignOut,
  onPageChange,
  onSignOut
}: Props) {
  const tabs: Array<{ page: AppPage; label: string; mobileLabel: string; visible: boolean; badge?: number }> = [
    { page: "leads", label: "Leads", mobileLabel: "Leads", visible: canViewLeads },
    { page: "control_units", label: "Autos", mobileLabel: "Autos", visible: canViewControlUnits },
    { page: "clients", label: "Clientes", mobileLabel: "Clientes", visible: canViewClients },
    { page: "payments", label: "Pagos", mobileLabel: "Pagos", visible: canViewPayments },
    { page: "receivables", label: "Cuentas por cobrar", mobileLabel: "Cuentas", visible: canViewReceivables },
    { page: "route_search", label: "Ruta en calle", mobileLabel: "Ruta", visible: canViewRouteSearch },
    { page: "settings", label: "Configuraciones", mobileLabel: "Config.", visible: canViewSettings }
  ];
  const effectiveSyncStatus = showCoreSyncStatus ? syncStatus : "ok";
  const effectiveSyncErrorMessage = showCoreSyncStatus ? syncErrorMessage : "";
  const cloudLabel = effectiveSyncStatus === "syncing"
    ? "Sincronizando..."
    : effectiveSyncStatus === "ok"
      ? "En nube"
      : effectiveSyncStatus === "error"
        ? "Error"
        : "Listo";

  return (
    <nav className="app-nav">
      <div className="app-nav-inner">
        <span className="app-nav-brand">Rentautos</span>
        <div className="app-nav-tabs">
          {tabs.filter((tab) => tab.visible).map((tab) => (
            <a
              key={tab.page}
              href={appPagePath(tab.page)}
              className={`nav-tab ${page === tab.page ? "nav-tab--active" : ""}`}
              aria-current={page === tab.page ? "page" : undefined}
              onClick={(event) => {
                if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                onPageChange(tab.page);
              }}
            >
              <span className="nav-tab-label-full">{tab.label}</span>
              <span className="nav-tab-label-mobile">{tab.mobileLabel}</span>
              {Boolean(tab.badge) && <span className="nav-tab-badge nav-tab-badge--alert" aria-label={`${tab.badge} expedientes con alertas activas`} title={`${tab.badge} expedientes requieren seguimiento`}>{tab.badge! > 99 ? "99+" : tab.badge}</span>}
            </a>
          ))}
        </div>
        <div className="backup-nav-zone">
          <span className="hint">Estado nube: {cloudLabel}</span>
          {lastSyncAt && <span className="hint" style={{ marginLeft: 8 }}>Ultima sync: {lastSyncAt}</span>}
          {effectiveSyncStatus === "error" && effectiveSyncErrorMessage && (
            <span className="hint" style={{ marginLeft: 8, color: "#b42318" }}>{effectiveSyncErrorMessage}</span>
          )}
        </div>
        {canSignOut && (
          <div className="backup-nav-zone auth-nav-zone">
            {userEmail && <span className="hint">{userEmail}</span>}
            <button type="button" className="nav-backup-btn nav-backup-btn--setup" onClick={onSignOut} title="Cerrar sesion">
              Cerrar sesion
            </button>
          </div>
        )}
      </div>
    </nav>
  );
}
