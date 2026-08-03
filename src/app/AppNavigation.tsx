export type AppPage = "clients" | "leads" | "payments" | "receivables" | "route_search" | "insurance_workflow" | "control_units" | "settings";

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
  const tabs: Array<{ page: AppPage; label: string; mobileLabel: string; visible: boolean }> = [
    { page: "leads", label: "Leads", mobileLabel: "Leads", visible: canViewLeads },
    { page: "clients", label: "Clientes", mobileLabel: "Clientes", visible: canViewClients },
    { page: "payments", label: "Pagos", mobileLabel: "Pagos", visible: canViewPayments },
    { page: "receivables", label: "Cuentas por cobrar", mobileLabel: "Cuentas", visible: canViewReceivables },
    { page: "route_search", label: "Vista Buscador", mobileLabel: "Ruta", visible: canViewRouteSearch },
    { page: "insurance_workflow", label: "Flujo seguros", mobileLabel: "Seguros", visible: canViewReceivables },
    { page: "control_units", label: "Autos", mobileLabel: "Autos", visible: canViewControlUnits },
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
            <button
              key={tab.page}
              type="button"
              className={`nav-tab ${page === tab.page ? "nav-tab--active" : ""}`}
              onClick={() => onPageChange(tab.page)}
            >
              <span className="nav-tab-label-full">{tab.label}</span>
              <span className="nav-tab-label-mobile">{tab.mobileLabel}</span>
            </button>
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
