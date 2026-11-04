import { createEphemeralSupabaseClient } from "../lib/supabase";
import { getCloudClient } from "./cloudClient";
import type { BillingFrequency, Payment, WeeklyChargeDay } from "../types";
import type { PortalPaymentChannel } from "../receiptAmountDetection";
import {
  configureLocalClientPortalAccess,
  createLocalClientPortalTestAccount,
  createLocalEvidenceViewUrl,
  disableLocalClientPortalAccess,
  importLocalClientPortalTestSnapshot,
  isLocalClientPortalMode,
  loadLocalClientPortalAccessStatus,
  loadLocalClientPortalSnapshot,
  loginLocalClientPortal,
  logoutLocalClientPortal,
  submitLocalClientPortalPayment
} from "./localClientPortal";

export { isLocalClientPortalMode } from "./localClientPortal";

export type ClientPortalAccessStatus = {
  configured: boolean;
  active: boolean;
  pinChangedAt: string | null;
  updatedAt: string | null;
};

export type ClientPortalClient = {
  id: string;
  name: string;
  cedulaMasked: string;
  unitId: string;
  status: string;
  rentAmount: number;
  frequency: BillingFrequency;
  weeklyChargeDay?: WeeklyChargeDay;
  monthlyChargeDay?: number;
  chargeFirstSunday?: boolean;
  firstSundayChargedAt?: string;
  firstChargeDate?: string;
  lastChargeDate?: string;
  installmentsAgreed: number;
  installmentsIssued: number;
  installmentsRemaining: number;
  installmentsPaid: number;
  balance: number;
  advanceBalance: number;
  otherCharges: Array<{ id?: string; label: string; amount: number; createdAt?: string }>;
  fines: Array<{ id?: string; label: string; amount: number; amountPaid?: number; status?: string }>;
  tickets: Array<{ id?: string; ticketNumber?: string; amount: number; amountPaid?: number; status?: string }>;
  whatsAppPhone?: string;
};

export type ClientPortalPayment = {
  id: string;
  clientId: string;
  receiptNumber: string;
  dateApplied: string;
  paymentMethod: string;
  amountReceived: number;
  createdAt: string;
  receipt?: Payment;
};

export type ClientPortalNotice = {
  id: string;
  clientId: string;
  unitId: string;
  amount: number;
  status: "pending" | "confirmed" | "rejected";
  evidenceName: string;
  submittedAt: string;
  reviewedAt?: string | null;
  rejectionReason?: string | null;
  paymentChannel?: PortalPaymentChannel;
};

export type ClientPortalSnapshot = {
  client: ClientPortalClient;
  vehicle: {
    brandModel?: string | null;
    plate?: string | null;
    year?: number | null;
    color?: string | null;
    status?: string | null;
  };
  units: Array<{
    client: ClientPortalClient;
    vehicle: {
      brandModel?: string | null;
      plate?: string | null;
      year?: number | null;
      color?: string | null;
      status?: string | null;
    };
  }>;
  payments: ClientPortalPayment[];
  notices: ClientPortalNotice[];
  sessionExpiresAt: string;
};

export type ClientPortalLoginResult = { token: string; expiresAt: string };

function requirePortalClient() {
  const client = createEphemeralSupabaseClient();
  if (!client) throw new Error("El portal no está configurado. Comunícate con Rentautos.");
  return client;
}

async function portalError(error: unknown): Promise<Error> {
  const context = error && typeof error === "object" && "context" in error
    ? (error as { context?: Response }).context
    : null;
  if (context && typeof context.clone === "function") {
    try {
      const body = await context.clone().json() as { error?: unknown };
      if (typeof body.error === "string" && body.error.trim()) return new Error(body.error);
    } catch {
      // Fall through to the safe generic message.
    }
  }
  return new Error("No se pudo conectar con el portal. Revisa tu conexión e intenta nuevamente.");
}

async function invokePortal<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await requirePortalClient().functions.invoke("client-portal", { body });
  if (error) throw await portalError(error);
  return data as T;
}

