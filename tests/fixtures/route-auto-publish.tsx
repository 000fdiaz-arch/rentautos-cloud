import React from "react";
import { createRoot } from "react-dom/client";
import ReceivablesPage from "../../src/pages/ReceivablesPage";
import type { Client } from "../../src/types";
import "../../src/styles.css";
const clients: Client[]=[1,2].map(n=>({id:`c${n}`,unitId:`T0${n}`,name:`Cliente ${n}`,rentAmount:25,frequency:"daily",installmentsAgreed:100,installmentsRemaining:90,installmentsPaid:10,otherCharges:[],balance:100,advanceBalance:0,savings:0,createdAt:"2026-08-01T12:00:00Z",lastChargeDate:"2026-09-05",status:"activo"}));
createRoot(document.getElementById("root")!).render(<ReceivablesPage clients={clients} payments={[]} dataOwnerUserId="11111111-1111-4111-8111-111111111111" readOnly={location.search.includes('readonly')} isPaymentHistoryLoaded={!location.search.includes('loading')} />);
