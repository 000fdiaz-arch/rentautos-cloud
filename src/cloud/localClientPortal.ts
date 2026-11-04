import { loadClients, loadClientsFromIndexedDb, loadPayments, loadPaymentsFromIndexedDb } from "../storage/coreStorage";
import { readIndexedDb, writeIndexedDb } from "../storage/indexedDbStorage";
import { loadNotifiedPayments, saveNotifiedPayments } from "../pages/payments/paymentStorage";
import type { Client, Payment } from "../types";
import type { PortalPaymentChannel } from "../receiptAmountDetection";
import type {
  ClientPortalAccessStatus,
  ClientPortalClient,
  ClientPortalLoginResult,
  ClientPortalNotice,
  ClientPortalSnapshot
} from "./clientPortalCloudData";

const ACCESS_KEY = "rentautos.client-portal.local-access.v1";
const SESSIONS_KEY = "rentautos.client-portal.local-sessions.v1";
const NOTICES_KEY = "rentautos.client-portal.local-notices.v1";
const TEST_CLIENTS_KEY = "rentautos.client-portal.local-test-clients.v1";
const TEST_PAYMENTS_KEY = "rentautos.client-portal.local-test-payments.v1";
const CLOUD_CLIENTS_CACHE_KEY = "rentautos.client-portal.cloud-clients-cache.v1";
const CLOUD_PAYMENTS_CACHE_KEY = "rentautos.client-portal.cloud-payments-cache.v1";
const EVIDENCE_PREFIX = "client-portal-evidence:";
const SESSION_DURATION_MS = 12 * 60 * 60 * 1000;
const LOCAL_TEST_PIN = "123456";

type LocalAccess = {
  cedula: string;
  salt: string;
  pinHash: string;
  active: boolean;
  pinChangedAt: string;
  updatedAt: string;
  temporary?: boolean;
};

type LocalSession = {
  token: string;
  cedula: string;
  expiresAt: string;
};

type StoredNotice = ClientPortalNotice & { evidencePath: string };

