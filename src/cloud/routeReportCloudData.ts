import { dedupeLoad, getCloudClient, PAGE_SIZE } from "./cloudClient";
import type { ActiveRouteItem } from "./operationsCloudData";
import type { Payment } from "../types";

export type RouteManagementOutcome = "collected" | "remote";

const LOCAL_MANAGEMENT_OUTCOMES_KEY = "cobrapp.route.management-outcomes.v1";

function localManagementOutcomeKey(ownerId: string, clientId: string, publishedAt: string): string {
  return `${ownerId}:${clientId}:${publishedAt}`;
}

function readLocalManagementOutcome(ownerId: string, clientId: string, publishedAt: string): RouteManagementOutcome | undefined {
  if (!import.meta.env.DEV || typeof window === "undefined") return undefined;
  try {
    const stored = JSON.parse(window.localStorage.getItem(LOCAL_MANAGEMENT_OUTCOMES_KEY) ?? "{}") as Record<string, unknown>;
    const outcome = stored[localManagementOutcomeKey(ownerId, clientId, publishedAt)];
    return outcome === "remote" || outcome === "collected" ? outcome : undefined;
  } catch {
    return undefined;
  }
}

function saveLocalManagementOutcome(ownerId: string, clientId: string, publishedAt: string, outcome: RouteManagementOutcome): void {
  if (!import.meta.env.DEV || typeof window === "undefined") return;
  let stored: Record<string, unknown> = {};
  try {
    stored = JSON.parse(window.localStorage.getItem(LOCAL_MANAGEMENT_OUTCOMES_KEY) ?? "{}") as Record<string, unknown>;
  } catch {
    stored = {};
  }
  stored[localManagementOutcomeKey(ownerId, clientId, publishedAt)] = outcome;
  window.localStorage.setItem(LOCAL_MANAGEMENT_OUTCOMES_KEY, JSON.stringify(stored));
}

export type RoutePaymentReport = {
  id: string;
  user_id: string;
  client_id: string;
  published_at: string;
  snapshot: ActiveRouteItem;
  amount: number;
  method: "cash" | "bank" | "mixed";
  cash_amount: number;
  bank_amount: number;
  management_outcome?: RouteManagementOutcome;
  confirmed_cash_amount: number;
  confirmed_bank_amount: number;
  confirmed_bank_received_amount: number;
  confirmed_bank_savings_amount: number;
  bank_confirmed_visually_at: string | null;
  bank_confirmed_visually_by: string | null;
  bank_settled_payment_id: string | null;
  bank_settled_at: string | null;
  status: "review" | "confirmed";
  reported_by: string;
  reporter_name: string;
  reported_at: string;
  confirmed_payment_id: string | null;
  confirmed_at: string | null;
  managed_hidden_at: string | null;
  managed_hidden_by: string | null;
};

function normalizeRoutePaymentReport(row: Record<string, unknown>): RoutePaymentReport {
  const localOutcome = readLocalManagementOutcome(
    typeof row.user_id === "string" ? row.user_id : "",
    typeof row.client_id === "string" ? row.client_id : "",
    typeof row.published_at === "string" ? row.published_at : ""
  );
  return {
    ...row,
    amount: Number(row.amount),
    cash_amount: Number(row.cash_amount ?? (row.method === "cash" ? row.amount : 0)),
    bank_amount: Number(row.bank_amount ?? (row.method === "bank" ? row.amount : 0)),
    management_outcome: localOutcome ?? (row.management_outcome === "remote" ? "remote" : row.management_outcome === "collected" ? "collected" : undefined),
    confirmed_cash_amount: Number(row.confirmed_cash_amount ?? 0),
    confirmed_bank_amount: Number(row.confirmed_bank_amount ?? 0),
    confirmed_bank_received_amount: Number(row.confirmed_bank_received_amount ?? 0),
    confirmed_bank_savings_amount: Number(row.confirmed_bank_savings_amount ?? 0),
    bank_confirmed_visually_at: typeof row.bank_confirmed_visually_at === "string" ? row.bank_confirmed_visually_at : null,
    bank_confirmed_visually_by: typeof row.bank_confirmed_visually_by === "string" ? row.bank_confirmed_visually_by : null,
    bank_settled_payment_id: typeof row.bank_settled_payment_id === "string" ? row.bank_settled_payment_id : null,
    bank_settled_at: typeof row.bank_settled_at === "string" ? row.bank_settled_at : null,
    managed_hidden_at: typeof row.managed_hidden_at === "string" ? row.managed_hidden_at : null,
    managed_hidden_by: typeof row.managed_hidden_by === "string" ? row.managed_hidden_by : null
  } as RoutePaymentReport;
}

export type RouteBankConfirmationResult = {
  outcome: "decision" | "removed";
  confirmedAmount: number;
  releaseAmount: number;
};

