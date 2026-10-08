import type { ActiveRouteItem } from "./cloudData";

export type RouteTimeUrgency = "normal" | "upcoming" | "attention" | "urgent";

export const ROUTE_UPCOMING_AFTER_MINUTES = 2 * 60;
export const ROUTE_ATTENTION_AFTER_MINUTES = 4 * 60;
export const ROUTE_URGENT_AFTER_MINUTES = 8 * 60;

export function formatRouteDateTime(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("es-PA", {
    timeZone: "America/Panama",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes): string => parts.find((part) => part.type === type)?.value ?? "";
  const dayPeriod = get("dayPeriod");
  return `${get("day")}/${get("month")}/${get("year")}, ${get("hour")}:${get("minute")}${dayPeriod ? ` ${dayPeriod}` : ""}`;
}

const urgencyRank: Record<RouteTimeUrgency, number> = {
  normal: 0,
  upcoming: 1,
  attention: 2,
  urgent: 3
};

export function routeElapsedMinutes(publishedAt: string, now: number): number {
  const startedAt = Date.parse(publishedAt);
  if (!Number.isFinite(startedAt)) return 0;
  return Math.max(0, Math.floor((now - startedAt) / 60_000));
}

export function routeTimeUrgency(publishedAt: string, now: number): RouteTimeUrgency {
  const minutes = routeElapsedMinutes(publishedAt, now);
  if (minutes >= ROUTE_URGENT_AFTER_MINUTES) return "urgent";
  if (minutes >= ROUTE_ATTENTION_AFTER_MINUTES) return "attention";
  if (minutes >= ROUTE_UPCOMING_AFTER_MINUTES) return "upcoming";
  return "normal";
}

function manualRouteUrgency(item: Pick<ActiveRouteItem, "urgency">): RouteTimeUrgency {
  if (item.urgency === "very_urgent") return "urgent";
  if (item.urgency === "urgent") return "attention";
  return "normal";
}

export function effectiveRouteUrgency(item: Pick<ActiveRouteItem, "publishedAt" | "urgency">, now: number): RouteTimeUrgency {
  const timed = routeTimeUrgency(item.publishedAt, now);
  const manual = manualRouteUrgency(item);
  return urgencyRank[manual] > urgencyRank[timed] ? manual : timed;
}

export function routeUrgencyLabel(item: Pick<ActiveRouteItem, "publishedAt" | "urgency">, now: number): string {
  const level = effectiveRouteUrgency(item, now);
  if (item.urgency === "very_urgent" && level === "urgent") return "Muy urgente";
  if (item.urgency === "urgent" && level === "attention") return "Urgente";
  if (level === "urgent") return "Urgente";
  if (level === "attention") return "Atención";
  if (level === "upcoming") return "Próxima atención";
  return "En tiempo";
}

export function compareRouteWorkItemsByUrgency(left: ActiveRouteItem, right: ActiveRouteItem, now: number): number {
  const priority = urgencyRank[effectiveRouteUrgency(right, now)] - urgencyRank[effectiveRouteUrgency(left, now)];
  if (priority !== 0) return priority;

  const leftStartedAt = Date.parse(left.publishedAt);
  const rightStartedAt = Date.parse(right.publishedAt);
  if (Number.isFinite(leftStartedAt) && Number.isFinite(rightStartedAt) && leftStartedAt !== rightStartedAt) {
    return leftStartedAt - rightStartedAt;
  }
  return left.unitId.localeCompare(right.unitId, "es", { numeric: true, sensitivity: "base" });
}

export function summarizeRouteTimeUrgency(items: ActiveRouteItem[], now: number): Record<RouteTimeUrgency, number> {
  const summary: Record<RouteTimeUrgency, number> = { normal: 0, upcoming: 0, attention: 0, urgent: 0 };
  for (const item of items) summary[effectiveRouteUrgency(item, now)] += 1;
  return summary;
}
