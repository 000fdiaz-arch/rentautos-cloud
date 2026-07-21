export type AppPage = "clients" | "leads" | "payments" | "control_units" | "settings";

type Props = {
  page: AppPage;
  canViewLeads: boolean;
  canViewClients: boolean;
  canViewPayments: boolean;
  canViewControlUnits: boolean;
  canViewSettings: boolean;
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
  canViewControlUnits,
  canViewSettings,
  syncStatus,
  syncErrorMessage,
  lastSyncAt,
  userEmail,
  canSignOut,
  onPageChange,
  onSignOut
}: Props) {
  const tabs: Array<{ page: AppPage; label: string; visible: boolean }> = [
    { page: "leads", label: "Leads", visible: canViewLeads },
    { page: "clients", label: "Clientes", visible: canViewClients },
    { page: "payments", label: "Pagos", visible: canViewPayments },
    { page: "control_units", label: "Autos", visible: canViewControlUnits },
    { page: "settings", label: "Configuraciones", visible: canViewSettings }
  ];
  const cloudLabel = syncStatus === "syncing"
    ? "Sincronizando..."
    : syncStatus === "ok"
      ? "En nube"
      : syncStatus === "error"
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
              {tab.label}
            </button>
          ))}
        </div>
        <div className="backup-nav-zone">
          <span className="hint">Estado nube: {cloudLabel}</span>
          {lastSyncAt && <span className="hint" style={{ marginLeft: 8 }}>Ultima sync: {lastSyncAt}</span>}
          {syncStatus === "error" && syncErrorMessage && (
            <span className="hint" style={{ marginLeft: 8, color: "#b42318" }}>{syncErrorMessage}</span>
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
