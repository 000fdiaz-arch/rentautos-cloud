import type { ActiveRouteItem } from "./cloudData";

export const ALL_ACTIVE_ROUTE_FILTER = "__all__";
export const EMPTY_ACTIVE_ROUTE_FILTER = "__empty__";

export function activeRouteFilterValue(routeAssignment: string | undefined): string {
  const normalized = (routeAssignment ?? "").trim().toUpperCase();
  return normalized || EMPTY_ACTIVE_ROUTE_FILTER;
}

export function activeRouteFilterLabel(value: string): string {
  return value === EMPTY_ACTIVE_ROUTE_FILTER ? "Sin ruta" : value;
}

function routeRank(routeAssignment: string | undefined): number {
  const normalized = (routeAssignment ?? "").trim().toUpperCase();
  if (normalized === "PTY") return 0;
  if (normalized === "WC") return 2;
  return 1;
}

export function compareActiveRouteFilterValues(left: string, right: string): number {
  const leftRoute = left === EMPTY_ACTIVE_ROUTE_FILTER ? "" : left;
  const rightRoute = right === EMPTY_ACTIVE_ROUTE_FILTER ? "" : right;
  const rankCompare = routeRank(leftRoute) - routeRank(rightRoute);
  if (rankCompare !== 0) return rankCompare;
  return leftRoute.localeCompare(rightRoute, "es", {
    numeric: true,
    sensitivity: "base"
  });
}

function urgencyRank(urgency: ActiveRouteItem["urgency"]): number {
  if (urgency === "very_urgent") return 0;
  if (urgency === "urgent") return 1;
  return 2;
}

export function compareActiveRouteItems(left: ActiveRouteItem, right: ActiveRouteItem): number {
  const leftRouteRank = routeRank(left.routeAssignment);
  const rightRouteRank = routeRank(right.routeAssignment);
  if (leftRouteRank !== rightRouteRank) return leftRouteRank - rightRouteRank;

  const routeCompare = (left.routeAssignment ?? "").localeCompare(right.routeAssignment ?? "", "es", {
    numeric: true,
    sensitivity: "base"
  });
  if (routeCompare !== 0) return routeCompare;

  const urgencyCompare = urgencyRank(left.urgency) - urgencyRank(right.urgency);
  if (urgencyCompare !== 0) return urgencyCompare;

  return left.unitId.localeCompare(right.unitId, "es", {
    numeric: true,
    sensitivity: "base"
  });
}
