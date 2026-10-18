import React, { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import PaymentHistoryPanel from "../../src/pages/payments/PaymentHistoryPanel";
import type { Payment } from "../../src/types";
import "../../src/styles.css";

const pendingPayment: Payment = {
  id: "payment-mobile-share",
  receiptNumber: "REC-9",
  clientId: "client-mobile-share",
  clientName: "Cliente móvil",
  clientUnit: "A01",
  dateApplied: "2026-10-18",
  createdAt: "2026-10-18T12:00:00Z",
  paymentMethod: "ACH Express",
  amountReceived: 28.46,
  appliedToRent: 28,
  centavosAhorro: 0.46,
  installmentsDeducted: 1,
  balanceBefore: 56,
  balanceAfter: 28,
  savingsBefore: 0,
  savingsAfter: 0.46,
  installmentsPaidAfter: 1,
  installmentsRemainingAfter: 1,
  rentAmount: 28,
  frequency: "daily",
  receiptDeliveryStatus: "pending"
};

const secondSequentialPayment: Payment = {
  ...pendingPayment,
  id: "payment-mobile-share-second",
  receiptNumber: "REC-10",
  amountReceived: 28,
  appliedToRent: 28,
  centavosAhorro: 0,
  balanceBefore: 28,
  balanceAfter: 0,
  createdAt: "2026-10-18T12:05:00Z",
  receiptDeliveryStatus: "sent"
};

const otherUnitPayment: Payment = {
  ...pendingPayment,
  id: "payment-other-unit",
  receiptNumber: "REC-20",
  clientId: "client-other-unit",
  clientName: "Otro cliente",
  clientUnit: "B02",
  createdAt: "2026-10-18T12:10:00Z",
  receiptDeliveryStatus: "sent"
};

function Harness() {
  const [payments, setPayments] = useState<Payment[]>([secondSequentialPayment, otherUnitPayment, pendingPayment]);
  const historyRef = useRef<HTMLElement>(null);

  return (
    <main className="page-inner payments-page">
      <PaymentHistoryPanel
        historySectionRef={historyRef}
        isHistoryOpen
        activeClients={[]}
        payments={payments}
        operationalDateKey="2026-10-18"
        onPaymentsChange={async (next) => {
          await new Promise((resolve) => window.setTimeout(resolve, 25));
          setPayments(next);
        }}
        isPaymentHistoryLoaded
        isDateClosed={() => false}
        getGroupCode={() => "A"}
        focusRequest={null}
        onPreviewPayment={() => undefined}
      />
      <output id="payment-status" hidden>{payments.find((payment) => payment.id === pendingPayment.id)?.receiptDeliveryStatus}</output>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);
