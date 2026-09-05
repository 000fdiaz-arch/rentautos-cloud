import React, { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import DailyIncomePanel from "../../src/pages/payments/DailyIncomePanel";
import { loadPaymentsFromIndexedDb, savePayments } from "../../src/storage/coreStorage";
import type { Payment } from "../../src/types";
import "../../src/styles.css";

const payment = (id: string, method: Payment["paymentMethod"], amount: number, extra: Partial<Payment> = {}): Payment => ({
  id, receiptNumber: id, clientId: id, clientName: `Cliente ${id}`, clientUnit: id,
  dateApplied: "2026-08-29", createdAt: "2026-08-29T12:00:00Z", paymentMethod: method,
  amountReceived: amount, appliedToRent: amount, centavosAhorro: 0, installmentsDeducted: 0,
  balanceBefore: amount, balanceAfter: 0, savingsBefore: 0, savingsAfter: 0,
  installmentsPaidAfter: 1, installmentsRemainingAfter: 0, rentAmount: amount, frequency: "daily", ...extra
});
const restored = localStorage.getItem("income-fixture-seeded") ? await loadPaymentsFromIndexedDb() : null;
function Harness() {
  const [isOpen, setIsOpen] = useState(true);
  const [payments, setPayments] = useState(() => {
    if (restored) return restored;
    const rows = [
      payment("BANK", "ACH Express", 100, { dateApplied: "2026-09-02", bankAccountNumber: "123456" }),
      payment("CARD", "Tarjeta", 30, { dateApplied: "2026-09-02" }),
      payment("DISCOUNT", "Descuento", 10, { dateApplied: "2026-09-02" }),
      payment("CASH-DELIVERED", "Efectivo", 50, { moneyDelivered: true, moneyDeliveryDate: "2026-09-02" }),
      payment("CASH-PTY-1", "Efectivo", 20, { moneyDelivered: false, collectionTeam: "PTY" }),
      payment("CASH-PTY-2", "Efectivo", 25, { moneyDelivered: false, collectionTeam: "PTY" }),
      payment("CASH-WC", "Efectivo", 15, { moneyDelivered: false, collectionTeam: "WC" }),
      payment("CASH-NONE", "Efectivo", 5, { moneyDelivered: false }),
      payment("CASH-TODAY", "Efectivo", 8, { dateApplied: "2026-09-02", moneyDelivered: false })
    ];
    savePayments(rows); localStorage.setItem("income-fixture-seeded", "1"); return rows;
  });
  const ref = useRef<HTMLElement>(null);
  return <main style={{ padding: 16, minWidth: 0 }}><button onClick={() => setIsOpen(value => !value)}>{isOpen ? "Ir a otra sección" : "Volver a ingresos"}</button><DailyIncomePanel sectionRef={ref} isOpen={isOpen} payments={payments} bankRules={[]}
    currentActor="Pruebas" readOnly={new URLSearchParams(location.search).has("readonly")}
    onPaymentsChange={rows => { savePayments(rows); setPayments(rows); }} /></main>;
}
createRoot(document.getElementById("root")!).render(<Harness />);
