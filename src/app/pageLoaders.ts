import { appPageFromPathname, type AppPage } from "./appRoutes";

// Shared by React.lazy and startup preloading. Importing this map downloads no
// page; only the requested route is fetched, and no component mounts here.
export const appPageLoaders = {
  clients: () => import("../pages/ClientsPage"),
  leads: () => import("../pages/LeadsPage"),
  payments: () => import("../pages/PaymentsPage"),
  receivables: () => import("../pages/ReceivablesPage"),
  receivables_v2: () => import("../pages/ReceivablesV2Page"),
  route_search: () => import("../pages/RouteSearchPage"),
  incidents: () => import("../pages/IncidentsControlPage"),
  control_units: () => import("../pages/ControlUnitsPage"),
  settings: () => import("../pages/SettingsPage")
} satisfies Record<AppPage, () => Promise<unknown>>;

export function preloadRequestedAppPage(pathname: string): void {
  const page = appPageFromPathname(pathname);
  if (page) void appPageLoaders[page]().catch(() => {});
}
