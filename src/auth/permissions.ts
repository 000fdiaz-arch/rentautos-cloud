export type AppRole = "admin" | "operador" | "lectura";

export type Permission =
  | "operational.read"
  | "operational.write"
  | "leads.read"
  | "leads.write"
  | "settings.manage"
  | "users.manage"
  | "cash.manage";

export type AppScreen = "leads" | "clients" | "payments" | "receivables" | "control_units" | "settings" | "users";

export type ScreenAccess = {
  view: boolean;
  edit: boolean;
};

export type AppPermissions = Record<AppScreen, ScreenAccess>;

export const APP_SCREENS: Array<{ id: AppScreen; label: string }> = [
  { id: "leads", label: "Leads" },
  { id: "clients", label: "Clientes" },
  { id: "payments", label: "Pagos" },
  { id: "receivables", label: "Cuentas por cobrar" },
  { id: "control_units", label: "Autos" },
  { id: "settings", label: "Configuraciones" },
  { id: "users", label: "Usuarios" }
];

const ROLE_PERMISSIONS: Record<AppRole, ReadonlySet<Permission>> = {
  admin: new Set([
    "operational.read",
    "operational.write",
    "leads.read",
    "leads.write",
    "settings.manage",
    "users.manage",
    "cash.manage"
  ]),
  operador: new Set([
    "operational.read",
    "operational.write",
    "leads.read",
    "leads.write"
  ]),
  lectura: new Set([
    "operational.read"
  ])
};

export const ROLE_SCREEN_PERMISSIONS: Record<AppRole, AppPermissions> = {
  admin: {
    leads: { view: true, edit: true },
    clients: { view: true, edit: true },
    payments: { view: true, edit: true },
    receivables: { view: true, edit: true },
    control_units: { view: true, edit: true },
    settings: { view: true, edit: true },
    users: { view: true, edit: true }
  },
  operador: {
    leads: { view: true, edit: true },
    clients: { view: true, edit: true },
    payments: { view: true, edit: true },
    receivables: { view: true, edit: true },
    control_units: { view: true, edit: true },
    settings: { view: false, edit: false },
    users: { view: false, edit: false }
  },
  lectura: {
    leads: { view: false, edit: false },
    clients: { view: false, edit: false },
    payments: { view: false, edit: false },
    receivables: { view: false, edit: false },
    control_units: { view: true, edit: false },
    settings: { view: false, edit: false },
    users: { view: false, edit: false }
  }
};

export function isAppRole(value: unknown): value is AppRole {
  return value === "admin" || value === "operador" || value === "lectura";
}

export function normalizeAppRole(value: unknown): AppRole {
  return isAppRole(value) ? value : "lectura";
}

export function hasPermission(role: AppRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

function clonePermissions(permissions: AppPermissions): AppPermissions {
  return APP_SCREENS.reduce((acc, screen) => {
    acc[screen.id] = { ...permissions[screen.id] };
    return acc;
  }, {} as AppPermissions);
}

function normalizeScreenAccess(value: unknown, fallback: ScreenAccess): ScreenAccess {
  if (!value || typeof value !== "object") return { ...fallback };
  const record = value as Record<string, unknown>;
  const view = typeof record.view === "boolean" ? record.view : fallback.view;
  const edit = typeof record.edit === "boolean" ? record.edit : fallback.edit;
  return { view, edit: view && edit };
}

export function normalizeAppPermissions(role: AppRole, value: unknown): AppPermissions {
  const fallback = ROLE_SCREEN_PERMISSIONS[role];
  if (role === "admin") return clonePermissions(fallback);
  if (!value || typeof value !== "object" || Array.isArray(value)) return clonePermissions(fallback);
  const record = value as Record<string, unknown>;
  return APP_SCREENS.reduce((acc, screen) => {
    acc[screen.id] = normalizeScreenAccess(record[screen.id], fallback[screen.id]);
    return acc;
  }, {} as AppPermissions);
}

export function getRoleScreenPermissions(role: AppRole): AppPermissions {
  return clonePermissions(ROLE_SCREEN_PERMISSIONS[role]);
}

export function canViewScreen(permissions: AppPermissions, screen: AppScreen): boolean {
  return permissions[screen]?.view === true;
}

export function canEditScreen(permissions: AppPermissions, screen: AppScreen): boolean {
  return permissions[screen]?.view === true && permissions[screen]?.edit === true;
}

export function canWriteOperationalData(role: AppRole, permissions = getRoleScreenPermissions(role)): boolean {
  return hasPermission(role, "operational.write") && (
    canEditScreen(permissions, "clients") ||
    canEditScreen(permissions, "payments") ||
    canEditScreen(permissions, "receivables") ||
    canEditScreen(permissions, "leads") ||
    canEditScreen(permissions, "control_units")
  );
}

export function canManageSettings(role: AppRole, permissions = getRoleScreenPermissions(role)): boolean {
  return hasPermission(role, "settings.manage") && canEditScreen(permissions, "settings");
}

export function canManageUsers(role: AppRole, permissions = getRoleScreenPermissions(role)): boolean {
  return hasPermission(role, "users.manage") && canEditScreen(permissions, "users");
}

export function canUseReadOnlyExperience(role: AppRole, permissions = getRoleScreenPermissions(role)): boolean {
  return role === "lectura" || (
    !canEditScreen(permissions, "clients") &&
    !canEditScreen(permissions, "payments") &&
    !canEditScreen(permissions, "receivables") &&
    !canEditScreen(permissions, "leads") &&
    !canEditScreen(permissions, "control_units")
  );
}

export function resolveDataOwnerUserId(userId?: string, dataOwnerUserId?: string | null): string | undefined {
  return dataOwnerUserId?.trim() || userId || undefined;
}
