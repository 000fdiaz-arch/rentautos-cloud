import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import PaymentsPage from "../../src/pages/PaymentsPage";
import { getBusinessDateKey } from "../../src/billing";
import type { Client, Payment } from "../../src/types";
import "../../src/styles.css";

function Harness() {
  const [clients, setClients] = useState<Client[]>([{
    id: "team-client", unitId: "T99", name: "CLIENTE PRUEBA EQUIPO", cedula: "8-000-999",
    rentAmount: 25, frequency: "daily", chargeFirstSunday: false, balance: 100, advanceBalance: 0,
    savings: 0, installmentsAgreed: 100, installmentsRemaining: 10, installmentsPaid: 90,
    otherCharges: [], createdAt: "2026-08-01T12:00:00Z", lastChargeDate: getBusinessDateKey(), status: "active"
  }]);
  const [payments, setPayments] = useState<Payment[]>([]);
  return <><PaymentsPage clients={clients} payments={payments} bankRules={[]}
    lateFeeSettings={{ active: false, dailyAmount: 0, chargeLabel: "Recargo", selectedUnits: [] }}
    otherChargesRetentionByClient={{}} onClientsChange={setClients} onPaymentsChange={setPayments} currentActor="Pruebas" />
    <output id="registration-payments" hidden>{JSON.stringify(payments)}</output>
    <output id="registration-clients" hidden>{JSON.stringify(clients)}</output></>;
}
createRoot(document.getElementById("root")!).render(<Harness />);
