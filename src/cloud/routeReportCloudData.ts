import { getCloudClient, PAGE_SIZE } from "./cloudClient";
import type { ActiveRouteItem } from "./operationsCloudData";
import type { Payment } from "../types";

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
  confirmed_cash_amount: number;
  confirmed_bank_amount: number;
  confirmed_bank_received_amount: number;
  confirmed_bank_savings_amount: number;
  status: "review" | "confirmed";
  reported_by: string;
  reporter_name: string;
  reported_at: string;
  confirmed_payment_id: string | null;
  confirmed_at: string | null;
};

function normalizeRoutePaymentReport(row: Record<string, unknown>): RoutePaymentReport {
  return {
    ...row,
    amount: Number(row.amount),
    cash_amount: Number(row.cash_amount ?? (row.method === "cash" ? row.amount : 0)),
    bank_amount: Number(row.bank_amount ?? (row.method === "bank" ? row.amount : 0)),
    confirmed_cash_amount: Number(row.confirmed_cash_amount ?? 0),
    confirmed_bank_amount: Number(row.confirmed_bank_amount ?? 0),
    confirmed_bank_received_amount: Number(row.confirmed_bank_received_amount ?? 0),
    confirmed_bank_savings_amount: Number(row.confirmed_bank_savings_amount ?? 0)
  } as RoutePaymentReport;
}

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

export async function loadRoutePaymentReports(ownerId: string, pendingCashOnly = false): Promise<RoutePaymentReport[]> {
  const rows: RoutePaymentReport[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    let query = getCloudClient().from("route_payment_reports").select("*")
      .eq("user_id", ownerId).neq("status", "cancelled").order("reported_at", { ascending: false })
      .order("id").range(offset, offset + PAGE_SIZE - 1);
    if (pendingCashOnly) query = query.eq("status", "review").eq("method", "cash").eq("confirmed_cash_amount", 0);
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...(data ?? []).map((row) => normalizeRoutePaymentReport(row)));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
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
    .neq("status", "cancelled").maybeSingle();
  if (error) throw error;
  return data ? normalizeRoutePaymentReport(data) : null;
}

export async function loadNextPendingCashRouteReport(ownerId: string, excludedIds: string[]): Promise<RoutePaymentReport | null> {
  let query = getCloudClient().from("route_payment_reports").select("*")
    .eq("user_id", ownerId).eq("status", "review").eq("method", "cash")
    .eq("confirmed_cash_amount", 0).order("reported_at", { ascending: false }).order("id").limit(1);
  if (excludedIds.length > 0) query = query.not("id", "in", `(${excludedIds.join(",")})`);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data ? normalizeRoutePaymentReport(data) : null;
}

export async function reportRoutePayment(ownerId: string, item: ActiveRouteItem, cashAmount: number, bankAmount: number): Promise<void> {
  const { error } = await getCloudClient().rpc("report_route_payment_split", {
    p_user_id: ownerId, p_client_id: item.clientId, p_published_at: item.publishedAt,
    p_cash_amount: cashAmount, p_bank_amount: bankAmount
  });
  if (error) throw error;
}

export async function cancelRoutePaymentReport(reportId: string): Promise<void> {
  const { error } = await getCloudClient().rpc("cancel_route_payment_report", { p_report_id: reportId });
  if (error) throw error;
}

export async function changeRouteAssignment(ownerId: string, item: ActiveRouteItem, route: "WC" | "PTY"): Promise<void> {
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