export async function loginClientPortal(cedula: string, pin: string): Promise<ClientPortalLoginResult> {
  if (isLocalClientPortalMode()) return loginLocalClientPortal(cedula, pin);
  const data = await invokePortal<ClientPortalLoginResult>({ action: "login", cedula, pin });
  if (!data || typeof data.token !== "string" || typeof data.expiresAt !== "string") {
    throw new Error("No se pudo iniciar la sesión del portal.");
  }
  return data;
}

export async function createClientPortalTestAccount(input: {
  cedula: string;
  pin: string;
  name: string;
  unitId: string;
}): Promise<ClientPortalLoginResult> {
  if (!isLocalClientPortalMode()) throw new Error("Esta opción solo está disponible en la prueba local.");
  return createLocalClientPortalTestAccount(input);
}

export async function importClientPortalTestSnapshot(input: {
  client: import("../types").Client;
  payments: import("../types").Payment[];
}): Promise<void> {
  if (!isLocalClientPortalMode()) throw new Error("Esta opción solo está disponible en la prueba local.");
  await importLocalClientPortalTestSnapshot(input);
}

export async function loadClientPortalSnapshot(sessionToken: string): Promise<ClientPortalSnapshot> {
  if (isLocalClientPortalMode()) return loadLocalClientPortalSnapshot(sessionToken);
  return invokePortal<ClientPortalSnapshot>({ action: "snapshot", sessionToken });
}

export async function submitClientPortalPayment(input: {
  sessionToken: string;
  clientId: string;
  amount: number;
  paymentChannel: PortalPaymentChannel;
  evidenceName: string;
  evidenceDataUrl: string;
}): Promise<ClientPortalSnapshot> {
  if (isLocalClientPortalMode()) return submitLocalClientPortalPayment(input);
  return invokePortal<ClientPortalSnapshot>({ action: "submitPayment", ...input });
}

export async function logoutClientPortal(sessionToken: string): Promise<void> {
  if (isLocalClientPortalMode()) return logoutLocalClientPortal(sessionToken);
  await invokePortal<{ ok: true }>({ action: "logout", sessionToken });
}

function normalizeAccessStatus(value: unknown): ClientPortalAccessStatus {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    configured: raw.configured === true,
    active: raw.active === true,
    pinChangedAt: typeof raw.pinChangedAt === "string" ? raw.pinChangedAt : null,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null
  };
}

export async function loadClientPortalAccessStatus(ownerUserId: string, clientId: string, cedula?: string): Promise<ClientPortalAccessStatus> {
  if (isLocalClientPortalMode()) return loadLocalClientPortalAccessStatus(clientId, cedula);
  const { data, error } = await getCloudClient().rpc("client_portal_access_status", {
    p_owner_user_id: ownerUserId,
    p_client_id: clientId
  });
  if (error) throw error;
  return normalizeAccessStatus(data);
}

export async function configureClientPortalAccess(ownerUserId: string, clientId: string, pin: string, cedula?: string): Promise<ClientPortalAccessStatus> {
  if (isLocalClientPortalMode()) return configureLocalClientPortalAccess(clientId, pin, cedula);
  const { data, error } = await getCloudClient().rpc("configure_client_portal_access", {
    p_owner_user_id: ownerUserId,
    p_client_id: clientId,
    p_pin: pin
  });
  if (error) throw error;
  return normalizeAccessStatus(data);
}

export async function disableClientPortalAccess(ownerUserId: string, clientId: string, cedula?: string): Promise<void> {
  if (isLocalClientPortalMode()) return disableLocalClientPortalAccess(clientId, cedula);
  const { error } = await getCloudClient().rpc("disable_client_portal_access", {
    p_owner_user_id: ownerUserId,
    p_client_id: clientId
  });
  if (error) throw error;
}

export async function createClientPaymentEvidenceViewUrl(path: string): Promise<string> {
  if (isLocalClientPortalMode() && path.startsWith("client-portal-evidence:")) return createLocalEvidenceViewUrl(path);
  const { data, error } = await getCloudClient().storage
    .from("client-payment-evidence")
    .createSignedUrl(path, 60 * 10);
  if (error) throw error;
  if (!data.signedUrl) throw new Error("No se pudo abrir el comprobante.");
  return data.signedUrl;
}