export function isLocalClientPortalMode(): boolean {
  return typeof window !== "undefined" && (window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost");
}

function normalizeCedula(value: string): string {
  return value.replace(/\D/g, "");
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

function randomHex(byteLength = 24): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

async function pinHash(pin: string, salt: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${salt}:${pin}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

async function allClients(): Promise<Client[]> {
  const local = loadClients();
  const indexed = await loadClientsFromIndexedDb().catch(() => []);
  const merged = new Map<string, Client>();
  const testClients = readJson<Client[]>(TEST_CLIENTS_KEY, []);
  const cloudCacheValue = await readIndexedDb(CLOUD_CLIENTS_CACHE_KEY).catch(() => []);
  const cloudCache = Array.isArray(cloudCacheValue) ? cloudCacheValue as Client[] : [];
  for (const client of [...local, ...indexed, ...cloudCache, ...testClients]) {
    if (client && typeof client.id === "string") merged.set(client.id, client);
  }
  return Array.from(merged.values());
}

async function allPayments(): Promise<Payment[]> {
  const local = loadPayments();
  const indexed = await loadPaymentsFromIndexedDb().catch(() => []);
  const testPayments = readJson<Payment[]>(TEST_PAYMENTS_KEY, []);
  const cloudCacheValue = await readIndexedDb(CLOUD_PAYMENTS_CACHE_KEY).catch(() => []);
  const cloudCache = Array.isArray(cloudCacheValue) ? cloudCacheValue as Payment[] : [];
  const merged = new Map<string, Payment>();
  for (const payment of [...local, ...indexed, ...cloudCache, ...testPayments]) {
    if (payment && typeof payment.id === "string") merged.set(payment.id, payment);
  }
  return Array.from(merged.values());
}

export async function cacheLocalClientPortalCloudData(clients: Client[], payments: Payment[]): Promise<void> {
  if (!isLocalClientPortalMode()) return;
  await Promise.all([
    writeIndexedDb(CLOUD_CLIENTS_CACHE_KEY, clients),
    writeIndexedDb(CLOUD_PAYMENTS_CACHE_KEY, payments)
  ]);
}

function readAccess(): Record<string, LocalAccess> {
  return readJson<Record<string, LocalAccess>>(ACCESS_KEY, {});
}

function readSessions(): Record<string, LocalSession> {
  try {
    const raw = sessionStorage.getItem(SESSIONS_KEY);
    return raw ? JSON.parse(raw) as Record<string, LocalSession> : {};
  } catch {
    return {};
  }
}

function writeSessions(sessions: Record<string, LocalSession>): void {
  sessionStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
}

function readNotices(): StoredNotice[] {
  return readJson<StoredNotice[]>(NOTICES_KEY, []).filter((notice) => notice && typeof notice.id === "string");
}

async function cedulaForClient(clientId: string, cedulaHint?: string): Promise<string> {
  const hinted = normalizeCedula(cedulaHint ?? "");
  if (hinted) return hinted;
  const client = (await allClients()).find((item) => item.id === clientId);
  return normalizeCedula(client?.cedula ?? "");
}

function accessStatus(access?: LocalAccess): ClientPortalAccessStatus {
  return {
    configured: Boolean(access),
    active: access?.active === true,
    pinChangedAt: access?.pinChangedAt ?? null,
    updatedAt: access?.updatedAt ?? null
  };
}

export async function loadLocalClientPortalAccessStatus(clientId: string, cedulaHint?: string): Promise<ClientPortalAccessStatus> {
  const cedula = await cedulaForClient(clientId, cedulaHint);
  return accessStatus(cedula ? readAccess()[cedula] : undefined);
}

export async function configureLocalClientPortalAccess(clientId: string, pin: string, cedulaHint?: string): Promise<ClientPortalAccessStatus> {
  const cedula = await cedulaForClient(clientId, cedulaHint);
  if (!cedula) throw new Error("Guarda una cédula válida antes de habilitar el portal.");
  const salt = randomHex(16);
  const now = new Date().toISOString();
  const next: LocalAccess = {
    cedula,
    salt,
    pinHash: await pinHash(pin, salt),
    active: true,
    pinChangedAt: now,
    updatedAt: now
  };
  writeJson(ACCESS_KEY, { ...readAccess(), [cedula]: next });
  return accessStatus(next);
}

export async function disableLocalClientPortalAccess(clientId: string, cedulaHint?: string): Promise<void> {
  const cedula = await cedulaForClient(clientId, cedulaHint);
  const current = readAccess();
  if (!cedula || !current[cedula]) return;
  current[cedula] = { ...current[cedula], active: false, updatedAt: new Date().toISOString() };
  writeJson(ACCESS_KEY, current);
}

async function ensureAccessForLogin(cedula: string, pin: string): Promise<LocalAccess> {
  const records = readAccess();
  let access = records[cedula];
  if (!access) {
    if (pin !== LOCAL_TEST_PIN) {
      throw new Error("Este cliente aún no tiene un PIN local. Configúralo en Clientes > Editar > Portal.");
    }
    const salt = randomHex(16);
    const now = new Date().toISOString();
    access = {
      cedula,
      salt,
      pinHash: await pinHash(pin, salt),
      active: true,
      pinChangedAt: now,
      updatedAt: now,
      temporary: true
    };
    writeJson(ACCESS_KEY, { ...records, [cedula]: access });
  }
  if (!access.active) throw new Error("El acceso al portal está desactivado. Comunícate con Rentautos.");
  if (await pinHash(pin, access.salt) !== access.pinHash) throw new Error("La cédula o el PIN no son correctos.");
  return access;
}

export async function loginLocalClientPortal(cedulaInput: string, pin: string): Promise<ClientPortalLoginResult> {
  const cedula = normalizeCedula(cedulaInput);
  const clients = (await allClients()).filter((client) => normalizeCedula(client.cedula ?? "") === cedula);
  if (!cedula || clients.length === 0) throw new Error("No encontramos un cliente con esa cédula en los datos locales.");
  await ensureAccessForLogin(cedula, pin);
  const token = `local_${randomHex()}`;
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();
  writeSessions({ ...readSessions(), [token]: { token, cedula, expiresAt } });
  return { token, expiresAt };
}

export async function createLocalClientPortalTestAccount(input: {
  cedula: string;
  pin: string;
  name: string;
  unitId: string;
}): Promise<ClientPortalLoginResult> {
  const cedula = input.cedula.trim();
  const normalizedCedula = normalizeCedula(cedula);
  const name = input.name.trim();
  const unitId = input.unitId.trim().toUpperCase();
  if (!normalizedCedula || !name || !unitId) throw new Error("Completa la cédula, el nombre y la unidad.");
  if (!/^\d{6}$/.test(input.pin)) throw new Error("El PIN debe tener exactamente 6 dígitos.");
  const id = `local-test-${normalizedCedula}-${unitId.toLowerCase()}`;
  const client: Client = {
    id,
    unitId,
    name,
    cedula,
    rentAmount: 0,
    frequency: "daily",
    installmentsAgreed: 0,
    installmentsIssued: 0,
    installmentsRemaining: 0,
    installmentsPaid: 0,
    otherCharges: [],
    balance: 0,
    advanceBalance: 0,
    savings: 0,
    createdAt: new Date().toISOString(),
    status: "activo"
  };
  const current = readJson<Client[]>(TEST_CLIENTS_KEY, []);
  writeJson(TEST_CLIENTS_KEY, [client, ...current.filter((item) => item.id !== id)]);
  await configureLocalClientPortalAccess(id, input.pin, cedula);
  return loginLocalClientPortal(cedula, input.pin);
}

export async function importLocalClientPortalTestSnapshot(input: {
  client: Client;
  payments: Payment[];
}): Promise<void> {
  if (!input?.client || typeof input.client.id !== "string" || typeof input.client.cedula !== "string") {
    throw new Error("La copia local del cliente no es válida.");
  }
  if (!Array.isArray(input.payments)) throw new Error("El historial local no es válido.");
  const cedula = normalizeCedula(input.client.cedula);
  const unitId = input.client.unitId.trim().toUpperCase();
  const currentClients = readJson<Client[]>(TEST_CLIENTS_KEY, []);
  writeJson(TEST_CLIENTS_KEY, [
    input.client,
    ...currentClients.filter((item) => !(normalizeCedula(item.cedula ?? "") === cedula && item.unitId.trim().toUpperCase() === unitId))
  ]);
  const currentPayments = readJson<Payment[]>(TEST_PAYMENTS_KEY, []);
  const importedIds = new Set(input.payments.map((payment) => payment.id));
  writeJson(TEST_PAYMENTS_KEY, [
    ...input.payments,
    ...currentPayments.filter((payment) => !importedIds.has(payment.id) && payment.clientId !== input.client.id)
  ]);
}

function requireSession(token: string): LocalSession {
  const sessions = readSessions();
  const session = sessions[token];
  if (!session || Date.parse(session.expiresAt) <= Date.now()) {
    if (session) {
      delete sessions[token];
      writeSessions(sessions);
    }
    throw new Error("Tu sesión venció. Ingresa nuevamente.");
  }
  return session;
}

function portalClient(client: Client): ClientPortalClient {
  return {
    id: client.id,
    name: client.name,
    cedulaMasked: client.cedula ?? "—",
    unitId: client.unitId,
    status: client.status,
    rentAmount: client.rentAmount,
    frequency: client.frequency,
    weeklyChargeDay: client.weeklyChargeDay,
    monthlyChargeDay: client.monthlyChargeDay,
    chargeFirstSunday: client.chargeFirstSunday,
    firstSundayChargedAt: client.firstSundayChargedAt,
    firstChargeDate: client.firstChargeDate,
    lastChargeDate: client.lastChargeDate,
    installmentsAgreed: client.installmentsAgreed,
    installmentsIssued: client.installmentsIssued ?? 0,
    installmentsRemaining: client.installmentsRemaining,
    installmentsPaid: client.installmentsPaid,
    balance: client.balance,
    advanceBalance: client.advanceBalance,
    otherCharges: client.otherCharges ?? [],
    fines: (client.fines ?? []).map((fine) => ({
      id: fine.id,
      label: fine.label,
      amount: fine.amount,
      amountPaid: fine.amountPaid,
      status: fine.status
    })),
    tickets: (client.tickets ?? []).map((ticket) => ({
      id: ticket.id,
      ticketNumber: ticket.ticketNumber,
      amount: ticket.amount,
      amountPaid: ticket.amountPaid,
      status: ticket.status
    })),
    whatsAppPhone: client.whatsAppPhone
  };
}

export async function loadLocalClientPortalSnapshot(token: string): Promise<ClientPortalSnapshot> {
  const session = requireSession(token);
  const clients = (await allClients())
    .filter((client) => normalizeCedula(client.cedula ?? "") === session.cedula)
    .sort((left, right) => Number(left.status === "archivado") - Number(right.status === "archivado") || left.unitId.localeCompare(right.unitId, undefined, { numeric: true }));
  if (clients.length === 0) throw new Error("La cuenta ya no está disponible.");
  const clientIds = new Set(clients.map((client) => client.id));
  const payments = (await allPayments())
    .filter((payment) => clientIds.has(payment.clientId))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .map((payment) => ({
      id: payment.id,
      clientId: payment.clientId,
      receiptNumber: payment.receiptNumber,
      dateApplied: payment.dateApplied,
      paymentMethod: payment.paymentMethod,
      amountReceived: payment.amountReceived,
      createdAt: payment.createdAt,
      receipt: payment
    }));
  const notices = readNotices()
    .filter((notice) => clientIds.has(notice.clientId))
    .sort((left, right) => right.submittedAt.localeCompare(left.submittedAt))
    .map(({ evidencePath: _evidencePath, ...notice }) => notice);
  const units = clients.map((client) => ({
    client: portalClient(client),
    vehicle: { brandModel: null, plate: null, year: null, color: null, status: null }
  }));
  return {
    client: units[0].client,
    vehicle: units[0].vehicle,
    units,
    payments,
    notices,
    sessionExpiresAt: session.expiresAt
  };
}

export async function submitLocalClientPortalPayment(input: {
  sessionToken: string;
  clientId: string;
  amount: number;
  paymentChannel: PortalPaymentChannel;
  evidenceName: string;
  evidenceDataUrl: string;
}): Promise<ClientPortalSnapshot> {
  const session = requireSession(input.sessionToken);
  const client = (await allClients()).find((item) => item.id === input.clientId && normalizeCedula(item.cedula ?? "") === session.cedula);
  if (!client) throw new Error("La unidad seleccionada no pertenece a esta cuenta.");
  const id = crypto.randomUUID();
  const submittedAt = new Date().toISOString();
  const evidencePath = `${EVIDENCE_PREFIX}${id}`;
  await writeIndexedDb(evidencePath, input.evidenceDataUrl);
  const notice: StoredNotice = {
    id,
    clientId: client.id,
    unitId: client.unitId,
    amount: input.amount,
    paymentChannel: input.paymentChannel,
    status: "pending",
    evidenceName: input.evidenceName,
    evidencePath,
    submittedAt
  };
  writeJson(NOTICES_KEY, [notice, ...readNotices()]);
  saveNotifiedPayments([
    {
      id: `portal-${id}`,
      clientId: client.id,
      amount: input.amount,
      createdAt: submittedAt,
      source: "client-portal",
      portalPaymentChannel: input.paymentChannel,
      clientPaymentNoticeId: id,
      evidencePath,
      evidenceName: input.evidenceName
    },
    ...loadNotifiedPayments()
  ]);
  return loadLocalClientPortalSnapshot(input.sessionToken);
}

export async function logoutLocalClientPortal(token: string): Promise<void> {
  const sessions = readSessions();
  delete sessions[token];
  writeSessions(sessions);
}

export async function createLocalEvidenceViewUrl(path: string): Promise<string> {
  if (!path.startsWith(EVIDENCE_PREFIX)) throw new Error("No se pudo abrir el comprobante local.");
  const value = await readIndexedDb(path);
  if (typeof value !== "string" || !value.startsWith("data:")) throw new Error("No se encontró el comprobante local.");
  return value;
}
