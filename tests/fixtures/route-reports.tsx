import React, { useEffect, useState } from "react";
import type { Payment } from "../../src/types";
import { createRoot } from "react-dom/client";
import RouteSearchPage from "../../src/pages/RouteSearchPage";
import { canReportRoutePayment, getRoleScreenPermissions } from "../../src/auth/permissions";
import { getBusinessDateKey } from "../../src/billing";
import "../../src/styles.css";
const role = new URLSearchParams(location.search).has("readonly") ? "lectura" : "buscador";
const canRegister = new URLSearchParams(location.search).has("cashregister");
function Harness() {
  const [payments, setPayments] = useState<Payment[]>(() => [
    { id: "old", clientId: "cash-wc", clientUnit: "RA-WC", clientName: "Cliente WC", receiptNumber: "REC-old", paymentMethod: "Efectivo", moneyDelivered: false, collectionTeam: "WC", amountReceived: 45.25, dateApplied: "2020-01-01", createdAt: "2020-01-01T12:00:00Z" },
    { id: "pty", clientId: "cash-pty", clientUnit: "RA-PTY", clientName: "Cliente PTY", receiptNumber: "REC-pty", paymentMethod: "Efectivo", moneyDelivered: false, collectionTeam: "PTY", amountReceived: 30, dateApplied: "2020-01-02", createdAt: "2020-01-02T12:00:00Z" }
  ] as Payment[]);
  useEffect(() => {
    const partial = () => setPayments(current => [...current, { id: "partial", clientId: "c1", dateApplied: getBusinessDateKey(), appliedToRent: 32, amountReceived: 32 } as Payment]);
    const changePartial = (event: Event) => setPayments(current => current.map(payment => payment.id === "partial"
      ? { ...payment, appliedToRent: Number((event as CustomEvent).detail) } : payment));
    const deliver = () => setPayments(current => current.map(payment => payment.id === "old" ? { ...payment, moneyDelivered: true } : payment));
    window.addEventListener("test:partial", partial);
    window.addEventListener("test:change-partial", changePartial);
    window.addEventListener("test:deliver-cash", deliver);
    return () => { window.removeEventListener("test:deliver-cash", deliver); window.removeEventListener("test:partial", partial); window.removeEventListener("test:change-partial", changePartial); };
  }, []);
  return <RouteSearchPage
  dataOwnerUserId="11111111-1111-4111-8111-111111111111"
  currentUserId="22222222-2222-4222-8222-222222222222"
  canReportPayment={canReportRoutePayment(role, getRoleScreenPermissions(role))}
  canRemoveFromRoute={new URLSearchParams(location.search).has("editor")}
  clients={[]} payments={payments} readOnly={!canRegister}
  onRegisterPayment={canRegister ? async (input) => {
    const response = await fetch('/__register-cash', { method: 'POST', body: JSON.stringify(input) });
    if (!response.ok) throw new Error('No se pudo guardar el pago de prueba.');
    return response.json();
  } : undefined}
/>;
}
createRoot(document.getElementById("root")!).render(<Harness />);
