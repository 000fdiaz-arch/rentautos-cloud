import { getCloudClient } from "./cloudClient";

export type RouteVehicleDetails = { plate: string | null; color: string | null; brandModel: string | null };

export async function loadRouteVehicleDetails(input: {
  ownerId: string; clientId: string; publishedAt: string; version: "legacy" | "v2";
}): Promise<RouteVehicleDetails> {
  const { data, error } = await getCloudClient().rpc("read_route_vehicle_details", {
    p_user_id: input.ownerId, p_client_id: input.clientId,
    p_published_at: input.publishedAt, p_version: input.version
  });
  if (error) throw error;
  const value = data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : {};
  const text = (key: string) => typeof value[key] === "string" && value[key].trim() ? value[key].trim() : null;
  return { plate: text("plate"), color: text("color"), brandModel: text("brandModel") };
}
