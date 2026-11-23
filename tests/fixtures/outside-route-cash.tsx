import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import type { Client, Payment } from "../../src/types";
import type { RoutePaymentInput } from "../../src/pages/OutsideRouteCashDialog";
import { buildManualPaymentTransaction } from "../../src/pages/payments/manualPaymentWorkflow";
import { getBusinessDateKey } from "../../src/billing";
import "../../src/styles.css";

const params = new URLSearchParams(location.search);
const version: "legacy" | "v2" = "legacy" as "legacy" | "v2";
const now = new Date().toISOString();
const clients = [
  { id: "outside", unitId: "X01", name: "Carlos Mendoza", status: "activo" },
  { id: "outside2", unitId: "X02", name: "María Castillo", status: "activo" },
  { id: "active", unitId: "A10", name: "Pedro González", status: "activo" },
  { id: "peer", unitId: "B20", name: "Ana López", status: "activo" },
  { id: "inactive", unitId: "Z99", name: "Cliente archivado", status: "archivado" }
].map(row => ({ ...row, balance: 120, advanceBalance: 0, savings: 0, otherCharges: [], rentAmount: 30,
  frequency: "daily", installmentsAgreed: 100, installmentsPaid: 4, installmentsRemaining: 96,
  createdAt: "2026-11-01T12:00:00Z" } as Client));
const routeRows = clients.filter(row => ["active", "peer"].includes(row.id)).map(row => ({ client_id: row.id,
  data: { clientId: row.id, unitId: row.unitId, clientName: row.name, routeAssignment: "PTY",
    zone: "Centro", managementType: "cobrar_o_quitar", comment: row.id === "active" ? "Llamar antes de llegar" : undefined,
    assignedDelta: row.id === "peer" ? "delta3" : "delta1", releaseAmount: 60, publishedAt: now,
    routeStartedAt: now, rentAmount: 30, overdueBalance: 120, daysLate: 4 } }));
