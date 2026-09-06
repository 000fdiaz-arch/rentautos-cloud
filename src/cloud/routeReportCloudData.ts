import { getCloudClient, PAGE_SIZE } from "./cloudClient";
import type { ActiveRouteItem } from "./operationsCloudData";

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
  status: "review" | "confirmed";
  reported_by: string;
  reporter_name: string;
  reported_at: string;
  confirmed_payment_id: string | null;
  confirmed_at: string | null;
};

export async function loadRoutePaymentReports(ownerId: string): Promise<RoutePaymentReport[]> {
  const rows: RoutePaymentReport[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await getCloudClient().from("route_payment_reports").select("*")
      .eq("user_id", ownerId).neq("status", "cancelled").order("reported_at", { ascending: false })
      .order("id").range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...(data ?? []).map((row) => ({ ...row, amount: Number(row.amount),
      cash_amount: Number(row.cash_amount ?? (row.method === "cash" ? row.amount : 0)),
      bank_amount: Number(row.bank_amount ?? (row.method === "bank" ? row.amount : 0)),
      confirmed_cash_amount: Number(row.confirmed_cash_amount ?? 0),
      confirmed_bank_amount: Number(row.confirmed_bank_amount ?? 0)
    }) as RoutePaymentReport));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
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