export type RouteReportDelta = { id: string; report: RoutePaymentReport | null };

export function routeReportDeltaFromPayload(payload: unknown): RouteReportDelta | null {
  if (!payload || typeof payload !== "object") return null;
  const event = payload as { eventType?: unknown; new?: unknown; old?: unknown };
  const row = (event.eventType === "DELETE" ? event.old : event.new) as Record<string, unknown> | null;
  const id = typeof row?.id === "string" ? row.id : "";
  if (!id) return null;
  if (event.eventType === "DELETE" || row?.status === "cancelled") return { id, report: null };
  if (event.eventType !== "INSERT" && event.eventType !== "UPDATE") return null;
  if (!row || typeof row.snapshot !== "object" || !row.snapshot) return null;
  return { id, report: normalizeRoutePaymentReport(row) };
}

export function applyRouteReportDelta(reports: RoutePaymentReport[], delta: RouteReportDelta): RoutePaymentReport[] {
  const next = reports.filter((report) => report.id !== delta.id);
  if (!delta.report) return next;
  next.push(delta.report);
  return next.sort((left, right) => right.reported_at.localeCompare(left.reported_at) || left.id.localeCompare(right.id));
}

export type RoutePaymentReportLoadOptions = {
  pendingCashOnly?: boolean;
  reviewOnly?: boolean;
  reviewRelevantOnly?: boolean;
};

export type RoutePaymentReportPage = {
  reports: RoutePaymentReport[];
  hasMore: boolean;
};

export async function loadRoutePaymentReports(
  ownerId: string,
  options: boolean | RoutePaymentReportLoadOptions = false
): Promise<RoutePaymentReport[]> {
  const pendingCashOnly = typeof options === "boolean" ? options : options.pendingCashOnly === true;
  const reviewOnly = typeof options === "boolean" ? false : options.reviewOnly === true;
  const reviewRelevantOnly = typeof options === "boolean" ? false : options.reviewRelevantOnly === true;
  return dedupeLoad(
    `route-payment-reports:${ownerId}:${pendingCashOnly ? "pending-cash" : reviewOnly ? "review" : reviewRelevantOnly ? "review-relevant" : "all"}`,
    () => loadRoutePaymentReportsUncached(ownerId, { pendingCashOnly, reviewOnly, reviewRelevantOnly })
  );
}

async function loadRoutePaymentReportsUncached(ownerId: string, options: RoutePaymentReportLoadOptions): Promise<RoutePaymentReport[]> {
  const rows: RoutePaymentReport[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    let query = getCloudClient().from("route_payment_reports").select("*")
      .eq("user_id", ownerId).neq("status", "cancelled").order("reported_at", { ascending: false })
      .order("id").range(offset, offset + PAGE_SIZE - 1);
    if (options.reviewRelevantOnly) query = query.or("status.eq.review,bank_confirmed_visually_at.not.is.null");
    else if (options.reviewOnly || options.pendingCashOnly) query = query.eq("status", "review");
    if (options.pendingCashOnly) query = query.gt("cash_amount", 0).eq("confirmed_cash_amount", 0);
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...(data ?? []).map((row) => normalizeRoutePaymentReport(row)));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}

export async function loadRoutePaymentReportsPage(
  ownerId: string,
  offset = 0,
  limit = 200
): Promise<RoutePaymentReportPage> {
  const safeOffset = Math.max(0, Math.floor(offset));
  const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
  return dedupeLoad(`route-payment-reports-page:${ownerId}:${safeOffset}:${safeLimit}`, async () => {
    const { data, error } = await getCloudClient().from("route_payment_reports").select("*")
      .eq("user_id", ownerId).neq("status", "cancelled")
      .order("reported_at", { ascending: false }).order("id")
      .range(safeOffset, safeOffset + safeLimit);
    if (error) throw error;
    const rows = (data ?? []).map((row) => normalizeRoutePaymentReport(row));
    return { reports: rows.slice(0, safeLimit), hasMore: rows.length > safeLimit };
  });
}

export async function loadRoutePaymentReport(ownerId: string, reportId: string): Promise<RoutePaymentReport | null> {
  const { data, error } = await getCloudClient().from("route_payment_reports").select("*")
    .eq("user_id", ownerId).eq("id", reportId).neq("status", "cancelled").maybeSingle();
  if (error) throw error;
  return data ? normalizeRoutePaymentReport(data) : null;
}

export async function loadRoutePaymentReportForItem(ownerId: string, clientId: string, publishedAt: string): Promise<RoutePaymentReport | null> {
  const { data, error } = await getCloudClient().from("route_payment_reports").select("*")
    .eq("user_id", ownerId).eq("client_id", clientId).eq("published_at", publishedAt)
    .neq("status", "cancelled").order("reported_at", { ascending: false }).order("id").limit(1).maybeSingle();
  if (error) throw error;
  return data ? normalizeRoutePaymentReport(data) : null;
}

