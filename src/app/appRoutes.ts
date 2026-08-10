export type AppPage = "clients" | "leads" | "payments" | "receivables" | "route_search" | "insurance_workflow" | "control_units" | "settings";

const APP_PAGE_PATHS: Record<AppPage, string> = {
  leads: "/leads",
  clients: "/clientes",
  payments: "/pagos",
  receivables: "/cuentas-por-cobrar",
  route_search: "/ruta-en-calle",
  insurance_workflow: "/reclamos-seguros",
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
  const match = (Object.entries(APP_PAGE_PATHS) as Array<[AppPage, string]>)
    .find(([, pagePath]) => pagePath === normalized);
  return match?.[0] ?? null;
}

export function isCanonicalAppPagePath(pathname: string, page: AppPage): boolean {
  return pathname === appPagePath(page);
}