if (params.has("zones")) {
  for (const [id, unit, route, zone] of [["zoneextra","A11","WC"," centro "], ["zoneother","A12","PTY","Chorrillo"], ["zoneempty","A13","PTY",undefined]]) {
    clients.push({ ...clients[0], id: id!, unitId: unit!, name: "Cliente " + unit });
    routeRows.push({ client_id: id!, data: { ...routeRows[0].data, clientId: id!, unitId: unit!, clientName: "Cliente " + unit,
      routeAssignment: route!, zone: zone!, comment: undefined } });
  }
}
(window as any).__outsideRouteRows = routeRows;
(window as any).__vehicleRequests = [];
(window as any).__vehicleDetails = { plate: "AB1234", color: "Blanco", brandModel: "Toyota Yaris" };
const declarationReports: any[] = [];
(window as any).__declarationReports = declarationReports;
(window as any).__declarationRequests = [];
(window as any).__managementEdits = [];
// This fixture is a local preview: every external request is handled here.
// It never reads or writes the configured Supabase project's data.
const nativeFetch = window.fetch.bind(window);
// Realtime is offline too; the preview cannot subscribe to production changes.
window.WebSocket = class extends EventTarget {
  static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
  readyState = 0;
  send() {}
  close() { this.readyState = 3; }
} as unknown as typeof WebSocket;
window.fetch = async (input, init) => {
  const request = input instanceof Request ? input : new Request(new URL(String(input), location.href), init);
  const url = new URL(request.url);
  if (url.origin === location.origin) return nativeFetch(input, init);
  if (url.pathname.endsWith("update_route_management_type")) {
    const body = JSON.parse(await request.text());
    const row = routeRows.find(row => row.client_id === body.p_client_id);
    if ((window as any).__failManagement || params.has("operator") || !row || row.data.publishedAt !== body.p_published_at || row.data.managementType !== body.p_previous_type)
      return new Response(JSON.stringify({ message: "La acción cambió en otro dispositivo. Actualiza antes de editar." }), { status: 400, headers: { "content-type": "application/json" } });
    row.data.managementType = body.p_management_type;
    (window as any).__managementEdits.push(body);
    return new Response("null", { headers: { "content-type": "application/json" } });
  }
  if (url.pathname.endsWith("read_route_vehicle_details")) {
    const body = JSON.parse(await request.text());
    (window as any).__vehicleRequests.push(body);
    if ((window as any).__failVehicle) return new Response(JSON.stringify({ message: "Sin conexión" }), { status: 500, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify((window as any).__vehicleDetails), { headers: { "content-type": "application/json" } });
  }
  if (url.pathname.endsWith("change_active_route_assignment") || url.pathname.endsWith("update_active_route_zone")) {
    const body = JSON.parse(await request.text());
    const row = routeRows.find(row => row.client_id === body.p_client_id);
    if (row) {
      if (url.pathname.endsWith("change_active_route_assignment")) row.data.routeAssignment = body.p_route;
      else row.data.zone = body.p_zone;
    }
    return new Response("null", { headers: { "content-type": "application/json" } });
  }
  if (url.pathname.endsWith("report_route_payment_split")) {
    const body = JSON.parse(await request.text());
    (window as any).__declarationRequests.push(body);
    if ((window as any).__failDeclaration) return new Response(JSON.stringify({ message: "No se pudo declarar el pago." }), { status: 400, headers: { "content-type": "application/json" } });
    const row = routeRows.find(row => row.client_id === body.p_client_id);
    if (!row || (row.data as any).removedAt || row.data.publishedAt !== body.p_published_at) return new Response(JSON.stringify({ message: "La unidad ya no está en ruta." }), { status: 400, headers: { "content-type": "application/json" } });
    declarationReports.push({ id: "declaration-" + declarationReports.length, user_id: body.p_user_id, client_id: body.p_client_id,
      published_at: body.p_published_at, snapshot: row.data, status: "review", method: body.p_cash_amount && body.p_bank_amount ? "mixed" : body.p_cash_amount ? "cash" : "bank",
      amount: body.p_cash_amount + body.p_bank_amount, cash_amount: body.p_cash_amount, bank_amount: body.p_bank_amount,
      confirmed_cash_amount: 0, confirmed_bank_amount: 0, management_outcome: body.p_management_outcome,
      reported_by: params.get("operator") ?? "admin-local", reporter_name: (params.get("operator") ?? "delta1") + "@auth.rentautos.local", reported_at: new Date().toISOString() });
    return new Response("null", { headers: { "content-type": "application/json" } });
  }
  if ((init?.method ?? request.method) !== "GET") return new Response("null", { headers: { "content-type": "application/json" } });
  let rows: unknown[] = [];
  if (url.pathname.endsWith("active_route_items_cloud")) {
    const id = url.searchParams.get("client_id")?.replace(/^eq\./, "");
    rows = routeRows.filter(row => !id || row.client_id === id);
  }
  if (url.pathname.endsWith("route_payment_reports")) {
    rows = declarationReports.filter(row => ["id", "client_id", "published_at", "status"].every(field => {
      const value = url.searchParams.get(field); return !value?.startsWith("eq.") || String(row[field]) === value.slice(3);
    }));
  }
  return new Response(JSON.stringify(rows), { headers: { "content-type": "application/json" } });
};
const { default: RoutePage } = await import("../../src/pages/RouteSearchPage");
const Page = RoutePage;

function Demo() {
  const [demoClients, setClients] = useState<Client[]>(() => JSON.parse(sessionStorage.getItem("outside-demo-clients:" + version) ?? "null") ?? clients);
  const [payments, setPayments] = useState<Payment[]>(() => JSON.parse(sessionStorage.getItem("outside-demo:" + version) ?? "[]"));
  const operator = params.get("operator");
  async function register(input: RoutePaymentInput) {
    (window as any).__outsideCalls = ((window as any).__outsideCalls ?? 0) + 1;
    (window as any).__outsideInput = input;
    await new Promise(resolve => setTimeout(resolve, 250));
    if ((window as any).__failOutside) throw new Error("No se pudo guardar el pago de prueba. Intenta nuevamente.");
    const client = demoClients.find(row => row.id === input.clientId)!;
    const dateKey = getBusinessDateKey();
    const transaction = buildManualPaymentTransaction({ clients: demoClients, payments, selectedClient: client,
      form: { clientId: client.id, dateApplied: dateKey, paymentMethod: "Efectivo", cashDeliveryStatus: "pending",
        collectionTeam: input.team, collectionDelta: input.delta, reference: "", amountReceived: String(input.amount) },
      manualOtherChargesInput: {}, retentionByClient: {}, operationalDateKey: dateKey,
      overrideForcedOtherCharges: false, receiptNumber: "LOCAL-" + String(payments.length + 1).padStart(4, "0"), currentActor: operator ?? "admin-local" });
    const payment: Payment = { ...transaction.payment, source: "route", outsideRouteCollection: {
      version, delta: input.delta!, team: input.team, collectedBy: operator ?? "admin-local", collectedAt: transaction.payment.createdAt } };
    if (input.reportId) {
      delete payment.outsideRouteCollection;
      if (version === "v2") payment.cxcV2RouteReportId = input.reportId;
      else payment.routeReportId = input.reportId;
      const report = declarationReports.find(row => row.id === input.reportId);
      if (report) { report.confirmed_cash_amount = input.amount; report.status = report.bank_amount > 0 ? "review" : "confirmed"; }
    }
    const next = [...payments, payment];
    sessionStorage.setItem("outside-demo:" + version, JSON.stringify(next));
    sessionStorage.setItem("outside-demo-clients:" + version, JSON.stringify(transaction.updatedClients));
    setPayments(next); setClients(transaction.updatedClients);
    return { kind: "cash" as const, receiptNumber: payment.receiptNumber, payment };
  }
  return <main style={{ maxWidth: 1400, margin: "0 auto", padding: 20 }}>
    <p style={{ padding: 12, background: "#fffbeb", borderRadius: 8 }}><strong>Vista local · Datos de ejemplo.</strong> Prueba X01 o X02 para cobrar fuera de ruta. A10 ya está en ruta.</p>
    <Page clients={demoClients} payments={payments} dataOwnerUserId="11111111-1111-4111-8111-111111111111"
      currentUserEmail={operator ? operator + "@auth.rentautos.local" : undefined} currentUserId={operator ?? "admin-local"}
      isAdmin={!operator} canDeclarePayment={Boolean(operator) && !params.has("readonly")}
      readOnly={Boolean(operator)} canReportPayment={!params.has("readonly")} canRemoveFromRoute={!operator}
      onRegisterPayment={register} />
  </main>;
}
createRoot(document.getElementById("root")!).render(<Demo />);
