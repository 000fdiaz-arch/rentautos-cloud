import { getBusinessDateKey } from "./billing";
import type { RouteCaptureEvent, RouteRun } from "./cloud/routeCaptureCloudData";
import type { RoutePaymentReport } from "./cloud/routeReportCloudData";
import type { ActiveRouteItem } from "./cloudData";

export type RouteDeltaKey = "delta1" | "delta2" | "delta3";
export type RouteManagedActionKind = "paid" | "custody" | "absent";

export const ROUTE_DELTAS = [
  { key: "delta1", email: "delta1@auth.rentautos.local", label: "Delta 1", route: "PTY" },
  { key: "delta2", email: "delta2@auth.rentautos.local", label: "Delta 2", route: "WC" },
  { key: "delta3", email: "delta3@auth.rentautos.local", label: "Delta 3", route: "PTY" }
] as const satisfies ReadonlyArray<{ key: RouteDeltaKey; email: string; label: string; route: string }>;

export type RouteManagedAction = {
  id: string;
  clientId: string;
  unitId: string;
  clientName: string;
  routeAssignment: string;
  delta: RouteDeltaKey;
  kind: RouteManagedActionKind;
  occurredAt: string;
  cashAmount: number;
  bankAmount: number;
  report?: RoutePaymentReport;
  capture?: RouteCaptureEvent;
  item?: ActiveRouteItem;
};

type IdentitySource = {
  reports: RoutePaymentReport[];
  captures: RouteCaptureEvent[];
  runs: RouteRun[];
  currentUserId?: string;
  currentUserEmail?: string;
};

export type RouteDeltaIdentityMap = Map<string, RouteDeltaKey>;

function normalizedIdentity(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export function routeDeltaFromName(value: string | undefined): RouteDeltaKey | null {
  const normalized = normalizedIdentity(value);
  if (!normalized) return null;
  const known = ROUTE_DELTAS.find((delta) => delta.email === normalized || delta.key === normalized.replace(/\s+/g, ""));
  if (known) return known.key;
  const login = normalized.split("@")[0].replace(/[\s_-]+/g, "");
  const match = login.match(/^delta([123])$/);
  return match ? `delta${match[1]}` as RouteDeltaKey : null;
}

export function buildRouteDeltaIdentityMap(source: IdentitySource): RouteDeltaIdentityMap {
  const identities = new Map<string, RouteDeltaKey>();
  const remember = (actorId: string | undefined, actorName: string | undefined) => {
    const key = routeDeltaFromName(actorName);
    const id = normalizedIdentity(actorId);
    if (key && id) identities.set(id, key);
  };
  source.reports.forEach((report) => remember(report.reported_by, report.reporter_name));
  source.captures.forEach((capture) => remember(capture.reported_by, capture.reporter_name));
  source.runs.forEach((run) => remember(run.operator_id, run.operator_name));
  remember(source.currentUserId, source.currentUserEmail);
  return identities;
}

export function routeDeltaForActor(actorId: string | undefined, actorName: string | undefined, identities: RouteDeltaIdentityMap): RouteDeltaKey | null {
  return routeDeltaFromName(actorName) ?? identities.get(normalizedIdentity(actorId)) ?? null;
}

function happenedOnBusinessDate(value: string | undefined, businessDateKey: string): boolean {
  if (!value) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && getBusinessDateKey(date) === businessDateKey;
}

export function buildRouteManagedActions(input: IdentitySource & { items: ActiveRouteItem[]; businessDateKey: string }): RouteManagedAction[] {
  const identities = buildRouteDeltaIdentityMap(input);
  const actions: RouteManagedAction[] = [];

  input.reports.forEach((report) => {
    if (!happenedOnBusinessDate(report.reported_at, input.businessDateKey)) return;
    const delta = routeDeltaForActor(report.reported_by, report.reporter_name, identities);
    if (!delta) return;
    actions.push({
      id: `payment:${report.id}`,
      clientId: report.client_id,
      unitId: report.snapshot.unitId,
      clientName: report.snapshot.clientName,
      routeAssignment: report.snapshot.routeAssignment ?? ROUTE_DELTAS.find((row) => row.key === delta)?.route ?? "",
      delta,
      kind: "paid",
      occurredAt: report.reported_at,
      cashAmount: report.cash_amount,
      bankAmount: report.bank_amount,
      report
    });
  });

  input.captures.forEach((capture) => {
    if (!happenedOnBusinessDate(capture.reported_at, input.businessDateKey)) return;
    const delta = routeDeltaForActor(capture.reported_by, capture.reporter_name, identities);
    if (!delta) return;
    actions.push({
      id: `custody:${capture.id}`,
      clientId: capture.client_id,
      unitId: capture.unit_id,
      clientName: capture.client_name,
      routeAssignment: capture.route_assignment || ROUTE_DELTAS.find((row) => row.key === delta)?.route || "",
      delta,
      kind: "custody",
      occurredAt: capture.reported_at,
      cashAmount: 0,
      bankAmount: 0,
      capture
    });
  });

  input.items.forEach((item) => {
    if (!happenedOnBusinessDate(item.routeInactiveAt, input.businessDateKey)) return;
    const delta = routeDeltaForActor(item.routeInactiveBy, undefined, identities);
    if (!delta || !item.routeInactiveAt) return;
    actions.push({
      id: `absent:${item.clientId}:${item.routeInactiveAt}`,
      clientId: item.clientId,
      unitId: item.unitId,
      clientName: item.clientName,
      routeAssignment: item.routeAssignment ?? ROUTE_DELTAS.find((row) => row.key === delta)?.route ?? "",
      delta,
      kind: "absent",
      occurredAt: item.routeInactiveAt,
      cashAmount: 0,
      bankAmount: 0,
      item
    });
  });

  return actions.sort((left, right) => right.occurredAt.localeCompare(left.occurredAt) || left.id.localeCompare(right.id));
}

export function routeDeltaLabel(key: RouteDeltaKey): string {
  return ROUTE_DELTAS.find((delta) => delta.key === key)?.label ?? key;
}
