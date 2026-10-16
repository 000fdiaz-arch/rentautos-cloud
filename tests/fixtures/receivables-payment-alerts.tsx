import React from "react";
import { createRoot } from "react-dom/client";
import ReceivablesPage from "../../src/pages/ReceivablesPage";
import type { Client, Payment } from "../../src/types";
import "../../src/styles.css";

const common = {
  installmentsAgreed: 100,
  installmentsRemaining: 90,
  installmentsPaid: 10,
  otherCharges: [],
  advanceBalance: 0,
  savings: 0,
  createdAt: "2026-08-01T12:00:00Z",
  lastChargeDate: "2026-10-16",
  status: "activo" as const
};

const clients: Client[] = [
  {
    ...common,
    id: "daily-missing",
    unitId: "C38",
    name: "Cliente diario",
    rentAmount: 36,
    frequency: "daily",
    balance: 108,
    createdAt: "2026-10-01T12:00:00Z",
    installmentsPaid: 0,
    installmentsRemaining: 100
  },
  {
    ...common,
    id: "weekly-partial",
    unitId: "A13",
    name: "Cliente semanal parcial",
    rentAmount: 192,
    frequency: "weekly",
    weeklyChargeDay: "monday",
    balance: 344,
    otherCharges: [
      { id: "charge-1", label: "RECARGO POR TARDANZA DE PAGO", amount: 25 },
      { id: "charge-2", label: "OTRO CARGO PARA PAGAR LUEGO", amount: 999 }
    ],
    fines: [{
      id: "fine-1",
      type: "NEGATIVE_PANAPASS_BALANCE",
      label: "Panapass",
      amount: 40,
      amountPaid: 0,
      status: "pending",
      createdAt: "2026-10-10T12:00:00Z"
    }],
    tickets: [{
      id: "ticket-1",
      ticketNumber: "B-100",
      ticketAmount: 40,
      processingFee: 10,
      amount: 50,
      amountPaid: 10,
      status: "partial",
      createdAt: "2026-10-09T12:00:00Z"
    }]
  },
  {
    ...common,
    id: "biweekly-missing",
    unitId: "A45",
    name: "Cliente quincenal",
    rentAmount: 299,
    frequency: "biweekly",
    balance: 299,
    otherCharges: [{ id: "charge-3", label: "OTRO CARGO PARA PAGAR LUEGO", amount: 300 }]
  }
];

const payments = [
  {
    id: "weekly-low-1",
    clientId: "weekly-partial",
    clientName: "Cliente semanal parcial",
    clientUnit: "A13",
    dateApplied: "2026-10-14",
    createdAt: "2026-10-14T12:00:00Z",
    amountReceived: 80,
    appliedToRent: 80
  },
  {
    id: "weekly-low-2",
    clientId: "weekly-partial",
    clientName: "Cliente semanal parcial",
    clientUnit: "A13",
    dateApplied: "2026-10-07",
    createdAt: "2026-10-07T12:00:00Z",
    amountReceived: 100,
    appliedToRent: 100
  }
] as Payment[];

createRoot(document.getElementById("root")!).render(
  <ReceivablesPage
    clients={clients}
    payments={payments}
    lateFeeSettings={{
      active: true,
      dailyAmount: 5,
      chargeLabel: "RECARGO POR TARDANZA DE PAGO",
      selectedUnits: ["A13"]
    }}
    readOnly
  />
);
