export type AppPage = "clients" | "leads" | "payments" | "receivables" | "route_search" | "incidents" | "control_units" | "settings";

const APP_PAGE_PATHS: Record<AppPage, string> = {
  leads: "/leads",
  clients: "/clientes",
  payments: "/pagos",
  receivables: "/cuentas-por-cobrar",
  route_search: "/ruta-en-calle",
  incidents: "/gestion-de-siniestros",
  control_units: "/autos",
  settings: "/configuraciones"
};

function normalizePathname(pathname: string): string {
  const normalized = `/${pathname.split("/").filter(Boolean).join("/")}`.toLowerCase();
  return normalized === "/" ? normalized : normalized.replace(/\/+$/, "");
}

export function appPagePath(page: AppPage): string {
  return APP_PAGE_PATHS[page];
}

export function appPageFromPathname(pathname: string): AppPage | null {
  const normalized = normalizePathname(pathname);
  if (normalized === "/reclamos-seguros" || normalized === "/colisiones-y-choques") return "incidents";
  const match = (Object.entries(APP_PAGE_PATHS) as Array<[AppPage, string]>)
    .find(([, pagePath]) => pagePath === normalized);
  return match?.[0] ?? null;
}

export function isCanonicalAppPagePath(pathname: string, page: AppPage): boolean {
  return pathname === appPagePath(page);
}
