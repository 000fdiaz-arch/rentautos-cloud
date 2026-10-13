import { dedupeLoad, getCloudClient, PAGE_SIZE } from "./cloudClient";

export type RouteCaptureStatus = "pending" | "confirmed";

export type RouteCaptureEvent = {
  id: string;
  user_id: string;
  client_id: string;
  unit_id: string;
  client_name: string;
  published_at: string;
  route_assignment: string;
  route_run_id: string | null;
  reported_by: string;
  reporter_name: string;
  reported_at: string;
  status: RouteCaptureStatus;
  confirmed_by: string | null;
  confirmed_at: string | null;
  released_at: string | null;
};

function normalizeRouteCaptureEvent(row: Record<string, unknown>): RouteCaptureEvent {
  return {
    id: String(row.id ?? ""),
    user_id: String(row.user_id ?? ""),
    client_id: String(row.client_id ?? ""),
    unit_id: String(row.unit_id ?? ""),
    client_name: String(row.client_name ?? ""),
    published_at: String(row.published_at ?? ""),
    route_assignment: String(row.route_assignment ?? ""),
    route_run_id: typeof row.route_run_id === "string" ? row.route_run_id : null,
    reported_by: String(row.reported_by ?? ""),
    reporter_name: String(row.reporter_name ?? "Usuario"),
    reported_at: String(row.reported_at ?? ""),
    status: row.status === "confirmed" ? "confirmed" : "pending",
    confirmed_by: typeof row.confirmed_by === "string" ? row.confirmed_by : null,
    confirmed_at: typeof row.confirmed_at === "string" ? row.confirmed_at : null,
    released_at: typeof row.released_at === "string" ? row.released_at : null
  };
}

export async function loadRouteCaptureEvents(ownerId: string): Promise<RouteCaptureEvent[]> {
  return dedupeLoad(`route-capture-events:${ownerId}`, async () => {
    const rows: RouteCaptureEvent[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await getCloudClient()
        .from("route_capture_events")
        .select("id,user_id,client_id,unit_id,client_name,published_at,route_assignment,route_run_id,reported_by,reporter_name,reported_at,status,confirmed_by,confirmed_at,released_at")
        .eq("user_id", ownerId)
        .order("reported_at", { ascending: false })
        .order("id")
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) throw error;
      rows.push(...(data ?? []).map((row) => normalizeRouteCaptureEvent(row)));
      if (!data || data.length < PAGE_SIZE) return rows;
    }
  });
}

export async function confirmRouteCapture(captureId: string): Promise<void> {
  const { error } = await getCloudClient().rpc("confirm_route_capture", { p_capture_id: captureId });
  if (error) throw error;
}

export type RouteRunStatus = "in_progress" | "pending" | "confirmed";

export type RouteRun = {
  id: string;
  user_id: string;
  route_assignment: string;
  operator_id: string;
  operator_name: string;
  started_at: string;
  submitted_at: string | null;
  status: RouteRunStatus;
  confirmed_by: string | null;
  confirmed_at: string | null;
};

export async function loadRouteRuns(ownerId: string): Promise<RouteRun[]> {
  const { data, error } = await getCloudClient()
    .from("route_runs")
    .select("id,user_id,route_assignment,operator_id,operator_name,started_at,submitted_at,status,confirmed_by,confirmed_at")
    .eq("user_id", ownerId)
    .order("started_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  return (data ?? []) as RouteRun[];
}

export async function startRouteRun(ownerId: string, route: string): Promise<void> {
  const { error } = await getCloudClient().rpc("start_route_run", { p_user_id: ownerId, p_route: route });
  if (error) throw error;
}

export async function submitRouteRun(runId: string): Promise<void> {
  const { error } = await getCloudClient().rpc("submit_route_run", { p_run_id: runId });
  if (error) throw error;
}

export async function confirmRouteRun(runId: string): Promise<void> {
  const { error } = await getCloudClient().rpc("confirm_route_run", { p_run_id: runId });
  if (error) throw error;
}
