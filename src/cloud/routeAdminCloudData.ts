import { getCloudClient } from "./cloudClient";
import type { FieldManagementType } from "../pages/receivables/receivablesTypes";

export async function updateRouteManagementType(input: {
  ownerId: string; clientId: string; publishedAt: string; previousType: FieldManagementType;
  managementType: FieldManagementType; version: "legacy" | "v2";
}): Promise<void> {
  const { error } = await getCloudClient().rpc("update_route_management_type", {
    p_user_id: input.ownerId, p_client_id: input.clientId, p_published_at: input.publishedAt,
    p_previous_type: input.previousType, p_management_type: input.managementType, p_version: input.version
  });
  if (error) throw error;
}

export async function setRoutePanapassReason(input: {
  ownerId: string; clientId: string; publishedAt: string; previous: boolean;
  panapass: boolean; version: "legacy" | "v2";
}): Promise<void> {
  const { error } = await getCloudClient().rpc("set_route_panapass_reason", {
    p_user_id: input.ownerId, p_client_id: input.clientId, p_published_at: input.publishedAt,
    p_previous: input.previous, p_panapass: input.panapass, p_version: input.version
  });
  if (error) throw error;
}