export async function loadNextPendingCashRouteReport(ownerId: string, excludedIds: string[]): Promise<RoutePaymentReport | null> {
  let query = getCloudClient().from("route_payment_reports").select("*")
    .eq("user_id", ownerId).eq("status", "review").gt("cash_amount", 0)
    .eq("confirmed_cash_amount", 0).order("reported_at", { ascending: false }).order("id").limit(1);
  if (excludedIds.length > 0) query = query.not("id", "in", `(${excludedIds.join(",")})`);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data ? normalizeRoutePaymentReport(data) : null;
}

export async function reportRoutePayment(
  ownerId: string,
  item: ActiveRouteItem,
  cashAmount: number,
  bankAmount: number,
  managementOutcome: RouteManagementOutcome
): Promise<void> {
  const client = getCloudClient();
  const { error } = await client.rpc("report_route_payment_split", {
    p_user_id: ownerId, p_client_id: item.clientId, p_published_at: item.publishedAt,
    p_cash_amount: cashAmount, p_bank_amount: bankAmount, p_management_outcome: managementOutcome
  });
  if (!error) return;

  const missingOverload = import.meta.env.DEV
    && (error.code === "PGRST202" || /report_route_payment_split/i.test(error.message ?? "") && /schema cache|function/i.test(error.message ?? ""));
  if (!missingOverload) throw error;

  const legacy = await client.rpc("report_route_payment_split", {
    p_user_id: ownerId, p_client_id: item.clientId, p_published_at: item.publishedAt,
    p_cash_amount: cashAmount, p_bank_amount: bankAmount
  });
  if (legacy.error) throw legacy.error;
  saveLocalManagementOutcome(ownerId, item.clientId, item.publishedAt, managementOutcome);
}

export async function cancelRoutePaymentReport(reportId: string): Promise<void> {
  const { error } = await getCloudClient().rpc("cancel_route_payment_report", { p_report_id: reportId });
  if (error) throw error;
}

export async function hideRouteManagedReport(reportId: string): Promise<void> {
  const { error } = await getCloudClient().rpc("hide_route_managed_report", { p_report_id: reportId });
  if (error) throw error;
}

export async function setRouteReportManagementOutcome(
  reportId: string,
  managementOutcome: RouteManagementOutcome
): Promise<void> {
  const { error } = await getCloudClient().rpc("set_route_report_management_outcome", {
    p_report_id: reportId,
    p_management_outcome: managementOutcome
  });
  if (error) throw error;
}

export async function confirmRouteBankReport(reportId: string): Promise<RouteBankConfirmationResult> {
  const { data, error } = await getCloudClient().rpc("confirm_route_bank_report", { p_report_id: reportId });
  if (error) throw error;
  const row = data && typeof data === "object" ? data as Record<string, unknown> : {};
  return {
    outcome: row.outcome === "removed" ? "removed" : "decision",
    confirmedAmount: Number(row.confirmedAmount ?? 0),
    releaseAmount: Number(row.releaseAmount ?? 0)
  };
}

export async function changeRouteAssignment(ownerId: string, item: ActiveRouteItem, route: string): Promise<void> {
  const { error } = await getCloudClient().rpc("change_active_route_assignment", {
    p_user_id: ownerId, p_client_id: item.clientId, p_published_at: item.publishedAt,
    p_previous_route: item.routeAssignment, p_route: route
  });
  if (error) throw error;
}

export async function setRouteInactiveStatus(ownerId: string, item: ActiveRouteItem, inactive: boolean): Promise<string | null> {
  const { data, error } = await getCloudClient().rpc("set_active_route_inactive_status", {
    p_user_id: ownerId,
    p_client_id: item.clientId,
    p_published_at: item.publishedAt,
    p_inactive: inactive
  });
  if (error) throw error;
  return typeof data === "string" ? data : null;
}

export async function setRouteCustody(ownerId: string, item: ActiveRouteItem, inCustody: boolean): Promise<void> {
  const { error } = await getCloudClient().rpc("set_active_route_custody", {
    p_user_id: ownerId, p_client_id: item.clientId, p_published_at: item.publishedAt,
    p_in_custody: inCustody, p_expected_in_custody: item.inCustody === true
  });
  if (error) throw error;
}

export async function loadRouteReportReceipts(ownerId: string, report: RoutePaymentReport): Promise<Payment[]> {
  const { data, error } = await getCloudClient().rpc("read_route_report_receipts", { p_user_id: ownerId, p_report_id: report.id });
  if (error) throw error;
  return (data ?? []) as Payment[];
}
