import { useEffect, useState, type MouseEvent } from "react";
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
  canViewIncidents: boolean;
  canViewControlUnits: boolean;
  canViewSettings: boolean;
  incidentAlertCount?: number;
  routeReviewCount?: number;
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
  canViewIncidents,
  canViewControlUnits,
  canViewSettings,
  incidentAlertCount = 0,
  routeReviewCount = 0,
  showCoreSyncStatus = true,
  syncStatus,
  syncErrorMessage,
  lastSyncAt,
  userEmail,
  canSignOut,
  onPageChange,
  onSignOut
}: Props) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const tabs: Array<{ page: AppPage; label: string; mobileLabel: string; mobileIcon: string; visible: boolean; badge?: number }> = [
    { page: "leads", label: "Leads", mobileLabel: "Leads", mobileIcon: "◎", visible: canViewLeads },
    { page: "control_units", label: "Autos", mobileLabel: "Autos", mobileIcon: "◆", visible: canViewControlUnits },
    { page: "clients", label: "Clientes", mobileLabel: "Clientes", mobileIcon: "●", visible: canViewClients },
    { page: "payments", label: "Pagos", mobileLabel: "Pagos", mobileIcon: "$", visible: canViewPayments },
    { page: "receivables", label: "Cuentas por cobrar", mobileLabel: "Cuentas", mobileIcon: "≡", visible: canViewReceivables },
    { page: "route_search", label: "Ruta en calle", mobileLabel: "Ruta", mobileIcon: "↗", visible: canViewRouteSearch, badge: routeReviewCount },
    { page: "incidents", label: "Control de siniestros", mobileLabel: "Siniestros", mobileIcon: "!", visible: canViewIncidents, badge: incidentAlertCount },
    { page: "settings", label: "Configuraciones", mobileLabel: "Config.", mobileIcon: "⚙", visible: canViewSettings }
  ];
  const visibleTabs = tabs.filter((tab) => tab.visible);
  const primaryOrder: AppPage[] = ["clients", "payments", "receivables", "route_search"];
  const primaryTabs = primaryOrder
    .map((primaryPage) => visibleTabs.find((tab) => tab.page === primaryPage))
    .filter((tab): tab is (typeof visibleTabs)[number] => Boolean(tab));
  for (const tab of visibleTabs) {
    if (primaryTabs.length >= 4) break;
    if (!primaryTabs.some((primaryTab) => primaryTab.page === tab.page)) primaryTabs.push(tab);
  }
  const moreTabs = visibleTabs.filter((tab) => !primaryTabs.some((primaryTab) => primaryTab.page === tab.page));

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [page]);

  function handlePageClick(event: MouseEvent<HTMLAnchorElement>, nextPage: AppPage): void {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    setMobileMenuOpen(false);
    onPageChange(nextPage);
  }
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
          {visibleTabs.map((tab) => (
            <a
              key={tab.page}
              href={appPagePath(tab.page)}
              className={`nav-tab ${page === tab.page ? "nav-tab--active" : ""}`}
              aria-current={page === tab.page ? "page" : undefined}
              onClick={(event) => handlePageClick(event, tab.page)}
            >
              <span className="nav-tab-label-full">{tab.label}</span>
              <span className="nav-tab-label-mobile">{tab.mobileLabel}</span>
              {Boolean(tab.badge) && (
                <span
                  className="nav-tab-badge nav-tab-badge--alert"
                  aria-label={tab.page === "route_search" ? `${tab.badge} unidades pendientes de revision` : `${tab.badge} expedientes con alertas activas`}
                  title={tab.page === "route_search" ? `${tab.badge} unidades requieren una decision` : `${tab.badge} expedientes requieren seguimiento`}
                >
                  {tab.badge! > 99 ? "99+" : tab.badge}
                </span>
              )}
            </a>
          ))}
        </div>
        {mobileMenuOpen ? (
          <div className="app-nav-mobile-more" role="dialog" aria-modal="false" aria-label="Más opciones">
            <strong>Más opciones</strong>
            <div className="app-nav-mobile-more-grid">
              {moreTabs.map((tab) => (
                <a
                  key={tab.page}
                  href={appPagePath(tab.page)}
                  className={page === tab.page ? "is-active" : ""}
                  aria-current={page === tab.page ? "page" : undefined}
                  onClick={(event) => handlePageClick(event, tab.page)}
                >
                  <span aria-hidden="true">{tab.mobileIcon}</span>
                  <b>{tab.mobileLabel}</b>
                  {Boolean(tab.badge) ? <em>{tab.badge! > 99 ? "99+" : tab.badge}</em> : null}
                </a>
              ))}
            </div>
            {canSignOut ? (
              <button type="button" className="app-nav-mobile-signout" onClick={onSignOut}>Cerrar sesión</button>
            ) : null}
          </div>
        ) : null}
        <div className="app-nav-mobile-tabs" aria-label="Navegación principal">
          {primaryTabs.map((tab) => (
            <a
              key={tab.page}
              href={appPagePath(tab.page)}
              className={page === tab.page ? "is-active" : ""}
              aria-current={page === tab.page ? "page" : undefined}
              onClick={(event) => handlePageClick(event, tab.page)}
            >
              <span className="app-nav-mobile-icon" aria-hidden="true">{tab.mobileIcon}</span>
              <b>{tab.mobileLabel}</b>
              {Boolean(tab.badge) ? <em>{tab.badge! > 99 ? "99+" : tab.badge}</em> : null}
            </a>
          ))}
          {(moreTabs.length > 0 || canSignOut) ? (
            <button
              type="button"
              className={mobileMenuOpen ? "is-active" : ""}
              aria-expanded={mobileMenuOpen}
              onClick={() => setMobileMenuOpen((current) => !current)}
            >
              <span className="app-nav-mobile-icon" aria-hidden="true">•••</span>
              <b>Más</b>
            </button>
          ) : null}
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
