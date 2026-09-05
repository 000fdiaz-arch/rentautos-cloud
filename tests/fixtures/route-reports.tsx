import React, { useEffect, useState } from "react";
import type { Payment } from "../../src/types";
import { createRoot } from "react-dom/client";
import RouteSearchPage from "../../src/pages/RouteSearchPage";
import { canReportRoutePayment, getRoleScreenPermissions } from "../../src/auth/permissions";
import "../../src/styles.css";
const role = new URLSearchParams(location.search).has("readonly") ? "lectura" : "buscador";
function Harness() {
  const [payments, setPayments] = useState<Payment[]>(() => [
    { id: "old", clientId: "cash-wc", clientUnit: "RA-WC", clientName: "Cliente WC", receiptNumber: "REC-old", paymentMethod: "Efectivo", moneyDelivered: false, collectionTeam: "WC", amountReceived: 45.25, dateApplied: "2020-01-01", createdAt: "2020-01-01T12:00:00Z" },
    { id: "pty", clientId: "cash-pty", clientUnit: "RA-PTY", clientName: "Cliente PTY", receiptNumber: "REC-pty", paymentMethod: "Efectivo", moneyDelivered: false, collectionTeam: "PTY", amountReceived: 30, dateApplied: "2020-01-02", createdAt: "2020-01-02T12:00:00Z" }
  ] as Payment[]);
  useEffect(() => {
    const deliver = () => setPayments(current => current.map(payment => payment.id === "old" ? { ...payment, moneyDelivered: true } : payment));
    window.addEventListener("test:deliver-cash", deliver);
    return () => window.removeEventListener("test:deliver-cash", deliver);
  }, []);
  return <RouteSearchPage
  dataOwnerUserId="11111111-1111-4111-8111-111111111111"
  currentUserId="22222222-2222-4222-8222-222222222222"
  canReportPayment={canReportRoutePayment(role, getRoleScreenPermissions(role))}
  clients={[]} payments={payments} readOnly
/>;
}
createRoot(document.getElementById("root")!).render(<Harness />);
