import { getCloudClient } from "./cloudClient";
import {
  getRoleScreenPermissions,
  normalizeAppPermissions,
  normalizeAppRole,
  type AppPermissions,
  type AppRole
} from "../auth/permissions";

export type UserProfileRow = {
  id: string;
  email: string | null;
  role: AppRole;
  data_owner_user_id: string | null;
  permissions: AppPermissions;
  created_at?: string | null;
  updated_at?: string | null;
};

type RawUserProfileRow = {
  id: string;
  email: string | null;
  role: unknown;
  data_owner_user_id: string | null;
  permissions?: unknown;
  created_at?: string | null;
  updated_at?: string | null;
};

function normalizeRow(row: RawUserProfileRow): UserProfileRow {
  const role = normalizeAppRole(row.role);
  return {
    id: row.id,
    email: row.email,
    role,
    data_owner_user_id: row.data_owner_user_id,
    permissions: normalizeAppPermissions(role, row.permissions),
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

export async function loadUserProfiles(): Promise<UserProfileRow[]> {
  const client = getCloudClient();
  const { data, error } = await client
    .from("user_profiles")
    .select("id,email,role,data_owner_user_id,permissions,created_at,updated_at")
    .order("email", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as RawUserProfileRow[]).map(normalizeRow);
}

export async function saveUserProfileAccess(input: {
  id: string;
  role: AppRole;
  dataOwnerUserId: string | null;
  permissions: AppPermissions;
}): Promise<void> {
  const client = getCloudClient();
  const { error } = await client
    .from("user_profiles")
    .update({
      role: input.role,
      data_owner_user_id: input.dataOwnerUserId,
      permissions: input.permissions
    })
    .eq("id", input.id);
  if (error) throw error;
}

export async function createAppUser(input: {
  login: string;
  password: string;
  role: AppRole;
  dataOwnerUserId: string | null;
  permissions: AppPermissions;
}): Promise<UserProfileRow> {
  const client = getCloudClient();
  const { data, error } = await client.rpc("admin_create_app_user", {
    p_login: input.login,
    p_password: input.password,
    p_role: input.role,
    p_data_owner_user_id: input.dataOwnerUserId,
    p_permissions: input.permissions
  });
  if (error) throw error;
  return normalizeRow(data as RawUserProfileRow);
}

export async function resetAppUserPassword(userId: string, password: string): Promise<void> {
  const client = getCloudClient();
  const { error } = await client.rpc("admin_reset_app_user_password", {
    p_user_id: userId,
    p_password: password
  });
  if (error) throw error;
}

export async function markOwnPasswordChanged(): Promise<void> {
  const client = getCloudClient();
  const { error } = await client.rpc("mark_own_password_changed");
  if (error) throw error;
}

export function buildRolePermissions(role: AppRole): AppPermissions {
  return getRoleScreenPermissions(role);
}
