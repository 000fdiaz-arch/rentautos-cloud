import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { ReceivableTableRow } from "../../src/pages/receivables/ReceivableTableRow";
import type { ReceivableRow } from "../../src/receivables";
import type { CollectionStatusRecord } from "../../src/pages/receivables/receivablesTypes";
import "../../src/styles.css";

const row: ReceivableRow = {
  id: "client-test", unitId: "T99", name: "CLIENTE PRUEBA", cedula: "8-000-999", group: "T", plan: "daily",
  nextDueDate: "2026-09-01", daysLate: 2, overdueInstallments: 2, overdueBalance: 50, totalPending: 50,
  lastPaymentDate: "2026-09-02", lastPaymentAmount: 25, percentPaid: 90, installmentsAgreed: 100,
  installmentsPaid: 90, installmentsRemaining: 10, rentAmount: 25, contractTotal: 2500, totalPaid: 2250,
  state: "vencido", totalOtherCharges: 0, recentPayments: [], hasActiveClient: true, operationalStatus: "activo"
};
function Harness() {
  const [status, setStatus] = useState<CollectionStatusRecord>({ status: "pending", updatedAt: "2026-09-02T12:00:00Z" });
  const [closed, setClosed] = useState(false);
  const [urgent, setUrgent] = useState(true);
  const [destination, setDestination] = useState<"insurance" | "judicial">("insurance");
  const update = (patch: Partial<CollectionStatusRecord>) => setStatus(current => ({ ...current, ...patch }));
  return <main style={{ padding: 16 }}>
    <button onClick={() => setClosed(value => !value)}>Alternar cierre</button>
    <button onClick={() => setUrgent(value => !value)}>Alternar urgencia</button>
    <button onClick={() => setDestination(value => value === "insurance" ? "judicial" : "insurance")}>Alternar expediente</button>
    <table className="ar-table"><tbody><ReceivableTableRow row={row} statusRecord={status} operationalStatus="activo"
      todayDateKey="2026-09-02" now={new Date("2026-09-02T12:00:00Z")} isTodayCollectionClosed={closed}
      workflowTab="management" collectionCutItems={{}} visibleCutKey="night" whatsAppMessage="Cobro de prueba"
      incidentAction={{ targetId: "case-test", destination, label: destination === "insurance" ? "Agregar número de reclamo" : "Asignar fecha de juicio", date: "2026-09-01", urgent }}
      onSelectDetail={() => {}} onCollectionCutStatusChange={(_cut, _id, next) => update({ status: next as CollectionStatusRecord["status"] })}
      onCollectionCutCommentChange={() => {}} onRouteTagChange={(_id, tagged) => update({ isRouteTagged: tagged, status: "pending" })}
      onRouteManagementTypeChange={(_id, value) => update({ managementType: value })}
      onRouteManagementCommentChange={(_id, value) => update({ managementComment: value })}
      onRouteAssignmentChange={(_id, value) => update({ routeAssignment: value })}
      onRouteUrgencyChange={(_id, value) => update({ routeUrgency: value })}
      onRouteReleaseAmountChange={(_id, value) => update({ routeReleaseAmount: Number(value) })}
      onWhatsAppMessageSent={() => {}} onSupportNoteChange={(_id, value) => update({ supportNote: value })}
      onContactTimeChange={(_id, value) => update({ contactTime: value })}
    /></tbody></table>
    <output id="test-status" hidden>{JSON.stringify(status)}</output>
  </main>;
}
createRoot(document.getElementById("root")!).render(<Harness />);
